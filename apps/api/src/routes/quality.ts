import { conceptInValueSet, parseValueSetDefinition } from '@openrunic/terminology';
import type { ValueSetDefinition } from '@openrunic/terminology';
import { openrunicCodeSystem, SYSTEMS } from '@openrunic/fhir';
import {
  evaluateMeasure,
  isComputable,
  MEASURES,
  measureById,
  type CodedEvent,
  type MeasurementPeriod,
  type MeasureSubject,
  type NumericEvent,
} from '@openrunic/quality';
import { Hono, type Context } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { parseParam, parseQuery } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import {
  measureListSchema,
  measureReportSchema,
  qualityReportQuerySchema,
  toMeasureSummary,
  type MeasureReportDto,
  type MeasureSummaryDto,
} from '../schemas/quality.js';

import { repositories } from './helpers.js';

/**
 * QUALITY REPORTING.
 *
 * `packages/quality` decides what the numbers are. This module's whole job is
 * to hand it a population and a set of code lists that are actually this
 * deployment's, and to refuse rather than guess when either is missing.
 *
 * ## Value sets are expanded once, not per patient
 *
 * A measure asks "is this code in that value set" for every coded fact on every
 * patient. Answering each one by walking the value set's rules against the
 * terminology store would be a query per question. So every value set a measure
 * names is expanded once, up front, into a set of `system|code` strings, and
 * membership is a set lookup after that.
 *
 * That is a cache with a lifetime of one request, which is the only lifetime
 * that is safe: a value set definition or a code system release can change
 * between reports, and a report that used yesterday's expansion would be a
 * number nobody can reproduce from what is stored now.
 *
 * ## Why `facility.all`
 *
 * A quality report is an organisation-wide read of every chart, which is the
 * same shape as a bulk export and is guarded the same way. Every other route
 * honours a principal's facility grants by asking about one facility at a time,
 * and a whole-organisation read never gets that: a report computed over one
 * site and labelled with the practice's name is a number about a different
 * population than the one it claims.
 *
 * ## How many patients
 *
 * Bounded, and the bound is reported. A report computed over the first page of
 * a practice's patients is not a smaller report, it is a wrong one, and the
 * shape of the wrongness - a plausible rate over an unstated subset - is
 * exactly what a quality number must never have. So the ceiling is high, and
 * exceeding it refuses rather than truncating.
 */

const PATIENT_CEILING = 20_000;
const EVENTS_PER_PATIENT = 500;

/** `system|code`, the key an expanded value set is looked up by. */
function conceptKey(system: string, code: string): string {
  return `${system}|${code}`;
}

/**
 * Expands every value set a measure names into a set of concept keys.
 *
 * A value set the deployment has not defined is simply absent from the result.
 * The measure evaluator is what notices, and it refuses to compute rather than
 * treating an empty set as a set that matched nothing: those look identical at
 * the point of use and mean opposite things.
 */
async function expandValueSets(
  c: Context<AppEnv>,
  urls: readonly string[]
): Promise<Map<string, ReadonlySet<string>>> {
  const repos = repositories(c);
  const expanded = new Map<string, ReadonlySet<string>>();

  for (const url of new Set(urls)) {
    const page = await repos.valueSets.list({
      page: 1,
      pageSize: 1,
      sort: 'url',
      order: 'asc',
      url,
    });
    const row = page.rows[0];
    if (row === undefined) continue;

    const parsed = parseValueSetDefinition(row.definition);
    // A definition that will not parse is treated as absent rather than as
    // empty. It was validated on the way in, so this means the stored row was
    // written by something else, and computing a rate from a set nobody can
    // read is worse than saying the measure cannot be computed.
    if (!parsed.ok) continue;

    expanded.set(url, await concepts(c, parsed.value));
  }

  return expanded;
}

/** Every loaded code the definition selects. */
async function concepts(
  c: Context<AppEnv>,
  definition: ValueSetDefinition
): Promise<ReadonlySet<string>> {
  const systems = new Set(definition.include.map((rule) => rule.system));
  const members = new Set<string>();

  for (const system of systems) {
    const page = await repositories(c).terminology.list({
      page: 1,
      pageSize: 10_000,
      sort: 'code',
      order: 'asc',
      system,
    });
    for (const row of page.rows) {
      const concept = {
        system: row.system,
        code: row.code,
        display: row.display,
        version: row.version,
        parentCode: row.parentCode,
        isActive: row.isActive,
        properties: null,
      };
      if (conceptInValueSet(concept, definition)) members.add(conceptKey(row.system, row.code));
    }
  }

  return members;
}

/** Turns the stored chart into the small shape a measure reads. */
async function subjectsFor(
  c: Context<AppEnv>,
  period: MeasurementPeriod
): Promise<MeasureSubject[]> {
  const repos = repositories(c);
  const patients = await repos.patients.list({
    page: 1,
    pageSize: PATIENT_CEILING,
    sort: 'familyName',
    order: 'asc',
  });

  if (patients.total > PATIENT_CEILING) {
    // Refused rather than truncated. A plausible rate over an unstated subset
    // is the one thing a quality number must never be.
    throw ApiError.conflict(
      `This organisation has ${String(patients.total)} patients and this endpoint reports over at most ${String(PATIENT_CEILING)}.`
    );
  }

  const window = { page: 1, pageSize: EVENTS_PER_PATIENT, order: 'asc' as const };
  // Bounded to the period for the things a measure only counts inside it.
  //
  // Conditions get the unbounded window, and `ConditionListQuery` has no `from`
  // or `to` to give them anyway. That absence is the right design rather than a
  // gap: hypertension and diabetes are chronic, a diagnosis made three years
  // ago still describes the patient in front of you, and a problem list
  // narrowed to twelve months would empty these denominators of exactly the
  // patients the measures are about. Said here because the next reader will
  // wonder why one of these four is different.
  const dated = { ...window, from: period.start, to: period.end };

  return Promise.all(
    patients.rows.map(async (patient) => {
      const [conditions, encounters, observations, immunisations] = await Promise.all([
        repos.problems.list({ ...window, sort: 'recordedAt', patientId: patient.id }),
        repos.appointments.list({ ...dated, sort: 'start', patientId: patient.id }),
        repos.observations.list({ ...dated, sort: 'effectiveAt', patientId: patient.id }),
        repos.immunisations.list({ ...dated, sort: 'administeredAt', patientId: patient.id }),
      ]);

      return {
        patientId: patient.id,
        birthDate: patient.birthDate,
        deceasedAt: patient.deceasedAt,
        conditions: conditions.rows.map((row): CodedEvent => ({
          system: row.codeSystem,
          code: row.code,
          at: row.onsetDate ?? row.createdAt,
        })),
        encounters: encounters.rows.map((row): CodedEvent => ({
          system: APPOINTMENT_SYSTEM,
          code: row.typeCode,
          at: row.start,
        })),
        observations: observations.rows.flatMap((row): NumericEvent[] =>
          row.valueNumber === null
            ? []
            : [
                {
                  system: row.codeSystem,
                  code: row.code,
                  at: row.effectiveAt,
                  value: Number(row.valueNumber),
                  ...(row.unit === null ? {} : { unit: row.unit }),
                },
              ]
        ),
        // Not projected yet, and empty rather than absent so a measure reading
        // one gets "nothing recorded" rather than a crash. The two measures
        // this build carries read neither.
        procedures: [],
        medications: [],
        immunisations: immunisations.rows.map((row): CodedEvent => ({
          system: IMMUNISATION_SYSTEM,
          code: row.cvxCode,
          at: row.administeredAt,
        })),
      } satisfies MeasureSubject;
    })
  );
}

/**
 * The system URI an appointment type is coded under.
 *
 * Appointments carry a practice-defined type code rather than a published one,
 * so the encounter value sets a measure names will not match them unless a
 * deployment maps its own codes into a value set under this system. That is a
 * real limitation and it is why the encounter criteria are the first thing to
 * check when a denominator looks empty.
 *
 * Built rather than written out, so this project's code-system URIs are defined
 * in exactly one place. They are canonical identifiers and not endpoints:
 * nothing dereferences them, and rewriting one to https would make it a
 * different identifier that no longer matches the data it describes.
 */
const APPOINTMENT_SYSTEM = openrunicCodeSystem('appointment-type');
const IMMUNISATION_SYSTEM = SYSTEMS.cvx;

export function qualityRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * What this build can measure, and whether this deployment can compute it.
   *
   * The second half is the useful one. A practice wants to know which measures
   * are waiting on value sets it has not loaded, and the answer names them.
   */
  router.get('/quality/measures', requirePermission('facility.all'), async (c) => {
    const loaded = new Set<string>();
    const page = await repositories(c).valueSets.list({
      page: 1,
      pageSize: 1_000,
      sort: 'url',
      order: 'asc',
    });
    for (const row of page.rows) loaded.add(row.url);

    return c.json<{ data: MeasureSummaryDto[] }>({
      data: MEASURES.map((measure) => toMeasureSummary(measure, loaded)),
    });
  });

  /** One measure, computed over this organisation for a stated period. */
  router.get('/quality/measures/:id/report', requirePermission('facility.all'), async (c) => {
    const id = parseParam(c.req.param('id'), measureIdSchema, 'id');
    const measure = measureById(id);
    if (measure === undefined) throw ApiError.notFound('No such quality measure.');

    const query = parseQuery(c, qualityReportQuerySchema);
    const period: MeasurementPeriod = {
      start: new Date(query.periodStart),
      end: new Date(query.periodEnd),
    };
    if (period.end <= period.start) {
      throw ApiError.validation('The measurement period must end after it starts.', [
        { path: 'periodEnd', message: 'must be after periodStart' },
      ]);
    }

    const expanded = await expandValueSets(c, measure.valueSets);
    const subjects = await subjectsFor(c, period);

    const outcome = evaluateMeasure(measure, subjects, period, {
      loadedValueSets: new Set(expanded.keys()),
      inValueSet: (url, event) =>
        expanded.get(url)?.has(conceptKey(event.system, event.code)) ?? false,
    });

    if (!isComputable(outcome)) {
      // 409 rather than 404 or 500: the measure exists and nothing is broken.
      // This deployment has not loaded the code lists it reads, which is
      // something an operator can act on, and the body names which.
      throw ApiError.conflict(
        `This deployment has not loaded the value sets ${measure.id} reads: ${outcome.missingValueSets.join(', ')}`
      );
    }

    return c.json<MeasureReportDto>({
      measureId: outcome.measureId,
      title: outcome.title,
      version: outcome.version,
      higherIsBetter: outcome.higherIsBetter,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      initialPopulation: outcome.initialPopulation,
      denominator: outcome.denominator,
      denominatorExclusion: outcome.denominatorExclusion,
      denominatorException: outcome.denominatorException,
      numerator: outcome.numerator,
      numeratorUnknown: outcome.numeratorUnknown,
      performanceRate: outcome.performanceRate,
    });
  });

  return router;
}

const measureIdSchema = measureListSchema.shape.id;

/* ----------------------------------------------------------------- contracts */

export function qualityRouteContracts(): RouteContract[] {
  return [
    {
      method: 'get',
      path: '/bff/v0/quality/measures',
      operationId: 'listQualityMeasures',
      summary: 'The quality measures this build carries.',
      description:
        'Each measure says whether this deployment can compute it, and names the value sets it is waiting on. The specifications are public; the code lists are licensed and are supplied by the deployment.',
      tags: ['quality'],
      permission: 'facility.all',
      responses: [
        { status: 200, description: 'The measures.', schema: measureListSchema.array() },
        { status: 401, description: 'No bearer token, or one that is not valid.' },
        { status: 403, description: 'The principal lacks the permission this route needs.' },
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/quality/measures/{id}/report',
      operationId: 'reportQualityMeasure',
      summary: 'Compute one measure over this organisation.',
      description:
        'Answers 409 when the deployment has not loaded the value sets the measure reads, naming them, rather than computing a rate from a partial code list. `numeratorUnknown` counts patients whose record does not contain what the numerator needs; they count against the rate, because an unrecorded result is not a result.',
      tags: ['quality'],
      permission: 'facility.all',
      pathParams: [
        { name: 'id', description: 'Measure identifier, e.g. CMS165.', schema: measureIdSchema },
      ],
      query: qualityReportQuerySchema,
      responses: [
        { status: 200, description: 'The report.', schema: measureReportSchema },
        { status: 400, description: 'The request was malformed.' },
        { status: 401, description: 'No bearer token, or one that is not valid.' },
        { status: 403, description: 'The principal lacks the permission this route needs.' },
        { status: 404, description: 'No such quality measure.' },
        {
          status: 409,
          description:
            'Value sets are not loaded, or the population is larger than this endpoint reports over.',
        },
        { status: 422, description: 'The period failed validation.' },
      ],
    },
  ];
}

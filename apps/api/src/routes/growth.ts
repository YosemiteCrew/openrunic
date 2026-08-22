import { curveFor, isRefusal, percentileFor, type Measure, type Sex } from '@openrunic/growth';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseParam, parseQuery } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import { idParamSchema, repositories, required } from './helpers.js';

/**
 * GROWTH, FOR A PATIENT THIS PRACTICE ACTUALLY HOLDS.
 *
 * `packages/growth` can turn a measurement into a percentile. This turns a
 * patient into a chart: it reads the vitals already recorded, works out which
 * measure each one is, and answers with a point per reading plus the curves to
 * draw them against.
 *
 * ## Why the curves come back too
 *
 * A single percentile says where a child is. The question a clinician is
 * actually asking is whether they are following their line or crossing it, and
 * that needs the line. Returning the points without the curves would make every
 * caller fetch them separately or, worse, draw their own - and a chart whose
 * reference curves were computed by the front end is a chart nobody can audit.
 *
 * ## What decides which chart a reading belongs to
 *
 * The LOINC code on the observation, and nothing else. A height recorded at
 * eighteen months is `length-for-age` if it was taken lying down and
 * `stature-for-age` if standing, and those are different LOINC codes precisely
 * because they are different measurements. Guessing from the age would silently
 * plot a standing height against a recumbent reference, which shifts a child
 * about a centimetre - enough to move a percentile and not enough to look wrong.
 */

/** The LOINC codes this maps, and the chart each belongs on. */
const LOINC_TO_MEASURE: Readonly<Record<string, Measure>> = {
  '29463-7': 'weight-for-age',
  '3141-9': 'weight-for-age',
  // Recumbent length and standing height are different codes because they are
  // different measurements, and the code is what says which was taken.
  '8306-3': 'length-for-age',
  '8302-2': 'stature-for-age',
  '9843-4': 'head-circumference-for-age',
  '8287-5': 'head-circumference-for-age',
  '39156-5': 'bmi-for-age',
  '59576-9': 'bmi-for-age',
};

const growthQuerySchema = z.object({
  /** Which charts to draw. Absent means every measure the readings cover. */
  measure: z.string().optional(),
});

const growthPointSchema = z.object({
  observationId: z.string(),
  measure: z.string(),
  ageMonths: z.number(),
  value: z.number(),
  unit: z.string(),
  z: z.number(),
  percentile: z.number(),
  median: z.number(),
  recordedAt: z.string(),
});

const growthUnchartedSchema = z.object({
  observationId: z.string(),
  /** The code as recorded, so a practice can see what it is not getting charted. */
  code: z.string(),
  display: z.string(),
  reason: z.string(),
});

const growthResponseSchema = z.object({
  patientId: z.string(),
  /** Absent when the chart cannot be drawn at all; see `uncharted`. */
  sex: z.string().optional(),
  birthDate: z.string().optional(),
  points: z.array(growthPointSchema),
  curves: z.array(
    z.object({
      measure: z.string(),
      percentile: z.number(),
      points: z.array(z.object({ index: z.number(), value: z.number() })),
    })
  ),
  /** Readings this could not chart, each saying why. Never silently dropped. */
  uncharted: z.array(growthUnchartedSchema),
  /** The reference the percentiles are against, named so it can be weighed. */
  reference: z.string(),
});

/** The percentile lines a paediatric chart is conventionally drawn with. */
const CURVE_PERCENTILES = [3, 10, 25, 50, 75, 90, 97];

/** Enough vitals for a childhood; a chart with more is a chart nobody reads. */
const READING_LIMIT = 500;

export function growthRoutes(router: Hono<AppEnv>): void {
  /**
   * Every charted reading for a patient, and the curves to plot them against.
   *
   * A reading this cannot chart is returned in `uncharted` with the reason
   * rather than omitted. A growth chart missing a measurement looks like a
   * measurement that was never taken, and "we have no weight for this child at
   * two years" and "we have one and could not plot it" are different problems
   * with different fixes.
   */
  // Both, and both are load bearing. The readings are chart data, which is
  // `encounter.read`. The sex and birth date the response returns - and which
  // the reference tables are selected by - are demographics, which is
  // `patient.read` at `/patients/:id`. Asking only for the first let a role
  // denied demographics read them here, along with whether a given patient id
  // exists at all, which the 404 answers.
  router.get(
    '/patients/:id/growth',
    requirePermission('encounter.read'),
    requirePermission('patient.read'),
    async (c) => {
      const patientId = parseParam(c.req.param('id'), idParamSchema, 'id');
      const query = parseQuery(c, growthQuerySchema);
      const patient = required(
        await repositories(c).patients.findById(patientId),
        'No such patient.'
      );

      const sex = sexOf(patient.sexAtBirth);
      if (sex === undefined) {
        // Every one of these charts is sex-specific, and there is no neutral one
        // to fall back to. Answering with an empty chart would read as "this child
        // has no measurements"; this says what is actually missing.
        throw ApiError.malformed(
          'These growth charts are sex-specific and this patient has no sex recorded at birth, so there is no reference to plot against.'
        );
      }

      const readings = await readingsFor(c, patientId);
      const wanted = query.measure;

      const points: z.infer<typeof growthPointSchema>[] = [];
      const uncharted: z.infer<typeof growthUnchartedSchema>[] = [];

      for (const reading of readings) {
        const measure = LOINC_TO_MEASURE[reading.loincCode ?? reading.code];
        if (measure === undefined) {
          uncharted.push({
            observationId: reading.id,
            code: reading.loincCode ?? reading.code,
            display: reading.display,
            reason: 'This code is not one of the measurements the growth charts describe.',
          });
          continue;
        }
        if (wanted !== undefined && measure !== wanted) continue;

        const value = reading.valueNumber === null ? undefined : Number(reading.valueNumber);
        if (value === undefined) {
          uncharted.push({
            observationId: reading.id,
            code: reading.loincCode ?? reading.code,
            display: reading.display,
            reason: 'The reading has no numeric value to plot.',
          });
          continue;
        }

        const ageMonths = monthsBetween(patient.birthDate, reading.effectiveAt);
        const result = percentileFor({ measure, sex, value, ageMonths });

        if (isRefusal(result)) {
          uncharted.push({
            observationId: reading.id,
            code: reading.loincCode ?? reading.code,
            display: reading.display,
            reason: result.detail,
          });
          continue;
        }

        points.push({
          observationId: reading.id,
          measure,
          ageMonths: round(ageMonths, 2),
          value,
          unit: result.unit,
          z: result.z,
          percentile: result.percentile,
          median: result.median,
          recordedAt: reading.effectiveAt.toISOString(),
        });
      }

      return c.json({
        patientId,
        sex,
        birthDate: patient.birthDate.toISOString().slice(0, 10),
        points,
        curves: curvesFor(points, sex),
        uncharted,
        // Named on the response rather than assumed, because a percentile whose
        // reference is unstated is one a clinician cannot weigh.
        reference: 'CDC 2000 growth charts',
      });
    }
  );
}

/**
 * The curves for the measures that actually have points on them.
 *
 * The patient's own sex, because every one of these references is sex-specific
 * and a chart whose curves belong to the other one is wrong in a way that looks
 * like the child is.
 *
 * Only the measures with points, because drawing every chart regardless would
 * send a caller seven curves of stature for a patient who has only ever been
 * weighed - a large payload saying nothing.
 */
function curvesFor(
  points: readonly { measure: string; ageMonths: number }[],
  sex: Sex
): { measure: string; percentile: number; points: { index: number; value: number }[] }[] {
  const curves: {
    measure: string;
    percentile: number;
    points: { index: number; value: number }[];
  }[] = [];

  for (const measure of new Set(points.map((point) => point.measure))) {
    const mine = points.filter((point) => point.measure === measure);

    for (const infant of chartsFor(measure as Measure, mine)) {
      for (const percentile of CURVE_PERCENTILES) {
        const drawn = curveFor(measure as Measure, sex, percentile, { infant });
        if (drawn.length === 0) continue;
        curves.push({ measure, percentile, points: [...drawn] });
      }
    }
  }

  return curves;
}

/**
 * Which reference charts a measure's points need under them - both, where the
 * points span the boundary.
 *
 * Four of the six answer from the measure alone: length and head circumference
 * are only ever on the infant chart, stature and BMI only on the child one.
 * Weight is the one where age decides, and it is the one where a child can have
 * points on both - a weight at six months and another at five years are on
 * different references, and there is nothing unusual about a chart holding both.
 *
 * Picking one chart for the set leaves the points on the other side floating
 * with no line under them, whichever way the choice goes: `some` strands the
 * older points and `every` strands the younger ones. So a set that spans the
 * boundary gets both, and every point has its own reference to be read against.
 */
function chartsFor(measure: Measure, points: readonly { ageMonths: number }[]): boolean[] {
  if (measure === 'length-for-age' || measure === 'head-circumference-for-age') return [true];
  if (measure === 'stature-for-age' || measure === 'bmi-for-age') return [false];

  const charts: boolean[] = [];
  if (points.some((point) => point.ageMonths < 24)) charts.push(true);
  if (points.some((point) => point.ageMonths >= 24)) charts.push(false);
  return charts;
}

async function readingsFor(
  c: Context<AppEnv>,
  patientId: string
): Promise<
  {
    id: string;
    loincCode: string | null;
    code: string;
    display: string;
    valueNumber: unknown;
    effectiveAt: Date;
  }[]
> {
  const page = await repositories(c).observations.list({
    page: 1,
    pageSize: READING_LIMIT,
    sort: 'effectiveAt',
    order: 'asc',
    patientId,
    category: 'VITAL_SIGNS',
  });

  return page.rows;
}

/** HL7 administrative sex, as the growth charts name it. */
function sexOf(sexAtBirth: string | null): Sex | undefined {
  if (sexAtBirth === 'MALE') return 'male';
  if (sexAtBirth === 'FEMALE') return 'female';
  return undefined;
}

/**
 * Age in months, as a real number rather than a whole one.
 *
 * The charts are at half-month steps for infants and the parameters are
 * interpolated between them, so rounding to a whole month here would throw away
 * precision the reference is built to use - and at three months of age, half a
 * month is a sixth of the child's life.
 */
function monthsBetween(birthDate: Date, at: Date): number {
  const days = (at.getTime() - birthDate.getTime()) / 86_400_000;
  // The average Gregorian month. Calendar-month arithmetic would make the same
  // interval read differently depending which months it spanned.
  return days / 30.4375;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function growthRouteContracts(): RouteContract[] {
  return [
    {
      method: 'get',
      path: '/bff/v0/patients/{id}/growth',
      operationId: 'getPatientGrowth',
      summary: "Plot a patient's recorded vitals against the growth charts.",
      description:
        'Reads the vital signs already recorded for a patient, scores each against the CDC 2000 growth charts, and returns a point per reading alongside the percentile curves to draw them on. Which chart a reading belongs to is decided by its LOINC code and nothing else, because recumbent length and standing height are different codes precisely because they are different measurements. A reading that cannot be charted is returned in `uncharted` with the reason rather than omitted: a chart missing a measurement looks like a measurement that was never taken.',
      tags: ['observations'],
      permission: 'encounter.read',
      // The response carries the patient's sex and birth date, so it is behind
      // the demographics permission as well as the chart one.
      alsoRequires: ['patient.read'],
      pathParams: [{ name: 'id', description: 'Patient id (UUIDv7).', schema: idParamSchema }],
      query: growthQuerySchema,
      responses: [
        {
          status: 200,
          description: 'The charted points, the curves, and whatever could not be charted.',
          schema: growthResponseSchema,
        },
        {
          status: 400,
          description:
            'The patient has no sex recorded at birth, and every one of these charts is sex-specific.',
          schema: problemDocumentSchema,
        },
        { status: 401, description: 'No bearer token.', schema: problemDocumentSchema },
        {
          status: 403,
          description: 'The role lacks encounter.read.',
          schema: problemDocumentSchema,
        },
        { status: 404, description: 'No such patient.', schema: problemDocumentSchema },
      ],
    },
  ];
}

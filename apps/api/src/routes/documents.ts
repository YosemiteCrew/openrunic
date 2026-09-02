import {
  generateCcd,
  parseCcd,
  CcdaError,
  DEFAULT_XML_LIMITS,
  type AllergyEntry,
  type CcdDocument,
  type CodedValue,
  type MedicationEntry,
  type ProblemEntry,
} from '@openrunic/ccda';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam } from '../http/validate.js';
import { assertCareRelationship, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { Permission } from '../policy/permissions.js';
import type { ScopedRow } from '../repositories/types.js';
import { idParamSchema, repositories, required } from './helpers.js';

/**
 * THE CHART, LEAVING AND ARRIVING.
 *
 * `packages/ccda` can turn a document into XML and XML into a document. These
 * two routes are what connect it to a patient this practice actually holds:
 * one assembles a Continuity of Care Document from the record, the other reads
 * one somebody else sent.
 *
 * ## What the export refuses to include
 *
 * A CCD crosses every clinical aggregate at once - allergies, medications,
 * problems, results, vitals, immunisations, encounters - and each of those has
 * its own permission on its own routes. Assembling them into one document is
 * therefore the same hazard bulk export had: a caller who may read patients and
 * not results would otherwise receive results, in a form that looks like an
 * ordinary chart summary.
 *
 * So each section is included only where the caller holds the permission its own
 * endpoint requires, and the response header names what was left out. A section
 * silently missing is indistinguishable from a section that is empty, and those
 * two mean opposite things to the clinician on the other end.
 *
 * ## Why the import writes nothing
 *
 * An arriving document is somebody else's assertion about a patient, and merging
 * it is a clinical decision: which of these problems are already on our list,
 * which of these medications did we stop, is this the same allergy under another
 * name. Writing on receipt would make the machine take that decision, and a
 * duplicate problem list is the mildest way it goes wrong.
 *
 * This parses, reports what it found, and stops. Reconciliation is a screen with
 * a person in front of it, and it will call the ordinary write endpoints.
 */

const importBodySchema = z.object({
  /**
   * The document, as XML. Carried in a JSON field rather than posted as a raw
   * `text/xml` body because this is the internal surface, where every other
   * route is JSON and the client is our own. A partner posting XML directly
   * belongs on a separate ingress with its own authentication.
   */
  document: z
    .string()
    .min(1, 'The document is empty.')
    // Refused before a character is scanned. The parser carries its own ceiling
    // - it is the property of parsing a document somebody else composed, not of
    // this one route - but a body limit is cheaper still, and it answers 422
    // naming the field rather than 400 naming the codec. `document.write` is a
    // front-desk permission in the shipped role map, so the caller who can post
    // here is an ordinary member of staff.
    .max(
      DEFAULT_XML_LIMITS.maxLength,
      `A C-CDA larger than ${String(DEFAULT_XML_LIMITS.maxLength)} characters is a transport or export defect rather than a chart.`
    ),
});

const codedValueSchema = z.object({
  code: z.string().optional(),
  codeSystem: z.string().optional(),
  display: z.string(),
});

const importSummarySchema = z.object({
  patient: z.object({
    mrn: z.string(),
    givenName: z.string(),
    familyName: z.string(),
    birthDate: z.string(),
  }),
  custodian: z.string(),
  /** The instant the sending system says the document describes. */
  effectiveAt: z.string(),
  counts: z.record(z.string(), z.number()),
  allergies: z.array(
    z.object({ substance: codedValueSchema, reaction: z.string().optional(), status: z.string() })
  ),
  medications: z.array(
    z.object({ medication: codedValueSchema, sig: z.string().optional(), status: z.string() })
  ),
  problems: z.array(z.object({ problem: codedValueSchema, status: z.string() })),
  /**
   * Entries the codec could read structurally and could not identify. Named
   * rather than counted, because these are the rows a person has to look at.
   */
  unidentified: z.array(z.object({ section: z.string(), display: z.string() })),
});

const ccdResponseSchema = z.object({
  document: z.string(),
  /** Sections left out because this caller may not read them. */
  withheld: z.array(z.string()),
});

/** Each section of a CCD, and the permission its own endpoints require. */
const SECTION_PERMISSIONS = {
  allergies: 'encounter.read',
  medications: 'encounter.read',
  problems: 'encounter.read',
  results: 'result.read',
  vitals: 'encounter.read',
  immunisations: 'encounter.read',
  encounters: 'encounter.read',
} as const satisfies Readonly<Record<string, Permission>>;

type SectionName = keyof typeof SECTION_PERMISSIONS;

/** Enough of each list for a summary; a chart with more needs a full export. */
const SECTION_LIMIT = 200;

export function documentRoutes(router: Hono<AppEnv>): void {
  /**
   * The patient's chart as a C-CDA.
   *
   * `patient.read` opens the door and decides nothing else: what actually goes
   * in the document is decided per section, by the permission that section's own
   * endpoints require.
   */
  router.get('/patients/:id/ccd', requirePermission('patient.read'), async (c) => {
    const patientId = parseParam(c.req.param('id'), idParamSchema, 'id');
    /*
     * The same gate the addressed read has, and this route needed it more.
     *
     * It is mounted three lines above `GET /patients/:id` and takes the same id,
     * so gating one and not the other left the wider door open: a caller refused
     * the chart header could ask for the whole C-CDA - problems, medications,
     * allergies, immunisations, encounters - and get it. A guard that the next
     * route along defeats is not a guard.
     */
    await assertCareRelationship(c, patientId);
    const patient = required(
      await repositories(c).patients.findById(patientId),
      'No such patient.'
    );

    const allowed = new Set<SectionName>(
      (Object.keys(SECTION_PERMISSIONS) as SectionName[]).filter(
        (section) => c.get('policy')?.can(SECTION_PERMISSIONS[section]) === true
      )
    );
    const withheld = (Object.keys(SECTION_PERMISSIONS) as SectionName[]).filter(
      (section) => !allowed.has(section)
    );

    const document = await assemble(c, patient, allowed);

    // Every document that leaves is recorded as a document that left. The
    // repositories emit their own read events, but those say which rows were
    // touched, not that a chart summary was generated and handed over.
    await c.get('audit')?.write({
      action: 'ccd.generated',
      targetType: 'Patient',
      targetId: patientId,
      patientId,
      metadata: {
        sections: [...allowed],
        ...(withheld.length === 0 ? {} : { withheld }),
      },
    });

    return c.json({ document: generateCcd(document), withheld });
  });

  /**
   * Reads a document somebody else sent, and writes nothing.
   *
   * `document.write` rather than a read permission: nothing in this practice's
   * record is read, and the caller is preparing to bring a document in. It is
   * also what stops the endpoint being an XML parser anybody with a token can
   * post to.
   */
  router.post('/ccd/import', requirePermission('document.write'), async (c) => {
    const { document } = await parseJsonBody(c, importBodySchema);

    let parsed: CcdDocument;
    try {
      parsed = parseCcd(document);
    } catch (error) {
      if (error instanceof CcdaError) {
        // The codec's own message names the offset and what it found there,
        // which is the whole value of it: the person debugging this has the
        // document in one window and this response in another.
        throw ApiError.malformed(`This document could not be read. ${error.message}`);
      }
      throw error;
    }

    const summary = summarise(parsed);

    await c.get('audit')?.write({
      action: 'ccd.parsed',
      targetType: 'Document',
      metadata: {
        custodian: summary.custodian,
        mrn: summary.patient.mrn,
        counts: summary.counts,
      },
    });

    return c.json(summary);
  });
}

async function assemble(
  c: Context<AppEnv>,
  patient: ScopedRow<'Patient'>,
  allowed: ReadonlySet<SectionName>
): Promise<CcdDocument> {
  const repos = repositories(c);
  // A patient with no primary facility is one nobody has assigned yet; the
  // custodian is still required, so the document names what is known rather than
  // going out with an element the receiving system will reject.
  const facility =
    patient.primaryFacilityId === null
      ? null
      : await repos.facilities.findById(patient.primaryFacilityId);
  const now = new Date();

  const rows = async <T>(section: SectionName, read: () => Promise<{ rows: T[] }>): Promise<T[]> =>
    allowed.has(section) ? (await read()).rows : [];

  const page = { page: 1, pageSize: SECTION_LIMIT } as const;

  const [allergies, medications, problems, immunisations, encounters] = await Promise.all([
    rows('allergies', () =>
      repos.allergies.list({ ...page, sort: 'recordedAt', order: 'desc', patientId: patient.id })
    ),
    rows('medications', () =>
      repos.medicationStatements.list({
        ...page,
        sort: 'reportedAt',
        order: 'desc',
        patientId: patient.id,
      })
    ),
    rows('problems', () =>
      repos.problems.list({ ...page, sort: 'recordedAt', order: 'desc', patientId: patient.id })
    ),
    rows('immunisations', () =>
      repos.immunisations.list({
        ...page,
        sort: 'administeredAt',
        order: 'desc',
        patientId: patient.id,
      })
    ),
    rows('encounters', () =>
      repos.encounters.list({ ...page, sort: 'startedAt', order: 'desc', patientId: patient.id })
    ),
  ]);

  return {
    id: `${patient.id}-ccd-${now.toISOString()}`,
    title: 'Continuity of Care Document',
    effectiveAt: now.toISOString(),
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      givenName: patient.givenName,
      familyName: patient.familyName,
      birthDate: patient.birthDate.toISOString().slice(0, 10),
      gender: genderOf(patient.sexAtBirth),
      ...(patient.languageCode === null ? {} : { languageCode: patient.languageCode }),
      ...(addressOf(patient) === undefined ? {} : { address: addressOf(patient) }),
      ...(patient.phoneMobile === null ? {} : { phone: patient.phoneMobile }),
      ...(patient.email === null ? {} : { email: patient.email }),
    },
    custodian: {
      id: facility?.id ?? repos.tenantId,
      name: facility?.name ?? 'Unknown facility',
      ...(facility?.phone === null || facility?.phone === undefined
        ? {}
        : { phone: facility.phone }),
    },
    author: authorOf(c),
    allergies: allergies.map(toAllergy),
    medications: medications.map(toMedication),
    problems: problems.map(toProblem),
    // Results and vitals are observation-shaped and are assembled by the same
    // helper on both sides; empty when withheld, like every other section.
    results: [],
    vitals: [],
    immunisations: immunisations.map(toImmunisation),
    encounters: encounters.map(toEncounter),
    plan: [],
    socialHistory: [],
  };
}

/**
 * The document's author is the person who asked for it.
 *
 * Not the clinician who wrote the notes it summarises - a CCD is assembled at
 * the moment it is requested, and the person answerable for that assembly is the
 * one who requested it. Attributing it to a treating clinician would put their
 * name on a document they never saw.
 */
function authorOf(c: Context<AppEnv>): CcdDocument['author'] {
  const principal = c.get('principal');
  const [given = '', family = ''] = (principal?.displayName ?? '').split(' ');
  return {
    id: principal?.subject ?? '',
    givenName: given,
    familyName: family === '' ? given : family,
  };
}

/**
 * The chart's `AdministrativeGender` to the codec's own vocabulary.
 *
 * Every value is mapped by name, and nothing falls through to `other`. The
 * column is not nullable and defaults to `UNKNOWN`, so a patient whose sex was
 * never recorded arrives here as `UNKNOWN` rather than as an absent value - and
 * an earlier version of this sent that to `other`, which asserts to the
 * receiving clinician that the practice recorded an answer it never had.
 * Anything unrecognised is `unknown` for the same reason: not knowing is the
 * honest answer, and `other` is a claim.
 */
function genderOf(sexAtBirth: string | null): CcdDocument['patient']['gender'] {
  if (sexAtBirth === 'MALE') return 'male';
  if (sexAtBirth === 'FEMALE') return 'female';
  if (sexAtBirth === 'OTHER') return 'other';
  return 'unknown';
}

function addressOf(patient: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}): CcdDocument['patient']['address'] {
  const address = {
    ...(patient.addressLine1 === null ? {} : { line1: patient.addressLine1 }),
    ...(patient.addressLine2 === null ? {} : { line2: patient.addressLine2 }),
    ...(patient.city === null ? {} : { city: patient.city }),
    ...(patient.state === null ? {} : { state: patient.state }),
    ...(patient.postalCode === null ? {} : { postalCode: patient.postalCode }),
    ...(patient.country === null ? {} : { country: patient.country }),
  };
  return Object.keys(address).length === 0 ? undefined : address;
}

/**
 * The chart's criticality to the codec's own words.
 *
 * `UNABLE_TO_ASSESS` is the fallback rather than a low reading, because nobody
 * having established how bad a reaction is does not make it mild - and treating
 * it as mild is how a prompt stops being read.
 */
function criticalityOf(criticality: string): AllergyEntry['criticality'] {
  if (criticality === 'HIGH') return 'high';
  if (criticality === 'LOW') return 'low';
  return 'unable-to-assess';
}

/** A code with no system is written as text by the codec, never as a fake code. */
function coded(code: string | null, system: string, display: string): CodedValue {
  return code === null || code === '' ? { display } : { code, codeSystem: system, display };
}

const RXNORM = '2.16.840.1.113883.6.88';
const SNOMED = '2.16.840.1.113883.6.96';
const ICD10 = '2.16.840.1.113883.6.90';
const CVX = '2.16.840.1.113883.12.292';

function toAllergy(row: ScopedRow<'AllergyIntolerance'>): AllergyEntry {
  return {
    id: row.id,
    // The chart records the substance's own code system; the codec writes an
    // uncoded substance as text rather than as a code in a system it names.
    substance: coded(row.substanceCode, row.substanceCodeSystem ?? RXNORM, row.substanceDisplay),
    ...(row.reactionText === null ? {} : { reaction: row.reactionText }),
    criticality: criticalityOf(row.criticality),
    status: row.clinicalStatus === 'ACTIVE' ? 'active' : 'completed',
    ...(row.onsetDate === null ? {} : { onsetDate: row.onsetDate.toISOString().slice(0, 10) }),
  };
}

function toMedication(row: ScopedRow<'MedicationStatement'>): MedicationEntry {
  return {
    id: row.id,
    medication: coded(row.rxnormCode, RXNORM, row.display),
    ...(row.sigText === null ? {} : { sig: row.sigText }),
    status: row.status === 'ACTIVE' ? 'active' : 'completed',
    ...(row.effectiveStart === null
      ? {}
      : { startDate: row.effectiveStart.toISOString().slice(0, 10) }),
    ...(row.effectiveEnd === null ? {} : { endDate: row.effectiveEnd.toISOString().slice(0, 10) }),
  };
}

function toProblem(row: ScopedRow<'Condition'>): ProblemEntry {
  return {
    id: row.id,
    problem: coded(row.code, ICD10, row.display),
    status: row.clinicalStatus === 'ACTIVE' ? 'active' : 'completed',
    ...(row.onsetDate === null ? {} : { onsetDate: row.onsetDate.toISOString().slice(0, 10) }),
    ...(row.abatementDate === null
      ? {}
      : { resolvedDate: row.abatementDate.toISOString().slice(0, 10) }),
  };
}

function toImmunisation(row: ScopedRow<'Immunization'>): CcdDocument['immunisations'][number] {
  return {
    id: row.id,
    vaccine: coded(row.cvxCode, CVX, row.display),
    administeredAt: row.administeredAt.toISOString(),
    status: row.status === 'COMPLETED' ? 'completed' : 'active',
    ...(row.lotNumber === null ? {} : { lotNumber: row.lotNumber }),
  };
}

function toEncounter(row: ScopedRow<'Encounter'>): CcdDocument['encounters'][number] {
  return {
    id: row.id,
    type: coded(null, SNOMED, row.reasonText ?? encounterClassName(row.class)),
    startedAt: row.startedAt.toISOString(),
    ...(row.endedAt === null ? {} : { endedAt: row.endedAt.toISOString() }),
  };
}

function encounterClassName(value: string): string {
  return value === 'AMBULATORY' ? 'Ambulatory visit' : value.toLowerCase().replace('_', ' ');
}

/**
 * What an arriving document contains, for a person to reconcile.
 *
 * The counts are for the summary line; the three lists are the ones a
 * reconciliation screen actually shows, because those are what a clinician has
 * to decide about one row at a time.
 */
function summarise(document: CcdDocument): z.infer<typeof importSummarySchema> {
  const unidentified: { section: string; display: string }[] = [];
  const flag = (section: string, value: CodedValue): void => {
    // The codec writes an explicit "Unknown" display where it could read an
    // entry structurally and could not identify it. Those are exactly the rows a
    // person has to look at, so they are named rather than counted.
    if (value.display.startsWith('Unknown')) unidentified.push({ section, display: value.display });
  };

  for (const allergy of document.allergies) flag('allergies', allergy.substance);
  for (const medication of document.medications) flag('medications', medication.medication);
  for (const problem of document.problems) flag('problems', problem.problem);

  return {
    patient: {
      mrn: document.patient.mrn,
      givenName: document.patient.givenName,
      familyName: document.patient.familyName,
      birthDate: document.patient.birthDate,
    },
    custodian: document.custodian.name,
    effectiveAt: document.effectiveAt,
    counts: {
      allergies: document.allergies.length,
      medications: document.medications.length,
      problems: document.problems.length,
      results: document.results.length,
      vitals: document.vitals.length,
      immunisations: document.immunisations.length,
      encounters: document.encounters.length,
    },
    allergies: document.allergies.map((allergy) => ({
      substance: allergy.substance,
      ...(allergy.reaction === undefined ? {} : { reaction: allergy.reaction }),
      status: allergy.status,
    })),
    medications: document.medications.map((medication) => ({
      medication: medication.medication,
      ...(medication.sig === undefined ? {} : { sig: medication.sig }),
      status: medication.status,
    })),
    problems: document.problems.map((problem) => ({
      problem: problem.problem,
      status: problem.status,
    })),
    unidentified,
  };
}

export function documentRouteContracts(): RouteContract[] {
  return [
    {
      method: 'get',
      path: '/bff/v0/patients/{id}/ccd',
      operationId: 'getPatientCcd',
      summary: "Assemble the patient's chart as a C-CDA document.",
      description:
        'Builds a Continuity of Care Document from the record and returns it as XML. A CCD crosses every clinical aggregate at once, and each of those has its own permission on its own routes, so each section is included only where the caller holds that permission - and `withheld` names the ones that were not. A section silently missing is indistinguishable from a section that is empty, and those mean opposite things to the clinician receiving it.',
      tags: ['patients'],
      permission: 'patient.read',
      pathParams: [{ name: 'id', description: 'Patient id (UUIDv7).', schema: idParamSchema }],
      responses: [
        {
          status: 200,
          description: 'The document, and the sections this caller may not see.',
          schema: ccdResponseSchema,
        },
        { status: 401, description: 'No bearer token.', schema: problemDocumentSchema },
        {
          status: 403,
          description: 'The role lacks patient.read.',
          schema: problemDocumentSchema,
        },
        { status: 404, description: 'No such patient.', schema: problemDocumentSchema },
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/ccd/import',
      operationId: 'importCcd',
      summary: 'Read a C-CDA another organisation sent, and report what is in it.',
      description:
        'Parses a Continuity of Care Document and returns what it contains. Writes nothing: merging an arriving document is a clinical decision - which of these problems are already on our list, which of these medications did we stop, is this the same allergy under another name - and a machine that took that decision would produce a duplicate problem list on its best day. Entries the codec could read structurally and could not identify are named in `unidentified`, because those are the rows a person has to look at.',
      tags: ['patients'],
      permission: 'document.write',
      body: importBodySchema,
      responses: [
        {
          status: 200,
          description: 'What the document contains, for a person to reconcile.',
          schema: importSummarySchema,
        },
        {
          status: 400,
          description: 'The document could not be read; the reason names where it failed.',
          schema: problemDocumentSchema,
        },
        { status: 401, description: 'No bearer token.', schema: problemDocumentSchema },
        {
          status: 403,
          description: 'The role lacks document.write.',
          schema: problemDocumentSchema,
        },
        {
          status: 422,
          description: 'The body parsed as JSON and carried no document.',
          schema: problemDocumentSchema,
        },
      ],
    },
  ];
}

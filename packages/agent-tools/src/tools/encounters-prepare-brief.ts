import { z } from 'zod';

import { ToolError } from '../errors.js';
import { defineTool, type ToolContext } from '../registry.js';

import { assertChartBound } from './patient-shared.js';
import { apiListSchema, sourceRefSchema } from './shared.js';

/**
 * Prepares a source-linked encounter brief for a clinician.
 *
 * The brief summarises the patient's existing records that are relevant to the
 * upcoming encounter, with every point linked to its source so the clinician
 * can verify it directly. It reads and only reads - no clinical judgment is
 * applied here; the model chooses which encounter to prepare for and nothing
 * else.
 *
 * The tool fetches the encounter, then reads the patient's active problems,
 * current medications, active allergies, recent immunisations, and recent
 * observations. Each section cites its source row so the rendering layer can
 * make every claim verifiable.
 */

const BRIEF_SECTIONS = [
  'active-problems',
  'current-medications',
  'active-allergies',
  'recent-immunisations',
  'recent-observations',
  'recent-encounters',
] as const;

const SECTION_STATES = ['present', 'empty'] as const;

const encounterSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  providerId: z.string(),
  status: z.string(),
  class: z.string(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
});

type Encounter = z.infer<typeof encounterSchema>;

const problemSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  category: z.string(),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  snomedCode: z.string().nullable(),
  clinicalStatus: z.string(),
  verificationStatus: z.string(),
  onsetDate: z.string().nullable(),
  abatementDate: z.string().nullable(),
  updatedAt: z.string(),
});

type Problem = z.infer<typeof problemSchema>;

const medicationStatementSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  rxnormCode: z.string().nullable(),
  display: z.string(),
  sigText: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  effectiveStart: z.string().nullable(),
  effectiveEnd: z.string().nullable(),
  updatedAt: z.string(),
});

type MedicationStatement = z.infer<typeof medicationStatementSchema>;

const allergySchema = z.object({
  id: z.string(),
  patientId: z.string(),
  type: z.string(),
  category: z.string(),
  criticality: z.string(),
  clinicalStatus: z.string(),
  substanceCode: z.string().nullable(),
  substanceCodeSystem: z.string().nullable(),
  substanceDisplay: z.string(),
  reactionCodes: z.array(z.string()),
  reactionText: z.string().nullable(),
  severity: z.string().nullable(),
  onsetDate: z.string().nullable(),
  updatedAt: z.string(),
});

type Allergy = z.infer<typeof allergySchema>;

const immunisationSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  status: z.string(),
  cvxCode: z.string(),
  display: z.string(),
  lotNumber: z.string().nullable(),
  administeredAt: z.string(),
  updatedAt: z.string(),
});

type Immunisation = z.infer<typeof immunisationSchema>;

const observationSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  category: z.string(),
  status: z.string(),
  loincCode: z.string().nullable(),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  valueNumber: z.number().nullable(),
  valueText: z.string().nullable(),
  valueCode: z.string().nullable(),
  unit: z.string().nullable(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  interpretationCode: z.string().nullable(),
  effectiveAt: z.string(),
  updatedAt: z.string(),
});

type Observation = z.infer<typeof observationSchema>;

const recentEncounterSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  status: z.string(),
  class: z.string(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
});

type RecentEncounter = z.infer<typeof recentEncounterSchema>;

const sectionItemSchema = z.strictObject({
  section: z.enum(BRIEF_SECTIONS),
  state: z.enum(SECTION_STATES),
  count: z.int().min(0),
  /** Human-readable reason when state is 'empty'. */
  reason: z.string().max(256).nullable(),
  /** Where the answer was read from. Null only when there is nothing to point at. */
  source: sourceRefSchema.nullable(),
});

type SectionItem = z.infer<typeof sectionItemSchema>;

const outputSchema = z.strictObject({
  queryRan: z.string().max(512),
  encounterId: z.string(),
  patientId: z.string(),
  /** The encounter's `updatedAt`, the same on a read before the sections were
   *  checked and on a read after. An encounter that changed in between is not
   *  described: the tool fails and asks for a fresh read rather than answer
   *  from two versions. */
  sourceVersion: z.string(),
  encounterStatus: z.string().max(32),
  encounterClass: z.string().max(32),
  encounterReason: z.string().max(256).nullable(),
  startedAt: z.string(),
  sections: z.array(sectionItemSchema).length(BRIEF_SECTIONS.length),
});

export type EncounterBrief = z.infer<typeof outputSchema>;

export const encountersPrepareBrief = defineTool({
  id: 'encounters.prepareBrief',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['encounter.read'],
  surfaces: ['staff'],
  summary:
    "Prepares a source-linked brief of the patient's existing records for an upcoming encounter.",
  activityLabel: 'Preparing the encounter brief',
  maxResultRows: 1,
  compartmentBound: true,
  input: z.strictObject({ encounterId: z.uuid() }),
  output: outputSchema,

  async execute(input, context) {
    assertChartBound(context, 'encounters.prepareBrief');

    const encounter = await readEncounter(input.encounterId, context);

    const [problems, medications, allergies, immunisations, observations, recentEncounters] =
      await Promise.all([
        readProblems(encounter.patientId, context),
        readMedications(encounter.patientId, context),
        readAllergies(encounter.patientId, context),
        readImmunisations(encounter.patientId, context),
        readObservations(encounter.patientId, context),
        readRecentEncounters(encounter.patientId, input.encounterId, context),
      ]);

    const current = await readEncounter(input.encounterId, context);
    if (current.updatedAt !== encounter.updatedAt) {
      throw new ToolError(
        'AGENT_TOOL_FAILED',
        'The encounter changed while it was being read. Ask again for its current state.',
        { toolId: 'encounters.prepareBrief' }
      );
    }

    return buildBrief(encounter, {
      problems,
      medications,
      allergies,
      immunisations,
      observations,
      recentEncounters,
    });
  },
});

async function readEncounter(encounterId: string, context: ToolContext): Promise<Encounter> {
  return encounterSchema.parse(
    await context.api.call({ method: 'GET', path: `/bff/v0/encounters/${encounterId}` }, context)
  );
}

async function readProblems(patientId: string, context: ToolContext): Promise<Problem[]> {
  const body = await context.api.call(
    {
      method: 'GET',
      path: '/bff/v0/problems',
      query: {
        patientId,
        clinicalStatus: 'ACTIVE',
        pageSize: 50,
        sort: 'onsetDate',
        order: 'desc',
      },
    },
    context
  );
  const parsed = apiListSchema(problemSchema).safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'encounters.prepareBrief read problems the API described differently than expected.',
      { toolId: 'encounters.prepareBrief' }
    );
  }
  return parsed.data.data;
}

async function readMedications(
  patientId: string,
  context: ToolContext
): Promise<MedicationStatement[]> {
  const body = await context.api.call(
    {
      method: 'GET',
      path: '/bff/v0/medications/statements',
      query: { patientId, status: 'ACTIVE', pageSize: 50, sort: 'reportedAt', order: 'desc' },
    },
    context
  );
  const parsed = apiListSchema(medicationStatementSchema).safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'encounters.prepareBrief read medications the API described differently than expected.',
      { toolId: 'encounters.prepareBrief' }
    );
  }
  return parsed.data.data;
}

async function readAllergies(patientId: string, context: ToolContext): Promise<Allergy[]> {
  const body = await context.api.call(
    {
      method: 'GET',
      path: '/bff/v0/allergies',
      query: {
        patientId,
        clinicalStatus: 'ACTIVE',
        pageSize: 50,
        sort: 'recordedAt',
        order: 'desc',
      },
    },
    context
  );
  const parsed = apiListSchema(allergySchema).safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'encounters.prepareBrief read allergies the API described differently than expected.',
      { toolId: 'encounters.prepareBrief' }
    );
  }
  return parsed.data.data;
}

async function readImmunisations(patientId: string, context: ToolContext): Promise<Immunisation[]> {
  const body = await context.api.call(
    {
      method: 'GET',
      path: '/bff/v0/immunisations',
      query: { patientId, pageSize: 20, sort: 'administeredAt', order: 'desc' },
    },
    context
  );
  const parsed = apiListSchema(immunisationSchema).safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'encounters.prepareBrief read immunisations the API described differently than expected.',
      { toolId: 'encounters.prepareBrief' }
    );
  }
  return parsed.data.data;
}

async function readObservations(patientId: string, context: ToolContext): Promise<Observation[]> {
  const body = await context.api.call(
    {
      method: 'GET',
      path: '/bff/v0/observations',
      query: { patientId, pageSize: 20, sort: 'effectiveAt', order: 'desc' },
    },
    context
  );
  const parsed = apiListSchema(observationSchema).safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'encounters.prepareBrief read observations the API described differently than expected.',
      { toolId: 'encounters.prepareBrief' }
    );
  }
  return parsed.data.data;
}

async function readRecentEncounters(
  patientId: string,
  currentEncounterId: string,
  context: ToolContext
): Promise<RecentEncounter[]> {
  const body = await context.api.call(
    {
      method: 'GET',
      path: '/bff/v0/encounters',
      query: { patientId, pageSize: 10, sort: 'startedAt', order: 'desc' },
    },
    context
  );
  const parsed = apiListSchema(recentEncounterSchema).safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'encounters.prepareBrief read encounters the API described differently than expected.',
      { toolId: 'encounters.prepareBrief' }
    );
  }
  return parsed.data.data.filter((e) => e.id !== currentEncounterId);
}

function buildBrief(
  encounter: Encounter,
  data: {
    problems: Problem[];
    medications: MedicationStatement[];
    allergies: Allergy[];
    immunisations: Immunisation[];
    observations: Observation[];
    recentEncounters: RecentEncounter[];
  }
): EncounterBrief {
  const sections: SectionItem[] = [
    buildSection('active-problems', data.problems, 'Problem', 'onsetDate'),
    buildSection('current-medications', data.medications, 'MedicationStatement', 'reportedAt'),
    buildSection('active-allergies', data.allergies, 'Allergy', 'recordedAt'),
    buildSection('recent-immunisations', data.immunisations, 'Immunisation', 'administeredAt'),
    buildSection('recent-observations', data.observations, 'Observation', 'effectiveAt'),
    buildSection('recent-encounters', data.recentEncounters, 'Encounter', 'startedAt'),
  ];

  const reasonText = encounter.reasonText ?? encounter.reasonCode ?? null;

  return {
    queryRan: `encounter brief for ${encounter.id}`,
    encounterId: encounter.id,
    patientId: encounter.patientId,
    sourceVersion: encounter.updatedAt,
    encounterStatus: encounter.status,
    encounterClass: encounter.class,
    encounterReason: reasonText,
    startedAt: encounter.startedAt,
    sections,
  };
}

function buildSection<T extends { id: string; updatedAt: string }>(
  section: (typeof BRIEF_SECTIONS)[number],
  items: readonly T[],
  resourceType: string,
  dateField: string
): SectionItem {
  if (items.length === 0) {
    return {
      section,
      state: 'empty',
      count: 0,
      reason: `No ${section.replace('-', ' ')} recorded.`,
      source: null,
    };
  }

  // items.length > 0 is guaranteed here by the check above
  const latest = items[0] as T;
  return {
    section,
    state: 'present',
    count: items.length,
    reason: null,
    source: { resourceType, resourceId: latest.id, field: dateField },
  };
}

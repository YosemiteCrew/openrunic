import { describe, expect, it } from 'vitest';

import { createV1Registry } from '../catalogue.js';
import { resolveTools } from '../resolve.js';
import {
  TEST_PATIENT_ID,
  recordingApiClient,
  stubPrincipal,
  stubToolContext,
} from '../testing/index.js';

import { encountersPrepareBrief, type EncounterBrief } from './encounters-prepare-brief.js';

const ENCOUNTER_ID = '018f2b40-0000-7000-8000-00000000e001';
const PROBLEM_ID = '018f2b40-0000-7000-8000-00000000p001';
const MEDICATION_ID = '018f2b40-0000-7000-8000-00000000m001';
const ALLERGY_ID = '018f2b40-0000-7000-8000-00000000a001';
const IMMUNISATION_ID = '018f2b40-0000-7000-8000-00000000i001';
const OBSERVATION_ID = '018f2b40-0000-7000-8000-00000000o001';
const RECENT_ENCOUNTER_ID = '018f2b40-0000-7000-8000-00000000r001';
const CLINICIAN_ID = '018f2b40-0000-7000-8000-00000000c001';

function encounter(overrides: Record<string, unknown> = {}) {
  return {
    id: ENCOUNTER_ID,
    patientId: TEST_PATIENT_ID,
    providerId: CLINICIAN_ID,
    status: 'PLANNED',
    class: 'AMBULATORY',
    reasonCode: 'Z00.00',
    reasonText: 'Annual wellness visit',
    startedAt: '2026-09-15T10:00:00.000Z',
    endedAt: null,
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function problem(overrides: Record<string, unknown> = {}) {
  return {
    id: PROBLEM_ID,
    patientId: TEST_PATIENT_ID,
    category: 'ENCOUNTER_DIAGNOSIS',
    code: 'I10',
    codeSystem: 'ICD-10-CM',
    display: 'Essential (primary) hypertension',
    snomedCode: '38341003',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    onsetDate: '2025-01-15',
    abatementDate: null,
    updatedAt: '2025-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function medication(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDICATION_ID,
    patientId: TEST_PATIENT_ID,
    rxnormCode: '860975',
    display: 'Lisinopril 10mg tablet',
    sigText: 'Take 1 tablet by mouth daily',
    status: 'ACTIVE',
    source: 'PATIENT_REPORTED',
    effectiveStart: '2025-02-01',
    effectiveEnd: null,
    updatedAt: '2025-02-01T10:00:00.000Z',
    ...overrides,
  };
}

function allergy(overrides: Record<string, unknown> = {}) {
  return {
    id: ALLERGY_ID,
    patientId: TEST_PATIENT_ID,
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: '7982',
    substanceCodeSystem: 'RxNorm',
    substanceDisplay: 'Penicillin',
    reactionCodes: ['R06.2'],
    reactionText: 'Wheezing',
    severity: 'MODERATE',
    onsetDate: '2020-03-10',
    updatedAt: '2020-03-10T10:00:00.000Z',
    ...overrides,
  };
}

function immunisation(overrides: Record<string, unknown> = {}) {
  return {
    id: IMMUNISATION_ID,
    patientId: TEST_PATIENT_ID,
    status: 'COMPLETED',
    cvxCode: '158',
    display: 'Influenza, injectable, quadrivalent',
    lotNumber: 'FLU2026-001',
    administeredAt: '2025-10-15T10:00:00.000Z',
    updatedAt: '2025-10-15T10:00:00.000Z',
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: OBSERVATION_ID,
    patientId: TEST_PATIENT_ID,
    category: 'VITAL_SIGNS',
    status: 'FINAL',
    loincCode: '8480-6',
    code: '8480-6',
    codeSystem: 'LOINC',
    display: 'Systolic blood pressure',
    valueNumber: 138,
    valueText: null,
    valueCode: null,
    unit: 'mmHg',
    referenceLow: 90,
    referenceHigh: 120,
    interpretationCode: 'H',
    effectiveAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function recentEncounter(overrides: Record<string, unknown> = {}) {
  return {
    id: RECENT_ENCOUNTER_ID,
    patientId: TEST_PATIENT_ID,
    status: 'COMPLETED',
    class: 'AMBULATORY',
    reasonCode: 'Z00.01',
    reasonText: 'Follow-up visit',
    startedAt: '2026-06-01T10:00:00.000Z',
    endedAt: '2026-06-01T10:30:00.000Z',
    updatedAt: '2026-06-01T10:30:00.000Z',
    ...overrides,
  };
}

async function prepareBrief(
  enc: Record<string, unknown>,
  data: {
    problems?: Record<string, unknown>[];
    medications?: Record<string, unknown>[];
    allergies?: Record<string, unknown>[];
    immunisations?: Record<string, unknown>[];
    observations?: Record<string, unknown>[];
    recentEncounters?: Record<string, unknown>[];
  } = {}
) {
  const {
    problems = [problem()],
    medications = [medication()],
    allergies = [allergy()],
    immunisations = [immunisation()],
    observations = [observation()],
    recentEncounters = [recentEncounter()],
  } = data;

  const api = recordingApiClient((request) => {
    if (request.path === `/bff/v0/encounters/${ENCOUNTER_ID}`) return enc;
    if (request.path === '/bff/v0/problems')
      return { data: problems, page: { total: problems.length } };
    if (request.path === '/bff/v0/medications/statements')
      return { data: medications, page: { total: medications.length } };
    if (request.path === '/bff/v0/allergies')
      return { data: allergies, page: { total: allergies.length } };
    if (request.path === '/bff/v0/immunisations')
      return { data: immunisations, page: { total: immunisations.length } };
    if (request.path === '/bff/v0/observations')
      return { data: observations, page: { total: observations.length } };
    if (request.path === '/bff/v0/encounters')
      return { data: [...recentEncounters, enc], page: { total: recentEncounters.length + 1 } };
    return { data: [], page: { total: 0 } };
  });

  const context = stubToolContext({
    api,
    principal: stubPrincipal({
      compartment: { patientId: TEST_PATIENT_ID },
      scopes: [
        'patient.read',
        'appointment.read',
        'appointment.write',
        'encounter.read',
        'encounter.write',
        'task.read',
        'task.write',
        'form.read',
        'form.write',
      ],
    }),
  });

  const result = (await encountersPrepareBrief.run(
    { encounterId: ENCOUNTER_ID },
    context
  )) as EncounterBrief;
  return { result, api };
}

function sectionState(
  result: Awaited<ReturnType<typeof prepareBrief>>['result'],
  name: string
): string | undefined {
  return result.sections.find((entry) => entry.section === name)?.state;
}

function sectionCount(
  result: Awaited<ReturnType<typeof prepareBrief>>['result'],
  name: string
): number | undefined {
  return result.sections.find((entry) => entry.section === name)?.count;
}

function sectionSource(
  result: Awaited<ReturnType<typeof prepareBrief>>['result'],
  name: string
): { resourceType: string; resourceId: string; field: string } | null {
  return result.sections.find((entry) => entry.section === name)?.source ?? null;
}

describe('encounters.prepareBrief', () => {
  it('reads the encounter the caller selected, with the caller credential, and nothing else', async () => {
    const { api } = await prepareBrief(encounter());
    expect(api.calls.map((call) => call.request.path)).toEqual([
      `/bff/v0/encounters/${ENCOUNTER_ID}`,
      '/bff/v0/problems',
      '/bff/v0/medications/statements',
      '/bff/v0/allergies',
      '/bff/v0/immunisations',
      '/bff/v0/observations',
      '/bff/v0/encounters',
      `/bff/v0/encounters/${ENCOUNTER_ID}`,
    ]);
    for (const call of api.calls) {
      expect(call.context.credential.authorization).toBe('Bearer test-token');
    }
  });

  it('includes all six sections in the brief', async () => {
    const { result } = await prepareBrief(encounter());
    expect(result.sections.map((s) => s.section)).toEqual([
      'active-problems',
      'current-medications',
      'active-allergies',
      'recent-immunisations',
      'recent-observations',
      'recent-encounters',
    ]);
  });

  it('marks sections as present when data exists and cites the latest record', async () => {
    const { result } = await prepareBrief(encounter());
    expect(sectionState(result, 'active-problems')).toBe('present');
    expect(sectionCount(result, 'active-problems')).toBe(1);
    expect(sectionSource(result, 'active-problems')).toEqual({
      resourceType: 'Problem',
      resourceId: PROBLEM_ID,
      field: 'onsetDate',
    });
    expect(sectionState(result, 'current-medications')).toBe('present');
    expect(sectionSource(result, 'current-medications')?.resourceType).toBe('MedicationStatement');
    expect(sectionSource(result, 'active-allergies')?.resourceType).toBe('Allergy');
    expect(sectionSource(result, 'recent-immunisations')?.resourceType).toBe('Immunisation');
    expect(sectionSource(result, 'recent-observations')?.resourceType).toBe('Observation');
    expect(sectionSource(result, 'recent-encounters')?.resourceType).toBe('Encounter');
  });

  it('marks sections as empty when no data exists and gives a reason', async () => {
    const { result } = await prepareBrief(encounter(), {
      problems: [],
      medications: [],
      allergies: [],
      immunisations: [],
      observations: [],
      recentEncounters: [],
    });
    for (const section of [
      'active-problems',
      'current-medications',
      'active-allergies',
      'recent-immunisations',
      'recent-observations',
      'recent-encounters',
    ] as const) {
      expect(sectionState(result, section)).toBe('empty');
      expect(sectionCount(result, section)).toBe(0);
      expect(sectionSource(result, section)).toBeNull();
      const sectionEntry = result.sections.find((s) => s.section === section);
      expect(sectionEntry?.reason).toContain('No ');
      expect(sectionEntry?.reason).toContain('recorded');
    }
  });

  it('carries the encounter version so a stale answer can be dropped', async () => {
    const { result } = await prepareBrief(encounter({ updatedAt: '2026-09-12T08:00:00.000Z' }));
    expect(result.sourceVersion).toBe('2026-09-12T08:00:00.000Z');
    expect(result.encounterId).toBe(ENCOUNTER_ID);
    expect(result.patientId).toBe(TEST_PATIENT_ID);
    expect(result.encounterStatus).toBe('PLANNED');
    expect(result.encounterClass).toBe('AMBULATORY');
    expect(result.encounterReason).toBe('Annual wellness visit');
    expect(result.startedAt).toBe('2026-09-15T10:00:00.000Z');
  });

  describe('an encounter that changes while sections are checked', () => {
    function reads(...encounters: Record<string, unknown>[]) {
      const queue = [...encounters];
      const api = recordingApiClient((request) => {
        if (request.path === `/bff/v0/encounters/${ENCOUNTER_ID}`) return queue.shift();
        if (request.path === '/bff/v0/problems') return { data: [problem()], page: { total: 1 } };
        if (request.path === '/bff/v0/medications/statements')
          return { data: [medication()], page: { total: 1 } };
        if (request.path === '/bff/v0/allergies') return { data: [allergy()], page: { total: 1 } };
        if (request.path === '/bff/v0/immunisations')
          return { data: [immunisation()], page: { total: 1 } };
        if (request.path === '/bff/v0/observations')
          return { data: [observation()], page: { total: 1 } };
        if (request.path === '/bff/v0/encounters')
          return { data: [recentEncounter(), queue[0] || encounter()], page: { total: 2 } };
        return { data: [], page: { total: 0 } };
      });
      const context = stubToolContext({
        api,
        principal: stubPrincipal({ compartment: { patientId: TEST_PATIENT_ID } }),
      });
      return {
        api,
        run: () => encountersPrepareBrief.run({ encounterId: ENCOUNTER_ID }, context),
      };
    }

    const before = encounter({ updatedAt: '2026-09-12T08:00:00.000Z' });

    it('is not described from the read before the change', async () => {
      const after = encounter({ updatedAt: '2026-09-12T08:00:01.000Z' });
      const { api, run } = reads(before, after);

      await expect(run()).rejects.toMatchObject({
        code: 'AGENT_TOOL_FAILED',
        toolId: 'encounters.prepareBrief',
        message: 'The encounter changed while it was being read. Ask again for its current state.',
      });
      expect(api.calls.map((call) => call.request.path).slice(-1)[0]).toBe(
        `/bff/v0/encounters/${ENCOUNTER_ID}`
      );
    });

    it('is described when the second read finds the same version', async () => {
      const { api, run } = reads(before, before);

      const result = (await run()) as EncounterBrief;

      expect(result.sourceVersion).toBe('2026-09-12T08:00:00.000Z');
      expect(
        api.calls.filter((c) => c.request.path === `/bff/v0/encounters/${ENCOUNTER_ID}`)
      ).toHaveLength(2);
    });
  });

  it('refuses to read with no chart bound to the turn', async () => {
    const api = recordingApiClient(() => encounter());
    await expect(
      encountersPrepareBrief.run(
        { encounterId: ENCOUNTER_ID },
        stubToolContext({
          api,
          principal: stubPrincipal({
            compartment: {},
            scopes: [
              'patient.read',
              'appointment.read',
              'appointment.write',
              'encounter.read',
              'encounter.write',
              'task.read',
              'task.write',
              'form.read',
              'form.write',
            ],
          }),
        })
      )
    ).rejects.toMatchObject({ code: 'AGENT_COMPARTMENT_VIOLATION' });
    expect(api.calls).toHaveLength(0);
  });

  it('aborts when the encounter belongs to a chart other than the open one', async () => {
    await expect(
      prepareBrief(encounter({ patientId: '018f2b40-0000-7000-8000-0000000000aa' }))
    ).rejects.toMatchObject({ code: 'AGENT_COMPARTMENT_VIOLATION' });
  });

  it('is a read with no approval step, so it can change nothing', () => {
    expect(encountersPrepareBrief).toMatchObject({
      tier: 'READ',
      trustClass: 'reader',
      approval: 'never',
      sideEffect: 'read',
    });
  });

  it('reaches a clinician holding the required scopes', () => {
    const registry = createV1Registry();
    const scopes = ['encounter.read'];
    const ids = (roleIds: string[], held: string[]) =>
      resolveTools(registry, stubPrincipal({ roleIds, scopes: held })).map((tool) => tool.id);

    expect(ids(['clinician'], scopes)).toContain('encounters.prepareBrief');
    expect(ids(['clinician'], [])).not.toContain('encounters.prepareBrief');
    for (const role of ['front-desk', 'biller', 'admin']) {
      expect(ids([role], scopes)).not.toContain('encounters.prepareBrief');
    }
  });

  it('filters out the current encounter from recent encounters', async () => {
    const { result } = await prepareBrief(encounter(), {
      recentEncounters: [
        recentEncounter({ id: '018f2b40-0000-7000-8000-00000000r001' }),
        recentEncounter({ id: '018f2b40-0000-7000-8000-00000000r002' }),
      ],
    });
    expect(sectionCount(result, 'recent-encounters')).toBe(2);
    const section = result.sections.find((s) => s.section === 'recent-encounters');
    expect(section?.source?.resourceId).toBe('018f2b40-0000-7000-8000-00000000r001');
  });
});

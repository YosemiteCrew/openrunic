import type { CcdDocument } from '../domain.js';
import { CODE_SYSTEMS } from '../oids.js';

/**
 * One synthetic chart, exercised in both directions.
 *
 * Invented people and invented identifiers throughout, per the repository's
 * synthetic-data-only rule. The values are chosen to be awkward rather than
 * tidy: an allergy with no code, a medication still running, a string-valued
 * result beside a numeric one, an encounter that has not ended. Every one of
 * those is a branch somewhere in the codec, and a fixture made of clean data
 * exercises none of them.
 */
export function sampleDocument(): CcdDocument {
  return {
    id: 'ccd-0001',
    title: 'Continuity of Care Document',
    effectiveAt: '2026-08-14T09:30:00.000Z',
    patient: {
      id: 'patient-0001',
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: '1994-03-02',
      gender: 'female',
      languageCode: 'en-US',
      address: {
        line1: '1 Example Street',
        city: 'Testville',
        state: 'CA',
        postalCode: '90001',
        country: 'US',
      },
      phone: '+15550100',
      email: 'testina@example.invalid',
    },
    custodian: {
      id: 'org-0001',
      name: 'Example Family Practice',
      phone: '+15550111',
      address: { line1: '2 Example Street', city: 'Testville', state: 'CA', postalCode: '90001' },
    },
    author: {
      id: 'user-0001',
      givenName: 'Sam',
      familyName: 'Clinician',
      npi: '1234567893',
    },
    coveringPeriod: { start: '2026-01-01T00:00:00.000Z', end: '2026-08-14T00:00:00.000Z' },
    allergies: [
      {
        id: 'allergy-1',
        substance: { code: '7980', codeSystem: CODE_SYSTEMS.RXNORM.oid, display: 'Penicillin' },
        reaction: 'Anaphylaxis',
        criticality: 'high',
        status: 'active',
        onsetDate: '2019-05-04',
      },
      {
        // No code at all: the practice recorded a name and nothing else, which
        // is the majority of allergy entries in a real chart.
        id: 'allergy-2',
        substance: { display: 'Shellfish' },
        status: 'active',
      },
    ],
    medications: [
      {
        id: 'medication-1',
        medication: {
          code: '860975',
          codeSystem: CODE_SYSTEMS.RXNORM.oid,
          display: 'Metformin 500 mg oral tablet',
        },
        sig: 'One tablet twice daily with food',
        status: 'active',
        startDate: '2025-11-02',
      },
      {
        id: 'medication-2',
        medication: { display: 'Amoxicillin 500 mg' },
        status: 'completed',
        startDate: '2026-02-01',
        endDate: '2026-02-11',
      },
    ],
    problems: [
      {
        id: 'problem-1',
        problem: {
          code: 'E11.9',
          codeSystem: CODE_SYSTEMS.ICD10CM.oid,
          display: 'Type 2 diabetes mellitus without complications',
        },
        status: 'active',
        onsetDate: '2023-06-01',
      },
    ],
    results: [
      {
        id: 'result-1',
        panel: {
          code: '24323-8',
          codeSystem: CODE_SYSTEMS.LOINC.oid,
          display: 'Comprehensive metabolic panel',
        },
        effectiveAt: '2026-07-01T10:00:00.000Z',
        observations: [
          {
            id: 'observation-1',
            code: { code: '2345-7', codeSystem: CODE_SYSTEMS.LOINC.oid, display: 'Glucose' },
            value: '6.2',
            unit: 'mmol/L',
            effectiveAt: '2026-07-01T10:00:00.000Z',
            interpretation: 'H',
            referenceRange: '3.9 - 5.5 mmol/L',
          },
          {
            // Qualitative, so it has no unit and must not be written as a
            // physical quantity.
            id: 'observation-2',
            code: { code: '5811-5', codeSystem: CODE_SYSTEMS.LOINC.oid, display: 'Ketones' },
            value: 'negative',
            effectiveAt: '2026-07-01T10:00:00.000Z',
          },
        ],
      },
    ],
    vitals: [
      {
        id: 'vital-1',
        panel: { code: '46680005', codeSystem: CODE_SYSTEMS.SNOMED.oid, display: 'Vital signs' },
        effectiveAt: '2026-08-14T09:00:00.000Z',
        observations: [
          {
            id: 'vital-observation-1',
            code: {
              code: '8480-6',
              codeSystem: CODE_SYSTEMS.LOINC.oid,
              display: 'Systolic blood pressure',
            },
            value: '128',
            unit: 'mm[Hg]',
            effectiveAt: '2026-08-14T09:00:00.000Z',
          },
        ],
      },
    ],
    immunisations: [
      {
        id: 'immunisation-1',
        vaccine: {
          code: '150',
          codeSystem: CODE_SYSTEMS.CVX.oid,
          display: 'Influenza, injectable',
        },
        administeredAt: '2025-10-12T00:00:00.000Z',
        status: 'completed',
        lotNumber: 'LOT-000A',
      },
    ],
    encounters: [
      {
        id: 'encounter-1',
        type: { code: '99213', codeSystem: CODE_SYSTEMS.CPT.oid, display: 'Office visit' },
        startedAt: '2026-08-14T09:00:00.000Z',
        facilityName: 'Example Family Practice',
      },
    ],
    plan: [
      {
        id: 'plan-1',
        activity: { code: '73761001', codeSystem: CODE_SYSTEMS.SNOMED.oid, display: 'Colonoscopy' },
        scheduledFor: '2026-11-02T00:00:00.000Z',
        status: 'active',
      },
    ],
    socialHistory: [
      {
        id: 'social-1',
        observation: {
          code: '72166-2',
          codeSystem: CODE_SYSTEMS.LOINC.oid,
          display: 'Tobacco smoking status',
        },
        value: {
          code: '266919005',
          codeSystem: CODE_SYSTEMS.SNOMED.oid,
          display: 'Never smoked tobacco',
        },
        effectiveAt: '2026-08-14T09:00:00.000Z',
      },
    ],
  };
}

/** The same chart with every list empty, for the empty-section behaviour. */
export function emptyDocument(): CcdDocument {
  const document = sampleDocument();
  return {
    ...document,
    allergies: [],
    medications: [],
    problems: [],
    results: [],
    vitals: [],
    immunisations: [],
    encounters: [],
    plan: [],
    socialHistory: [],
  };
}

/**
 * The same chart with every optional field absent.
 *
 * A document is mostly optional fields, and the branch that handles an absent
 * one is the branch a fixture full of tidy data never reaches. A practice that
 * records a name and nothing else is not an edge case - it is most of the
 * charts a small clinic holds.
 */
export function minimalDocument(): CcdDocument {
  return {
    id: 'ccd-0002',
    title: 'Continuity of Care Document',
    effectiveAt: '2026-08-14T09:30:00.000Z',
    patient: {
      id: 'patient-0002',
      mrn: 'OR-100999',
      givenName: 'Placeholder',
      familyName: 'Nullsson',
      birthDate: '1970-01-15',
      gender: 'unknown',
    },
    custodian: { id: 'org-0002', name: 'Example Clinic' },
    author: { id: 'user-0002', givenName: 'Ash', familyName: 'Nurse' },
    allergies: [{ id: 'a-1', substance: { display: 'Latex' }, status: 'active' }],
    medications: [{ id: 'm-1', medication: { display: 'Aspirin' }, status: 'active' }],
    problems: [{ id: 'p-1', problem: { display: 'Back pain' }, status: 'active' }],
    results: [
      {
        id: 'r-1',
        panel: { display: 'Urinalysis' },
        observations: [{ id: 'o-1', code: { display: 'Protein' } }],
      },
    ],
    vitals: [
      {
        id: 'v-1',
        panel: { display: 'Vitals' },
        observations: [{ id: 'vo-1', code: { display: 'Pulse' }, value: '72', unit: '/min' }],
      },
    ],
    immunisations: [{ id: 'i-1', vaccine: { display: 'Tetanus' }, status: 'completed' }],
    encounters: [{ id: 'e-1', type: { display: 'Visit' }, startedAt: '2026-08-14T09:00:00.000Z' }],
    plan: [{ id: 'pl-1', activity: { display: 'Follow up' }, status: 'active' }],
    socialHistory: [
      { id: 's-1', observation: { display: 'Alcohol use' }, value: { display: 'None' } },
    ],
  };
}

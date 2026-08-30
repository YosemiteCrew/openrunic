import { describe, expect, it } from 'vitest';

import { MOCK_PATIENTS, mockPatientIdByMrn } from '@/lib/api/mock/fixtures';

/**
 * The MRN to patient id lookup the chart fixtures are keyed through.
 *
 * It exists because the chart fixtures name their patients by MRN, which is the
 * part a reader recognises, and are keyed by id. It answers loudly rather than
 * emptily because the previous `?.id ?? ''` turned a renamed fixture into four
 * charts keyed by the empty string, which surfaces as every patient having an
 * empty chart - a symptom nobody would trace back to a fixture rename.
 */

describe('mockPatientIdByMrn', () => {
  it('answers the id of the patient carrying that MRN', () => {
    const patient = MOCK_PATIENTS[0];
    expect(patient).toBeDefined();
    if (patient === undefined) return;

    expect(mockPatientIdByMrn(patient.mrn)).toBe(patient.id);
  });

  it('names the missing MRN rather than answering an empty id', () => {
    expect(() => mockPatientIdByMrn('OR-000000')).toThrow('OR-000000');
  });
});

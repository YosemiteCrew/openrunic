import { describe, expect, it } from 'vitest';

import { fromFhirProcedure, toFhirProcedure, type DomainProcedure } from './procedure.js';
import { SYSTEMS } from './systems.js';

/**
 * Procedures, across the boundary and back.
 *
 * Two places here can produce a resource that is wrong rather than incomplete,
 * and both get their own assertions. `performedDateTime` and `performedPeriod`
 * are a choice, so emitting both is malformed rather than generous. And the
 * code concept carries two systems at once, so a reader that takes the wrong
 * one gets a real code for the wrong vocabulary, which is worse than none.
 */

const CPT = 'http://www.ama-assn.org/go/cpt';

const DONE: DomainProcedure = {
  id: '0192f1a0-0000-7000-8000-0000000000c1',
  patientId: '0192f1a0-0000-7000-8000-0000000000p1',
  encounterId: '0192f1a0-0000-7000-8000-0000000000e1',
  code: '45378',
  codeSystem: CPT,
  display: 'Diagnostic colonoscopy',
  snomedCode: '73761001',
  status: 'COMPLETED',
  performedStart: '2026-08-12T09:00:00.000Z',
  performedEnd: '2026-08-12T09:45:00.000Z',
  bodySiteCode: '71854001',
  outcomeCode: '385669000',
  note: 'Uneventful.',
  performedById: '0192f1a0-0000-7000-8000-0000000000u1',
};

describe('toFhirProcedure', () => {
  it('carries both codings, because the biller and the exchange read different ones', () => {
    const concept = toFhirProcedure(DONE).code;

    expect(concept?.coding).toEqual([
      { system: CPT, code: '45378' },
      { system: SYSTEMS.snomed, code: '73761001' },
    ]);
    expect(concept?.text).toBe('Diagnostic colonoscopy');
  });

  it('emits a period for a procedure that took one, and no instant beside it', () => {
    /* They are a choice in FHIR. A resource carrying both is malformed, and a
       client reading whichever it prefers gets a different answer from one
       reading the other. */
    const resource = toFhirProcedure(DONE);

    expect(resource.performedPeriod).toEqual({
      start: DONE.performedStart,
      end: DONE.performedEnd,
    });
    expect(resource.performedDateTime).toBeUndefined();
  });

  it('emits an instant for a procedure that was a moment, and no period beside it', () => {
    const moment = toFhirProcedure({ ...DONE, performedEnd: undefined });

    expect(moment.performedDateTime).toBe(DONE.performedStart);
    expect(moment.performedPeriod).toBeUndefined();
  });

  it('maps every status to its FHIR code', () => {
    /* Asserted as a table rather than trusting a transform. Two of these do not
       survive lowercase-and-hyphenate cleanly and there is no way to tell from
       the code which. */
    const codes = (
      [
        'PREPARATION',
        'IN_PROGRESS',
        'NOT_DONE',
        'ON_HOLD',
        'STOPPED',
        'COMPLETED',
        'ENTERED_IN_ERROR',
        'UNKNOWN',
      ] as const
    ).map((status) => toFhirProcedure({ ...DONE, status }).status);

    expect(codes).toEqual([
      'preparation',
      'in-progress',
      'not-done',
      'on-hold',
      'stopped',
      'completed',
      'entered-in-error',
      'unknown',
    ]);
  });

  it('puts a not-done reason in statusReason rather than in a note', () => {
    /* FHIR has a field for it. In `note` a client reading the status would have
       no machine-readable reason beside it. */
    const declined = toFhirProcedure({
      ...DONE,
      status: 'NOT_DONE',
      notDoneReason: 'Declined by the patient',
      note: undefined,
    });

    expect(declined.statusReason).toEqual({ text: 'Declined by the patient' });
    expect(declined.note).toBeUndefined();
  });
});

describe('round trip', () => {
  it('returns every field it was given', () => {
    expect(fromFhirProcedure(toFhirProcedure(DONE))).toEqual(DONE);
  });

  it('keeps a moment a moment rather than inventing a zero-length span', () => {
    const moment = { ...DONE, performedEnd: undefined };
    const back = fromFhirProcedure(toFhirProcedure(moment));

    expect(back.performedEnd).toBeUndefined();
    expect(back.performedStart).toBe(DONE.performedStart);
  });

  it('survives a procedure with nothing but a code, a subject and a time', () => {
    const bare: DomainProcedure = {
      id: '0192f1a0-0000-7000-8000-0000000000c2',
      patientId: DONE.patientId,
      code: '99213',
      codeSystem: CPT,
      display: 'Office visit',
      status: 'COMPLETED',
      performedStart: '2026-08-12T10:00:00.000Z',
    };

    expect(fromFhirProcedure(toFhirProcedure(bare))).toEqual(bare);
  });

  it('returns the primary code, not the SNOMED one appended after it', () => {
    /* The reason `fromFhir` skips SNOMED when looking for the primary coding.
       Taking `coding[0]` positionally works only while the writer keeps this
       order, and a CPT read as SNOMED is a real code in the wrong vocabulary. */
    const resource = toFhirProcedure(DONE);
    const reversed: fhir4.Procedure = {
      ...resource,
      code: { ...resource.code, coding: [...(resource.code?.coding ?? [])].reverse() },
    };

    const back = fromFhirProcedure(reversed);

    expect(back.code).toBe('45378');
    expect(back.codeSystem).toBe(CPT);
    expect(back.snomedCode).toBe('73761001');
  });

  it('round-trips a declined procedure with its reason', () => {
    const declined: DomainProcedure = {
      ...DONE,
      status: 'NOT_DONE',
      notDoneReason: 'Declined by the patient',
    };

    expect(fromFhirProcedure(toFhirProcedure(declined))).toEqual(declined);
  });
});

describe('fromFhirProcedure, on input it did not write', () => {
  it('takes a SNOMED-only code as the primary rather than answering nothing', () => {
    /*
     * Another system may code only in SNOMED. Skipping SNOMED unconditionally
     * would leave such a resource with an empty code, which is a procedure
     * nobody can identify.
     */
    const domain = fromFhirProcedure({
      resourceType: 'Procedure',
      id: 'external-1',
      status: 'completed',
      code: { coding: [{ system: SYSTEMS.snomed, code: '73761001' }], text: 'Colonoscopy' },
      subject: { reference: 'Patient/p-1' },
      performedDateTime: '2026-08-12T09:00:00.000Z',
    });

    expect(domain.code).toBe('73761001');
    expect(domain.codeSystem).toBe(SYSTEMS.snomed);
    /* And it is not also reported as the SNOMED equivalent of itself. */
    expect(domain.snomedCode).toBeUndefined();
  });

  it('falls back to UNKNOWN for a status outside the value set', () => {
    const domain = fromFhirProcedure({
      resourceType: 'Procedure',
      status: 'nonsense' as fhir4.Procedure['status'],
      code: { text: 'Something' },
      subject: { reference: 'Patient/p-1' },
      performedDateTime: '2026-08-12T09:00:00.000Z',
    });

    expect(domain.status).toBe('UNKNOWN');
  });

  it('reads the start from a period when there is no instant', () => {
    const domain = fromFhirProcedure({
      resourceType: 'Procedure',
      status: 'completed',
      code: { text: 'Something' },
      subject: { reference: 'Patient/p-1' },
      performedPeriod: { start: '2026-08-12T09:00:00.000Z' },
    });

    expect(domain.performedStart).toBe('2026-08-12T09:00:00.000Z');
    expect(domain.performedEnd).toBeUndefined();
  });
});

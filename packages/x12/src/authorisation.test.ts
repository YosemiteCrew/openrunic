import { describe, expect, it } from 'vitest';

import {
  decode278,
  encode278,
  isAuthorised,
  isPending,
  type AuthorisationRequest,
} from './authorisation-278.js';
import { DEFAULT_DELIMITERS } from './delimiters.js';
import { readSegments } from './segments.js';

/**
 * Prior authorisation, both directions.
 *
 * The decision semantics carry more weight here than the segment layout. Five
 * outcomes and only one is a plain yes; a system that reads any of the other
 * four wrongly either re-submits an authorisation it already holds or schedules
 * against one that never arrived.
 */

const REQUEST: AuthorisationRequest = {
  payer: { name: 'Example Health Plan', identifier: 'EHP001' },
  requester: { name: 'Example Family Practice', npi: '1234567893' },
  subscriber: {
    memberId: 'MEM00042',
    name: { family: 'Patientsson', given: 'Testina' },
    birthDate: '1994-03-02',
    gender: 'F',
  },
  service: {
    requestCategory: 'SC',
    procedureCode: '45378',
    diagnosisCodes: ['K92.2', 'D12.6'],
    quantity: 1,
    quantityUnit: 'VS',
    serviceDate: '2026-09-01',
  },
  traceNumber: 'TRACE-0001',
  originatorCompanyId: '1234567893',
  originatorTransactionId: 'AUTH-0001',
  created: new Date('2026-08-14T09:30:00.000Z'),
};

const OPTIONS = {
  sender: { qualifier: 'ZZ', id: 'OPENRUNIC', applicationId: 'OPENRUNIC' },
  receiver: { qualifier: 'ZZ', id: 'EHP', applicationId: 'EHP' },
  usageIndicator: 'T' as const,
  controlNumbers: { interchange: 1, group: 1, transactionStart: 1 },
};

function encoded(request: AuthorisationRequest = REQUEST): string {
  const result = encode278(request, OPTIONS);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.ok ? result.value : '';
}

function segmentsOf(raw: string): ReturnType<typeof readSegments> {
  return readSegments(raw, DEFAULT_DELIMITERS);
}

function tags(raw: string): string[] {
  return segmentsOf(raw).map((s) => s.tag);
}

describe('the request', () => {
  it('declares itself a 278 request in the envelope and the header', () => {
    const raw = encoded();

    expect(raw).toContain('GS*HI*');
    expect(raw).toContain('ST*278*');
    // BHT02 `13` is what says request rather than response, and it is the one
    // element that decides how the receiving system routes the transaction.
    expect(raw).toContain('BHT*0007*13*AUTH-0001*');
  });

  it('carries the trace number the response will be matched by', () => {
    expect(encoded()).toContain('TRN*1*TRACE-0001*1234567893');
  });

  it('names the payer, the requester and the subscriber at their own levels', () => {
    const raw = encoded();

    expect(raw).toContain('NM1*X3*2*Example Health Plan');
    expect(raw).toContain('NM1*1P*2*Example Family Practice');
    expect(raw).toContain('NM1*IL*1*Patientsson*Testina');
    expect(raw).toContain('DMG*D8*19940302*F');
  });

  /**
   * `ABK` is the principal diagnosis and `ABF` each one after it. Sending every
   * code as principal is a common defect and produces a request the payer reads
   * as several unrelated conditions.
   */
  it('marks the first diagnosis principal and the rest secondary', () => {
    const raw = encoded();

    expect(raw).toContain('HI*ABK:K92.2');
    expect(raw).toContain('HI*ABF:D12.6');
  });

  it('writes a single service date as D8 and a span as RD8', () => {
    expect(encoded()).toContain('DTP*472*D8*20260901');

    const span = encoded({
      ...REQUEST,
      service: { ...REQUEST.service, serviceEndDate: '2026-09-30' },
    });
    expect(span).toContain('DTP*472*RD8*20260901-20260930');
  });

  /**
   * Asserted on the parsed segment rather than as a substring: the writer strips
   * trailing empty elements, so `UM*SC*I` is the whole segment when no service
   * type is given, and a substring check would pass just as happily against a
   * longer code beginning with the same characters.
   */
  it('carries the certification type, defaulting to an initial request', () => {
    const um = (raw: string): readonly string[] =>
      segmentsOf(raw)
        .find((s) => s.tag === 'UM')
        ?.elements.map(String) ?? [];

    expect(um(encoded())).toEqual(['SC', 'I']);
    expect(
      um(encoded({ ...REQUEST, service: { ...REQUEST.service, certificationType: 'R' } }))
    ).toEqual(['SC', 'R']);
    expect(
      um(encoded({ ...REQUEST, service: { ...REQUEST.service, serviceTypeCode: '2' } }))
    ).toEqual(['SC', 'I', '2']);
  });

  it('adds a dependent level when the patient is not the member', () => {
    const raw = encoded({
      ...REQUEST,
      dependent: {
        name: { family: 'Patientsson', given: 'Junior' },
        birthDate: '2016-04-05',
        gender: 'M',
        relationship: 'child',
      },
    });

    expect(raw).toContain('NM1*03*1*Patientsson*Junior');
    expect(raw).toContain('INS*N*19');
    expect(tags(raw).filter((tag) => tag === 'HL')).toHaveLength(5);
  });

  it('names a service provider when the work happens somewhere else', () => {
    const raw = encoded({
      ...REQUEST,
      serviceProvider: { name: 'Example Endoscopy Centre', npi: '9876543210' },
    });

    expect(raw).toContain('NM1*SJ*2*Example Endoscopy Centre');
  });
});

describe('what the request refuses to send', () => {
  it('refuses an NPI that is not ten digits', () => {
    const result = encode278({ ...REQUEST, requester: { name: 'X', npi: '123' } }, OPTIONS);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('ten digits');
  });

  it('refuses a request with no member id', () => {
    const result = encode278(
      { ...REQUEST, subscriber: { ...REQUEST.subscriber, memberId: '' } },
      OPTIONS
    );

    expect(result.ok).toBe(false);
  });

  /**
   * Without a trace number the response cannot be matched to the request that
   * produced it, and an authorisation nobody can attach to a patient is one
   * nobody can act on.
   */
  it('refuses a request with no trace number', () => {
    const result = encode278({ ...REQUEST, traceNumber: '' }, OPTIONS);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('trace number');
  });
});

describe('reading the answer', () => {
  function response(...lines: readonly string[]): ReturnType<typeof segmentsOf> {
    return segmentsOf(`${lines.join('~')}~`);
  }

  it('reads a certification with its number and its span', () => {
    const result = decode278(
      response(
        'TRN*2*TRACE-0001*1234567893',
        'HCR*A1*AUTH-XYZ',
        'REF*BB*AUTH-XYZ-9',
        'HSD*VS*3',
        'DTP*007*RD8*20260901-20261130',
        'MSG*Approved for three visits'
      )
    );

    expect(result.ok).toBe(true);
    const [answer] = result.ok ? result.value : [];
    expect(answer?.decision).toBe('certified');
    expect(answer?.traceNumber).toBe('TRACE-0001');
    expect(answer?.authorisationNumber).toBe('AUTH-XYZ-9');
    expect(answer?.certifiedQuantity).toBe(3);
    expect(answer?.certifiedUnit).toBe('VS');
    expect(answer?.effectiveFrom).toBe('2026-09-01');
    expect(answer?.effectiveTo).toBe('2026-11-30');
    expect(answer?.message).toBe('Approved for three visits');
  });

  it('reads a single-date span', () => {
    const result = decode278(response('HCR*A1', 'DTP*007*D8*20260901'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.effectiveFrom).toBe('2026-09-01');
    expect(answer?.effectiveTo).toBeUndefined();
  });

  it('reads every decision code the standard defines', () => {
    for (const [code, expected] of [
      ['A1', 'certified'],
      ['A2', 'certified-partial'],
      ['A3', 'denied'],
      ['A4', 'pended'],
      ['A6', 'modified'],
      ['CT', 'cancelled'],
    ] as const) {
      const result = decode278(response(`HCR*${code}`));

      expect(result.ok && result.value[0]?.decision, code).toBe(expected);
    }
  });

  it('keeps the reason the payer gave', () => {
    const result = decode278(response('HCR*A3*!*E4'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.decision).toBe('denied');
    expect(answer?.reasonCodes).toEqual(['E4']);
  });

  /**
   * A response carrying several decisions answers several requests. Folding
   * them together would leave one entry wearing the last payer's fields.
   */
  it('separates several decisions in one response', () => {
    const result = decode278(
      response('TRN*2*TRACE-A*1', 'HCR*A1', 'REF*BB*AUTH-A', 'TRN*2*TRACE-B*1', 'HCR*A3*!*E4')
    );

    expect(result.ok && result.value).toHaveLength(2);
    const answers = result.ok ? result.value : [];
    expect(answers[0]?.traceNumber).toBe('TRACE-A');
    expect(answers[0]?.authorisationNumber).toBe('AUTH-A');
    expect(answers[1]?.traceNumber).toBe('TRACE-B');
    // The second decision must not inherit the first one's number.
    expect(answers[1]?.authorisationNumber).toBeUndefined();
  });

  it('ignores segments that arrive before any decision', () => {
    const result = decode278(response('REF*BB*ORPHAN', 'HCR*A1', 'REF*BB*REAL'));
    const [answer] = result.ok ? result.value : [];

    expect(result.ok && result.value).toHaveLength(1);
    expect(answer?.authorisationNumber).toBe('REAL');
  });

  it('refuses an action code it does not know, rather than guessing', () => {
    const result = decode278(response('HCR*ZZ'));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('ZZ');
  });

  it('answers with nothing for a response carrying no decision at all', () => {
    expect(decode278(response('TRN*2*TRACE-A*1'))).toEqual({ ok: true, value: [] });
  });

  it('ignores a span it cannot read rather than inventing one', () => {
    const result = decode278(response('HCR*A1', 'DTP*007*D8*not-a-date'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.effectiveFrom).toBeUndefined();
  });
});

describe('what a decision means', () => {
  /**
   * Four of the five outcomes are not "no". Treating anything that is not `A1`
   * as a refusal is the mistake that makes a practice re-submit an
   * authorisation it already holds.
   */
  it('counts a partial and a modification as authorised', () => {
    expect(isAuthorised('certified')).toBe(true);
    expect(isAuthorised('certified-partial')).toBe(true);
    expect(isAuthorised('modified')).toBe(true);
  });

  it('counts a denial, a pend and a cancellation as not authorised', () => {
    expect(isAuthorised('denied')).toBe(false);
    expect(isAuthorised('pended')).toBe(false);
    expect(isAuthorised('cancelled')).toBe(false);
  });

  /**
   * Pended is neither yes nor no, and it is the one that decides whether a
   * practice waits or acts. Folding it into either produces a work queue that
   * is wrong in one direction or the other.
   */
  it('keeps pended distinct from both', () => {
    expect(isPending('pended')).toBe(true);
    expect(isPending('denied')).toBe(false);
    expect(isPending('certified')).toBe(false);
  });
});

describe('a request with only what the standard requires', () => {
  /**
   * Most of a 278 is optional, and the branch that handles an absent field is
   * the one a full fixture never reaches. A practice asking whether a specialist
   * opinion is covered supplies a member id, a category and very little else.
   */
  const MINIMAL: AuthorisationRequest = {
    payer: { name: 'Example Health Plan', identifier: 'EHP001' },
    requester: { name: 'Example Family Practice', npi: '1234567893' },
    subscriber: { memberId: 'MEM00042', name: { family: 'Nullsson', given: 'Placeholder' } },
    service: { requestCategory: 'HS' },
    traceNumber: 'TRACE-MIN',
    originatorCompanyId: '1234567893',
    originatorTransactionId: 'AUTH-MIN',
    created: new Date('2026-08-14T09:30:00.000Z'),
  };

  it('leaves out every element it has nothing for', () => {
    const raw = encoded(MINIMAL);
    const present = tags(raw);

    // No demographics without both halves; DMG carries a date and a sex or it
    // carries a claim about neither.
    expect(present).not.toContain('DMG');
    expect(present).not.toContain('HI');
    expect(present).not.toContain('DTP');
    expect(present).not.toContain('SV1');
    expect(present).not.toContain('HSD');
    expect(raw).toContain('UM*HS*I');
  });

  it('still carries the trace number, which is the one thing it cannot omit', () => {
    expect(encoded(MINIMAL)).toContain('TRN*1*TRACE-MIN*1234567893');
  });

  it('writes no demographics when only half of them are known', () => {
    const halfKnown = encoded({
      ...MINIMAL,
      subscriber: { ...MINIMAL.subscriber, birthDate: '1994-03-02' },
    });

    expect(tags(halfKnown)).not.toContain('DMG');
  });

  it('writes a quantity of one when a procedure is asked for without a count', () => {
    const raw = encoded({ ...MINIMAL, service: { ...MINIMAL.service, procedureCode: '99244' } });

    expect(raw).toContain('SV1*HC:99244**UN*1');
  });
});

describe('a response with fields the payer left out or wrote badly', () => {
  function response(...lines: readonly string[]): ReturnType<typeof segmentsOf> {
    return segmentsOf(`${lines.join('~')}~`);
  }

  it('ignores a quantity that is not a number rather than reading it as zero', () => {
    const result = decode278(response('HCR*A1', 'HSD*VS*not-a-number'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.certifiedUnit).toBe('VS');
    expect(answer?.certifiedQuantity).toBeUndefined();
  });

  it('reads an RD8 span whose second half is missing as an open one', () => {
    const result = decode278(response('HCR*A1', 'DTP*007*RD8*20260901-'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.effectiveFrom).toBe('2026-09-01');
    expect(answer?.effectiveTo).toBeUndefined();
  });

  it('ignores a date qualifier it is not looking for', () => {
    const result = decode278(response('HCR*A1', 'DTP*472*D8*20260901'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.effectiveFrom).toBeUndefined();
  });

  it('ignores a REF that is not the authorisation number', () => {
    const result = decode278(response('HCR*A1', 'REF*ZZ*something-else'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.authorisationNumber).toBeUndefined();
  });

  it('answers with a decision carrying no reason at all', () => {
    const result = decode278(response('HCR*A4'));
    const [answer] = result.ok ? result.value : [];

    expect(answer?.decision).toBe('pended');
    expect(answer?.reasonCodes).toEqual([]);
  });
});

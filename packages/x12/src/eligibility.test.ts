import { describe, expect, it } from 'vitest';

import {
  FIXTURE_270_OPTIONS,
  dependentEligibilityRequest,
  eligibilityRequest,
} from './__fixtures__/inputs.js';
import { readFixture } from './__fixtures__/index.js';
import { encode270 } from './eligibility-270.js';
import { decode271, toCoverageSummary } from './eligibility-271.js';
import { expectErr, expectOk } from './test-support/result.js';

/**
 * 270 and 271 tests.
 *
 * Eligibility is the cheapest prevention in the revenue cycle, so the tests
 * that matter are the ones about the answer being usable at a front desk: is
 * the policy live, what will the patient owe today, and did the payer actually
 * answer or merely refuse the question. The last of those is the one worth
 * being pedantic about, because "we cannot find this member" and "this member
 * is not covered" look similar on a screen and are completely different facts.
 */

const DEPENDENT_OPTIONS = {
  ...FIXTURE_270_OPTIONS,
  controlNumbers: { interchange: 100003, group: 3, transactionStart: 1 },
};

describe('270 eligibility inquiry', () => {
  it('encodes a subscriber inquiry byte for byte', () => {
    expect(expectOk(encode270(eligibilityRequest(), FIXTURE_270_OPTIONS))).toBe(
      readFixture('270-coverage-inquiry.edi')
    );
  });

  it('encodes a dependent inquiry byte for byte', () => {
    expect(expectOk(encode270(dependentEligibilityRequest(), DEPENDENT_OPTIONS))).toBe(
      readFixture('270-dependent-inquiry.edi')
    );
  });

  it('flips the subscriber hierarchical child code when a dependent level follows', () => {
    expect(readFixture('270-coverage-inquiry.edi')).toContain('HL*3*2*22*0~');
    expect(readFixture('270-dependent-inquiry.edi')).toContain('HL*3*2*22*1~');
    expect(readFixture('270-dependent-inquiry.edi')).toContain('INS*N*19~');
  });

  it('writes one EQ per service type, defaulting to the whole plan', () => {
    expect(readFixture('270-coverage-inquiry.edi')).toContain('EQ*30~');
    expect(readFixture('270-dependent-inquiry.edi')).toContain('EQ*30~EQ*98~');
  });

  it('omits the subscriber DMG and the service date when neither is known', () => {
    const request = eligibilityRequest();
    const edi = expectOk(
      encode270(
        {
          ...request,
          serviceDate: undefined,
          subscriber: { ...request.subscriber, birthDate: undefined, gender: undefined },
        },
        FIXTURE_270_OPTIONS
      )
    );
    expect(edi).not.toContain('DMG*');
    expect(edi).not.toContain('DTP*291*');
  });

  it('refuses an NPI that is not ten digits', () => {
    const request = eligibilityRequest();
    expect(
      expectErr(
        encode270(
          { ...request, provider: { ...request.provider, npi: '19028' } },
          FIXTURE_270_OPTIONS
        )
      )
    ).toMatchObject({ kind: 'encode_precondition', path: ['provider', 'npi'] });
  });

  it('refuses an inquiry with no member id, because the payer cannot answer it', () => {
    const request = eligibilityRequest();
    expect(
      expectErr(
        encode270(
          { ...request, subscriber: { ...request.subscriber, memberId: '' } },
          FIXTURE_270_OPTIONS
        )
      )
    ).toMatchObject({ path: ['subscriber', 'memberId'] });
  });

  it('surfaces an envelope precondition from the writer unchanged', () => {
    expect(
      expectErr(
        encode270(eligibilityRequest(), {
          ...FIXTURE_270_OPTIONS,
          receiver: { qualifier: 'Z', id: 'NWMH1', applicationId: 'NWMH1' },
        })
      )
    ).toMatchObject({ path: ['receiver', 'qualifier'] });
  });
});

describe('271 active coverage', () => {
  const response = expectOk(decode271(readFixture('271-active-coverage.edi')));

  it('reads both parties and the member the payer echoed back', () => {
    expect(response.payer).toEqual({ name: 'NORTHWIND MUTUAL HEALTH', identifier: 'NWMH1' });
    expect(response.provider).toEqual({
      name: 'CEDAR HOLLOW FAMILY PRACTICE',
      identifier: '1902874651',
    });
    expect(response.subscriber).toEqual({
      name: 'PATIENTSSON, TESTINA',
      identifier: 'NWMH445566',
      memberId: 'NWMH445566',
      birthDate: '1984-03-11',
      gender: 'F',
    });
    expect(response.traceNumber).toBe('ELG000000042');
    expect(response.dates).toEqual([{ qualifier: '346', date: '2026-01-01' }]);
  });

  it('splits a repeating EB03 into separate service type codes', () => {
    expect(response.benefits[0]?.serviceTypeCodes).toEqual(['30', '33', '35']);
  });

  it('keeps the whole benefit stack rather than reducing it', () => {
    expect(response.benefits.map((benefit) => benefit.eligibilityCode)).toEqual([
      '1',
      'C',
      'C',
      'B',
      'A',
    ]);
    expect(response.benefits[1]).toMatchObject({
      coverageLevelCode: 'IND',
      insuranceTypeCode: 'PP',
      planDescription: 'NORTHWIND PREFERRED 2000',
      timeQualifierCode: '23',
      amountCents: 200_000,
    });
    expect(response.benefits[2]?.amountCents).toBe(45_000);
    expect(response.benefits[3]).toMatchObject({ amountCents: 3_500, inPlanNetwork: 'Y' });
    expect(response.benefits[4]).toMatchObject({ percent: 0.2, amountCents: undefined });
  });

  it('attaches a free-text message to the benefit it followed', () => {
    expect(response.benefits[4]?.messages).toEqual([
      'COINSURANCE APPLIES AFTER THE DEDUCTIBLE IS MET',
    ]);
    expect(response.benefits[0]?.messages).toEqual([]);
  });

  it('derives the live-policy answer from the codes', () => {
    expect(response.active).toBe(true);
    expect(response.rejections).toEqual([]);
  });

  it('reduces to the four facts a check-in screen shows', () => {
    expect(toCoverageSummary(response)).toEqual({
      active: true,
      planDescription: 'NORTHWIND PREFERRED 2000',
      copayCents: 3_500,
      deductibleCents: 200_000,
      rejection: undefined,
    });
  });
});

describe('271 inactive coverage', () => {
  const response = expectOk(decode271(readFixture('271-inactive-coverage.edi')));

  it('reports the policy as not live', () => {
    expect(response.active).toBe(false);
    expect(response.benefits[0]?.eligibilityCode).toBe('6');
    expect(response.dates).toEqual([{ qualifier: '347', date: '2026-01-31' }]);
  });

  it('keeps the payer refusal separate from the coverage answer', () => {
    expect(response.rejections).toEqual([
      { validRequest: 'Y', reasonCode: '75', followUpActionCode: 'C' },
    ]);
  });

  it('summarizes with no plan, no amounts, and the refusal attached', () => {
    expect(toCoverageSummary(response)).toEqual({
      active: false,
      planDescription: undefined,
      copayCents: undefined,
      deductibleCents: undefined,
      rejection: { validRequest: 'Y', reasonCode: '75', followUpActionCode: 'C' },
    });
  });
});

describe('271 edge cases', () => {
  const base = readFixture('271-active-coverage.edi');

  /** Adds segments to a document and keeps SE01 honest. */
  function grow(document: string, anchor: string, added: string): string {
    const count = added.split('~').filter((part) => part !== '').length;
    return document
      .replace(anchor, `${anchor}${added}`)
      .replace(/SE\*(\d+)\*/, (_match, current: string) => `SE*${Number(current) + count}*`);
  }

  it('reads a dependent level and keeps its demographics off the subscriber', () => {
    const withDependent = grow(
      base,
      'DMG*D8*19840311*F~',
      'HL*4*3*23*0~NM1*03*1*PATIENTSSON*JUNIPER~DMG*D8*20160702*M~'
    );
    const response = expectOk(decode271(withDependent));
    expect(response.dependent).toEqual({
      name: 'PATIENTSSON, JUNIPER',
      identifier: undefined,
      birthDate: '2016-07-02',
      gender: 'M',
    });
    expect(response.subscriber.birthDate).toBe('1984-03-11');
  });

  it('attributes a dependent-level DMG to the subscriber when no dependent NM1 arrived', () => {
    const orphaned = grow(base, 'DMG*D8*19840311*F~', 'HL*4*3*23*0~DMG*D8*20160702*M~');
    const response = expectOk(decode271(orphaned));
    expect(response.dependent).toBeUndefined();
    expect(response.subscriber.birthDate).toBe('2016-07-02');
  });

  it('ignores a hierarchical level the profile does not define', () => {
    const response = expectOk(decode271(base.replace('HL*2*1*21*1~', 'HL*2*1*XX*1~')));
    expect(response.provider).toEqual({ name: '' });
    expect(response.active).toBe(true);
  });

  it('ignores a message that arrives before any benefit', () => {
    const early = grow(base, 'HL*1**20*1~', 'MSG*STRAY TEXT~');
    const response = expectOk(decode271(early));
    expect(response.benefits.flatMap((benefit) => benefit.messages)).toEqual([
      'COINSURANCE APPLIES AFTER THE DEDUCTIBLE IS MET',
    ]);
  });

  it('reads a benefit quantity', () => {
    const response = expectOk(
      decode271(
        base.replace(
          'EB*A*IND*30*PP*NORTHWIND PREFERRED 2000***.2****Y~',
          'EB*A*IND*30*PP*NORTHWIND PREFERRED 2000***.2**6**Y~'
        )
      )
    );
    expect(response.benefits[4]?.quantity).toBe(6);
  });

  it('refuses a document that is not a 271', () => {
    expect(expectErr(decode271(readFixture('270-coverage-inquiry.edi'))).kind).toBe(
      'unsupported_transaction'
    );
  });

  it('reports a malformed birth date, benefit amount, percentage, quantity and plan date', () => {
    expect(
      expectErr(decode271(base.replace('DMG*D8*19840311*F~', 'DMG*D8*NOPE*F~')))
    ).toMatchObject({ kind: 'invalid_element' });
    expect(expectErr(decode271(base.replace('*23*2000~', '*23*LOTS~')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(expectErr(decode271(base.replace('***.2****Y~', '***MANY****Y~')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(expectErr(decode271(base.replace('***.2****Y~', '***.2**MANY**Y~')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(
      expectErr(decode271(base.replace('DTP*346*D8*20260101~', 'DTP*346*D8*NOPE~')))
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('tolerates a DTP and a DMG that carry no value at all', () => {
    const response = expectOk(
      decode271(
        base.replace('DTP*346*D8*20260101~', 'DTP*346*D8~').replace('DMG*D8*19840311*F~', 'DMG*D8~')
      )
    );
    expect(response.dates).toEqual([]);
    expect(response.subscriber.birthDate).toBeUndefined();
  });

  it('reads a benefit that names no service type at all', () => {
    const response = expectOk(
      decode271(base.replace('EB*1*IND*30^33^35*PP*NORTHWIND PREFERRED 2000~', 'EB*1*IND~'))
    );
    expect(response.benefits[0]?.serviceTypeCodes).toEqual([]);
    expect(response.benefits[0]?.planDescription).toBeUndefined();
    expect(response.active).toBe(true);
  });
});

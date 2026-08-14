import { describe, expect, it } from 'vitest';

import { readFixture } from './__fixtures__/index.js';
import { decode999, toAckOutcomes } from './ack-999.js';
import { decode277, toClaimStatusOutcomes } from './status-277.js';
import { expectErr, expectOk } from './test-support/result.js';

/**
 * 277 and 999 tests.
 *
 * Both transactions exist to move a claim off "submitted", so the assertions
 * that matter most are the derived ones: `accepted` on a 277 claim and on a
 * 999 transaction set. Those are decisions the lifecycle acts on, and they are
 * computed from code lists rather than reported by the sender, which makes
 * them exactly the kind of rule that deserves a test rather than a comment.
 */

describe('277 claim acknowledgement, accepted', () => {
  const report = expectOk(decode277(readFixture('277-accepted.edi')));

  it('reads the header and every hierarchical party', () => {
    expect(report.transactionPurpose).toBe('08');
    expect(report.referenceIdentification).toBe('ACK20260317001');
    expect(report.created).toBe('2026-03-17');
    expect(report.informationSource).toEqual({
      name: 'NORTHWIND MUTUAL HEALTH',
      identifier: 'NWMH1',
    });
    expect(report.informationReceiver?.name).toBe('CEDAR HOLLOW BILLING');
    expect(report.billingProvider?.identifier).toBe('1902874651');
  });

  it('keeps statuses reported above the claim level out of the claim', () => {
    expect(report.batchStatuses).toHaveLength(2);
    expect(report.batchStatuses.every((status) => status.categoryCode === 'A1')).toBe(true);
    expect(report.claims).toHaveLength(1);
  });

  it('reads the claim status, its payer control number and its service dates', () => {
    const [claim] = report.claims;
    expect(claim).toMatchObject({
      patientControlNumber: 'CLM00000001',
      patientName: 'PATIENTSSON, TESTINA',
      payerControlNumber: 'NWMH20260317551',
      serviceDateFrom: '2026-03-12',
      serviceDateTo: '2026-03-12',
      accepted: true,
    });
    expect(claim?.statuses[0]).toEqual({
      categoryCode: 'A2',
      statusCode: '20',
      entityCode: 'PR',
      effectiveDate: '2026-03-17',
      actionCode: 'WQ',
      amountCents: 14_800,
      paidCents: 0,
      freeText: undefined,
    });
  });

  it('projects one outcome per claim with no rejection reason', () => {
    expect(toClaimStatusOutcomes(report)).toEqual([
      {
        patientControlNumber: 'CLM00000001',
        accepted: true,
        payerControlNumber: 'NWMH20260317551',
        reason: undefined,
      },
    ]);
  });
});

describe('277 claim acknowledgement, rejected', () => {
  const report = expectOk(decode277(readFixture('277-rejected.edi')));

  it('marks the claim as not advanced and carries the actionable reason', () => {
    const [claim] = report.claims;
    expect(claim?.accepted).toBe(false);
    expect(claim?.statuses[0]).toMatchObject({
      categoryCode: 'A7',
      statusCode: '453',
      entityCode: '85',
      actionCode: 'U',
      freeText: 'BILLING PROVIDER TAXONOMY CODE IS MISSING OR INVALID',
    });
  });

  it('reads a single-date DTP as a start with no end', () => {
    expect(report.claims[0]?.serviceDateFrom).toBe('2026-03-12');
    expect(report.claims[0]?.serviceDateTo).toBeUndefined();
  });

  it('surfaces the batch-level rejection separately from the claim', () => {
    expect(report.batchStatuses[0]?.categoryCode).toBe('A3');
  });

  it('projects an outcome carrying the first rejecting status', () => {
    const [outcome] = toClaimStatusOutcomes(report);
    expect(outcome?.accepted).toBe(false);
    expect(outcome?.reason?.categoryCode).toBe('A7');
    expect(outcome?.payerControlNumber).toBeUndefined();
  });
});

describe('277 failure paths', () => {
  const base = readFixture('277-accepted.edi');

  it('refuses a document that is not a 277', () => {
    expect(expectErr(decode277(readFixture('999-accepted.edi'))).kind).toBe(
      'unsupported_transaction'
    );
  });

  it('reports a malformed created date, status date and status amount', () => {
    expect(expectErr(decode277(base.replace('*20260317*0930*', '*NOPE*0930*')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(
      expectErr(decode277(base.replace('STC*A2:20:PR*20260317*', 'STC*A2:20:PR*NOPE*')))
    ).toMatchObject({ kind: 'invalid_element' });
    expect(
      expectErr(
        decode277(
          base.replace('STC*A2:20:PR*20260317*WQ*148*0~', 'STC*A2:20:PR*20260317*WQ*LOTS*0~')
        )
      )
    ).toMatchObject({ kind: 'invalid_element' });
    expect(
      expectErr(
        decode277(
          base.replace('STC*A2:20:PR*20260317*WQ*148*0~', 'STC*A2:20:PR*20260317*WQ*148*LOTS~')
        )
      )
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('reports both halves of a malformed RD8 service range', () => {
    expect(
      expectErr(decode277(base.replace('RD8*20260312-20260312', 'RD8*NOPE-20260312')))
    ).toMatchObject({ kind: 'invalid_element' });
    expect(
      expectErr(decode277(base.replace('RD8*20260312-20260312', 'RD8*20260312-NOPE')))
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('ignores a hierarchical level the profile does not define', () => {
    const report = expectOk(decode277(base.replace('HL*3*2*19*1~', 'HL*3*2*XX*1~')));
    expect(report.billingProvider).toBeUndefined();
    expect(report.claims).toHaveLength(1);
  });

  it('tolerates a report that carries no BHT date at all', () => {
    const report = expectOk(
      decode277(base.replace('*ACK20260317001*20260317*', '*ACK20260317001**'))
    );
    expect(report.created).toBeUndefined();
  });
});

describe('999 implementation acknowledgement, accepted', () => {
  const report = expectOk(decode999(readFixture('999-accepted.edi')));

  it('names the functional group it answers', () => {
    expect(report.functionalGroup).toEqual({
      identifier: 'HC',
      controlNumber: '1',
      version: '005010X222A1',
    });
  });

  it('accepts the transaction set and the group', () => {
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]).toMatchObject({
      setIdentifier: '837',
      controlNumber: '0001',
      acknowledgementCode: 'A',
      errorCodes: [],
      segmentErrors: [],
      accepted: true,
    });
    expect(report.group).toEqual({
      acknowledgementCode: 'A',
      setsIncluded: 1,
      setsReceived: 1,
      setsAccepted: 1,
      errorCodes: [],
    });
    expect(report.accepted).toBe(true);
  });

  it('projects an outcome with no faults', () => {
    expect(toAckOutcomes(report)).toEqual([
      { transactionControlNumber: '0001', accepted: true, faults: [] },
    ]);
  });
});

describe('999 implementation acknowledgement, rejected', () => {
  const report = expectOk(decode999(readFixture('999-rejected.edi')));

  it('names the exact segments and elements that failed', () => {
    expect(report.transactions[0]?.segmentErrors).toEqual([
      {
        segmentId: 'NM1',
        segmentPosition: 8,
        loopIdentifier: '2010AA',
        errorCode: '8',
        elementErrors: [
          {
            elementPosition: 9,
            componentPosition: undefined,
            repeatPosition: undefined,
            referenceNumber: '67',
            errorCode: '7',
            badValue: '19028746',
          },
        ],
      },
      {
        segmentId: 'SV1',
        segmentPosition: 31,
        loopIdentifier: '2400',
        errorCode: '8',
        elementErrors: [
          {
            elementPosition: 1,
            componentPosition: 2,
            repeatPosition: undefined,
            referenceNumber: '234',
            errorCode: '7',
            badValue: '9921X',
          },
        ],
      },
    ]);
  });

  it('rejects the transaction set and the group', () => {
    expect(report.transactions[0]?.acknowledgementCode).toBe('R');
    expect(report.transactions[0]?.accepted).toBe(false);
    expect(report.transactions[0]?.errorCodes).toEqual(['5']);
    expect(report.group).toMatchObject({ acknowledgementCode: 'R', setsAccepted: 0 });
    expect(report.accepted).toBe(false);
  });

  it('projects one renderable fault per element error', () => {
    expect(toAckOutcomes(report)).toEqual([
      {
        transactionControlNumber: '0001',
        accepted: false,
        faults: ['NM1 at position 8 (8), element 9 (7)', 'SV1 at position 31 (8), element 1 (7)'],
      },
    ]);
  });
});

describe('999 edge cases', () => {
  const base = readFixture('999-rejected.edi');

  it('refuses a document that is not a 999', () => {
    expect(expectErr(decode999(readFixture('277-accepted.edi'))).kind).toBe(
      'unsupported_transaction'
    );
  });

  it('treats accepted with errors as advanced, because the claim is being paid', () => {
    const report = expectOk(decode999(base.replace('IK5*R*5~', 'IK5*E*5~')));
    expect(report.transactions[0]?.accepted).toBe(true);
  });

  it('reads a segment error that names no element, and renders it alone', () => {
    const trimmed = base
      .replace('IK4*1:2*234*7*9921X~', '')
      .replace(/SE\*(\d+)\*/, (_match, count: string) => `SE*${Number(count) - 1}*`);
    const report = expectOk(decode999(trimmed));
    expect(report.transactions[0]?.segmentErrors[1]?.elementErrors).toEqual([]);
    expect(toAckOutcomes(report)[0]?.faults).toEqual([
      'NM1 at position 8 (8), element 9 (7)',
      'SV1 at position 31 (8)',
    ]);
  });

  it('reads a segment error with no error code of its own', () => {
    const report = expectOk(decode999(base.replace('IK3*NM1*8*2010AA*8~', 'IK3*NM1*8*2010AA~')));
    expect(report.transactions[0]?.segmentErrors[0]?.errorCode).toBeUndefined();
    expect(toAckOutcomes(report)[0]?.faults[0]).toBe('NM1 at position 8, element 9 (7)');
  });

  it('reads an element error inside a repeating element', () => {
    const report = expectOk(decode999(base.replace('IK4*1:2*234*', 'IK4*1:2:3*234*')));
    expect(report.transactions[0]?.segmentErrors[1]?.elementErrors[0]?.repeatPosition).toBe(3);
  });

  it('reads a non-numeric group count as zero rather than failing the parse', () => {
    const report = expectOk(decode999(base.replace('AK9*R*1*1*0*5~', 'AK9*R**1*0*5~')));
    expect(report.group.setsIncluded).toBe(0);
  });

  it('ignores IK3, IK4 and IK5 that arrive before any AK2', () => {
    const stray = base
      .replace('AK2*837*0001*005010X222A1~', '')
      .replace(/SE\*(\d+)\*/, (_match, count: string) => `SE*${Number(count) - 1}*`);
    const report = expectOk(decode999(stray));
    expect(report.transactions).toEqual([]);
    expect(report.group.acknowledgementCode).toBe('R');
  });

  it('ignores an IK4 that arrives before any IK3', () => {
    const stray = base
      .replace('IK3*NM1*8*2010AA*8~', '')
      .replace(/SE\*(\d+)\*/, (_match, count: string) => `SE*${Number(count) - 1}*`);
    const report = expectOk(decode999(stray));
    expect(report.transactions[0]?.segmentErrors).toHaveLength(1);
  });

  it('ignores a segment the acknowledgement profile does not define', () => {
    const withContext = base
      .replace('IK5*R*5~', 'CTX*SITUATIONAL TRIGGER*NM1**8**66~IK5*R*5~')
      .replace(/SE\*(\d+)\*/, (_match, count: string) => `SE*${Number(count) + 1}*`);
    const report = expectOk(decode999(withContext));
    expect(report.transactions[0]?.acknowledgementCode).toBe('R');
  });

  it('reads an acknowledgement with no AK1 at all', () => {
    const stripped = readFixture('999-accepted.edi')
      .replace('AK1*HC*1*005010X222A1~', '')
      .replace(/SE\*(\d+)\*/, (_match, count: string) => `SE*${Number(count) - 1}*`);
    const report = expectOk(decode999(stripped));
    expect(report.functionalGroup).toEqual({
      identifier: '',
      controlNumber: '',
      version: undefined,
    });
  });
});

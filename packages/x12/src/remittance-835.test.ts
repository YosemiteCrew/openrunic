import { describe, expect, it } from 'vitest';

import { readFixture } from './__fixtures__/index.js';
import { decode835, toRemittanceLines } from './remittance-835.js';
import type { Remittance835 } from './remittance-835.js';
import { expectErr, expectOk } from './test-support/result.js';

/**
 * 835 decoder tests.
 *
 * These assert money and reason codes, in that order of stubbornness. Every
 * fixture's arithmetic closes: charged minus adjustments equals allowed, and
 * allowed minus patient responsibility equals paid. Asserting that closure
 * rather than just the field values is what catches an off-by-one in CAS
 * stacking, which is otherwise invisible until a patient is under-billed.
 */

function decode(name: string): Remittance835 {
  return expectOk(decode835(readFixture(name)));
}

describe('a clean primary payment', () => {
  const remittance = decode('835-full-payment.edi');

  it('reads the deposit itself', () => {
    expect(remittance.financials).toEqual({
      transactionHandlingCode: 'I',
      totalPaidCents: 25_012,
      creditDebitFlag: 'C',
      paymentMethod: 'ACH',
      effectiveDate: '2026-03-30',
    });
    expect(remittance.trace).toEqual({
      traceNumber: 'EFT20260330001',
      payerIdentifier: '1861234567',
    });
    expect(remittance.productionDate).toBe('2026-03-30');
  });

  it('reads both parties', () => {
    expect(remittance.payer).toEqual({
      name: 'NORTHWIND MUTUAL HEALTH',
      identifierQualifier: 'XV',
      identifier: 'NWMH1',
    });
    expect(remittance.payee.name).toBe('CEDAR HOLLOW FAMILY PRACTICE');
    expect(remittance.payee.identifier).toBe('1902874651');
  });

  it('reads the claim header, including the payer control number', () => {
    const [claim] = remittance.claims;
    expect(claim).toMatchObject({
      patientControlNumber: 'CLM00000002',
      statusCode: '1',
      chargedCents: 30_300,
      paidCents: 25_012,
      patientResponsibilityCents: 2_000,
      filingIndicatorCode: 'CI',
      payerControlNumber: 'NWMH20260330001',
      facilityCode: '11',
      frequencyCode: '1',
    });
    expect(claim?.patient?.name).toBe('PATIENTSSON, TESTINA');
    expect(claim?.dates).toEqual([
      { qualifier: '232', date: '2026-03-12' },
      { qualifier: '233', date: '2026-03-14' },
    ]);
    expect(claim?.amounts).toEqual([{ qualifier: 'AU', cents: 27_012 }]);
  });

  it('reads both service lines with their modifiers and control numbers', () => {
    const lines = remittance.claims[0]?.lines ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      sequence: 1,
      procedureCode: '99214',
      modifiers: ['25'],
      chargedCents: 21_400,
      paidCents: 16_120,
      allowedCents: 18_120,
      units: 1,
      serviceDate: '2026-03-12',
      lineControlNumber: 'LN00000011',
    });
    expect(lines[1]).toMatchObject({
      sequence: 2,
      procedureCode: '20610',
      modifiers: ['RT', '59'],
      units: undefined,
      revenueCode: undefined,
    });
  });

  it('closes the arithmetic on every line', () => {
    for (const line of remittance.claims[0]?.lines ?? []) {
      const adjusted = line.adjustments.flatMap((adjustment) =>
        adjustment.details.map((detail) => detail.amountCents)
      );
      const total = adjusted.reduce((sum, value) => sum + value, 0);
      expect(line.chargedCents - total).toBe(line.paidCents);
    }
  });
});

describe('a partial payment with a stacked CAS', () => {
  const remittance = decode('835-partial-payment.edi');
  const line = remittance.claims[0]?.lines[0];

  it('reads every triplet in the stacked segment, not just the first', () => {
    expect(line?.adjustments).toEqual([
      {
        groupCode: 'PR',
        details: [
          { reasonCode: '1', amountCents: 2_500, quantity: undefined },
          { reasonCode: '2', amountCents: 1_650, quantity: undefined },
        ],
      },
      {
        groupCode: 'CO',
        details: [{ reasonCode: '45', amountCents: 3_250, quantity: undefined }],
      },
    ]);
  });

  it('leaves exactly the claim-level patient responsibility with the patient', () => {
    const patientOwed = (line?.adjustments ?? [])
      .filter((adjustment) => adjustment.groupCode === 'PR')
      .flatMap((adjustment) => adjustment.details)
      .reduce((sum, detail) => sum + detail.amountCents, 0);
    expect(patientOwed).toBe(remittance.claims[0]?.patientResponsibilityCents);
  });
});

describe('a denial', () => {
  const remittance = decode('835-denial.edi');

  it('keeps claim-level and line-level adjustments apart', () => {
    const [claim] = remittance.claims;
    expect(claim?.statusCode).toBe('4');
    expect(claim?.paidCents).toBe(0);
    expect(claim?.adjustments).toHaveLength(1);
    expect(claim?.lines[0]?.adjustments).toHaveLength(1);
  });

  it('reads the RARC remarks that explain the CARC', () => {
    expect(remittance.claims[0]?.lines[0]?.remarkCodes).toEqual(['N19', 'M80']);
  });
});

describe('a reversal', () => {
  const remittance = decode('835-reversal.edi');

  it('keeps every amount signed, so the ledger moves the right way', () => {
    const [reversal, replacement] = remittance.claims;
    expect(reversal).toMatchObject({
      statusCode: '22',
      chargedCents: -14_800,
      paidCents: -7_400,
      patientResponsibilityCents: -4_150,
    });
    expect(reversal?.lines[0]).toMatchObject({
      chargedCents: -14_800,
      paidCents: -7_400,
      units: -1,
    });
    expect(reversal?.lines[0]?.adjustments[0]?.details[0]?.amountCents).toBe(-3_250);
    expect(replacement).toMatchObject({ statusCode: '1', frequencyCode: '7', paidCents: 10_600 });
  });

  it('reads the provider-level adjustments that reconcile the deposit', () => {
    expect(remittance.providerAdjustments).toEqual([
      {
        providerIdentifier: '1902874651',
        fiscalPeriodDate: '2026-12-31',
        reasonCode: 'WO',
        referenceIdentifier: 'NWMH20260330002',
        amountCents: 1_200,
      },
      {
        providerIdentifier: '1902874651',
        fiscalPeriodDate: '2026-12-31',
        reasonCode: 'L6',
        referenceIdentifier: 'INTEREST',
        amountCents: -45,
      },
    ]);
  });

  it('reconciles the deposit against the claims and the provider adjustments', () => {
    const claimTotal = remittance.claims.reduce((sum, claim) => sum + claim.paidCents, 0);
    const providerTotal = remittance.providerAdjustments.reduce(
      (sum, adjustment) => sum + adjustment.amountCents,
      0
    );
    expect(claimTotal - providerTotal).toBe(remittance.financials.totalPaidCents);
  });
});

describe('several claims and the widest possible CAS', () => {
  const remittance = decode('835-stacked-adjustments.edi');

  it('splits the advice into one entry per CLP loop', () => {
    expect(remittance.claims.map((claim) => claim.patientControlNumber)).toEqual([
      'CLM00000002',
      'CLM00000003',
      'CLM00000006',
    ]);
  });

  it('reads all six triplets a single CAS segment can carry', () => {
    const adjustments = remittance.claims[0]?.lines[0]?.adjustments ?? [];
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]?.details).toHaveLength(6);
    expect(adjustments[0]?.details.map((detail) => detail.reasonCode)).toEqual([
      '45',
      '59',
      '253',
      '96',
      '97',
      '16',
    ]);
    const total = (adjustments[0]?.details ?? []).reduce(
      (sum, detail) => sum + detail.amountCents,
      0
    );
    expect(total).toBe(8_200);
  });

  it('keeps a claim that carries no service lines at all', () => {
    const denial = remittance.claims[2];
    expect(denial?.lines).toEqual([]);
    expect(denial?.adjustments[0]?.details[0]).toMatchObject({ reasonCode: '29' });
  });
});

describe('a secondary payer advice', () => {
  const remittance = decode('835-secondary-payer.edi');

  it('reads a cheque rather than an EFT', () => {
    expect(remittance.financials.paymentMethod).toBe('CHK');
    expect(remittance.trace.traceNumber).toBe('CHK0000044821');
  });

  it('reads the prior payer adjudication as an OA group, not a write-off', () => {
    const adjustment = remittance.claims[0]?.lines[0]?.adjustments[0];
    expect(adjustment?.groupCode).toBe('OA');
    expect(adjustment?.details[0]).toMatchObject({ reasonCode: '23', amountCents: 12_490 });
  });
});

describe('less common payer behaviours', () => {
  const base = readFixture('835-full-payment.edi');

  it('reads a corrected patient name without overwriting the patient', () => {
    const corrected = base
      .replace(
        'NM1*QC*1*PATIENTSSON*TESTINA*R***MI*NWMH445566~',
        'NM1*QC*1*PATIENTSSON*TESTINA*R***MI*NWMH445566~NM1*74*1*PATIENTSSON*TESTINA*ROSE~'
      )
      .replace(/SE\*(\d+)\*/, (_match, count: string) => `SE*${Number(count) + 1}*`);
    const remittance = expectOk(decode835(corrected));
    expect(remittance.claims[0]?.patient?.name).toBe('PATIENTSSON, TESTINA');
    expect(remittance.claims[0]?.correctedPatient?.name).toBe('PATIENTSSON, TESTINA');
  });

  it('reads the quantity a payer attaches to an adjustment', () => {
    const remittance = expectOk(decode835(base.replace('CAS*CO*45*32.80~', 'CAS*CO*45*32.80*2~')));
    expect(remittance.claims[0]?.lines[0]?.adjustments[0]?.details[0]?.quantity).toBe(2);
  });
});

describe('projecting into the ledger rows', () => {
  it('emits one row per service line, numbered across the whole advice', () => {
    const rows = toRemittanceLines(decode('835-full-payment.edi'));
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
    expect(rows[0]).toEqual({
      sequence: 1,
      payerControlNumber: 'NWMH20260330001',
      patientControlNumber: 'CLM00000002',
      code: '99214',
      chargedCents: 21_400,
      allowedCents: 18_120,
      paidCents: 16_120,
      patientResponsibilityCents: 2_000,
      adjustmentGroupCode: 'CO',
      adjustmentReasonCode: '45',
      remarkCodes: [],
      serviceDateFrom: '2026-03-12',
      lineControlNumber: 'LN00000011',
    });
  });

  it('numbers rows continuously across claims', () => {
    const rows = toRemittanceLines(decode('835-stacked-adjustments.edi'));
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.patientControlNumber)).toEqual([
      'CLM00000002',
      'CLM00000003',
      'CLM00000006',
    ]);
  });

  it('still emits a row for a claim the payer answered without service lines', () => {
    const rows = toRemittanceLines(decode('835-stacked-adjustments.edi'));
    expect(rows[2]).not.toHaveProperty('code');
    expect(rows[2]).toMatchObject({
      chargedCents: 9_800,
      paidCents: 0,
      allowedCents: 0,
      adjustmentGroupCode: 'CO',
      adjustmentReasonCode: '29',
      remarkCodes: [],
    });
  });

  it('picks the adjustment that explains most of the difference, not the first one', () => {
    const [row] = toRemittanceLines(decode('835-partial-payment.edi'));
    expect(row?.adjustmentGroupCode).toBe('CO');
    expect(row?.adjustmentReasonCode).toBe('45');
    expect(row?.patientResponsibilityCents).toBe(4_150);
  });

  it('derives an allowed amount when the payer sent no AMT*B6', () => {
    const [row] = toRemittanceLines(decode('835-denial.edi'));
    expect(row?.allowedCents).toBe(0);
    expect(row?.remarkCodes).toEqual(['N19', 'M80']);
  });

  it('carries the remaining balance through a secondary advice', () => {
    const [row] = toRemittanceLines(decode('835-secondary-payer.edi'));
    expect(row).toMatchObject({
      allowedCents: 11_550,
      paidCents: 2_310,
      patientResponsibilityCents: 0,
      adjustmentGroupCode: 'OA',
    });
  });

  it('leaves the adjustment columns empty when the payer sent none', () => {
    const remittance = decode('835-full-payment.edi');
    const [claim] = remittance.claims;
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const stripped: Remittance835 = {
      ...remittance,
      claims: [{ ...claim, lines: claim.lines.map((line) => ({ ...line, adjustments: [] })) }],
    };
    const [row] = toRemittanceLines(stripped);
    expect(row?.adjustmentGroupCode).toBeUndefined();
    expect(row?.adjustmentReasonCode).toBeUndefined();
  });

  it('falls back to paid plus responsibility when a claim carries no AMT*AU', () => {
    const remittance = decode('835-stacked-adjustments.edi');
    const rows = toRemittanceLines(remittance);
    expect(rows[2]?.allowedCents).toBe(0);
  });
});

describe('refusing an unreadable remittance', () => {
  const base = readFixture('835-full-payment.edi');

  /** Adjusts SE01 so a doctored document still passes the envelope reconciliation. */
  function resize(document: string, delta: number): string {
    return document.replace(
      /SE\*(\d+)\*/,
      (_match, count: string) => `SE*${Number(count) + delta}*`
    );
  }

  /** Removes one segment and keeps the transaction set's own count honest. */
  function withoutSegment(text: string): string {
    return resize(base.replace(text, ''), -1);
  }

  it('refuses a document that is not an 835 at all', () => {
    expect(expectErr(decode835(readFixture('999-accepted.edi')))).toMatchObject({
      kind: 'unsupported_transaction',
      transactionSet: '999',
    });
  });

  it('propagates an envelope failure without attempting to map', () => {
    expect(expectErr(decode835(readFixture('malformed-se-count.edi'))).kind).toBe('count_mismatch');
  });

  it('reports a claim amount that is not a number', () => {
    const error = expectErr(decode835(base.replace('*303*250.12*', '*NONE*250.12*')));
    expect(error).toMatchObject({ kind: 'invalid_element', value: 'NONE' });
    expect(error).toHaveProperty('at.segmentTag', 'CLP');
  });

  it('reports a bad paid amount and a bad patient responsibility separately', () => {
    expect(expectErr(decode835(base.replace('*303*250.12*20*', '*303*NONE*20*')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(
      expectErr(decode835(base.replace('*303*250.12*20*', '*303*250.12*NONE*')))
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('reports a bad deposit amount and a bad effective date', () => {
    expect(expectErr(decode835(base.replace('BPR*I*250.12*', 'BPR*I*LOTS*')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(
      expectErr(decode835(base.replace('*5544332211*20260330~', '*5544332211*2026~')))
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('reports a bad service line amount, unit count and date', () => {
    expect(expectErr(decode835(base.replace('*214*161.20*', '*LOTS*161.20*')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(expectErr(decode835(base.replace('*214*161.20*', '*214*LOTS*')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(expectErr(decode835(base.replace('*161.20**1~', '*161.20**MANY~')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(
      expectErr(decode835(base.replace('DTM*472*20260312~', 'DTM*472*NOTADATE~')))
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('reports a bad adjustment amount, quantity and claim-level AMT', () => {
    expect(expectErr(decode835(base.replace('CAS*CO*45*32.80~', 'CAS*CO*45*SOME~')))).toMatchObject(
      {
        kind: 'invalid_element',
      }
    );
    expect(
      expectErr(decode835(base.replace('CAS*CO*45*32.80~', 'CAS*CO*45*32.80*MANY~')))
    ).toMatchObject({ kind: 'invalid_element' });
    expect(expectErr(decode835(base.replace('AMT*AU*270.12~', 'AMT*AU*LOTS~')))).toMatchObject({
      kind: 'invalid_element',
    });
  });

  it('reports a CAS segment that names no adjustment reason at all', () => {
    expect(expectErr(decode835(base.replace('CAS*CO*45*32.80~', 'CAS*CO~')))).toMatchObject({
      kind: 'missing_element',
    });
  });

  it('reports a bad claim-level date and a bad production date', () => {
    expect(expectErr(decode835(base.replace('DTM*232*20260312~', 'DTM*232*NOPE~')))).toMatchObject({
      kind: 'invalid_element',
    });
    expect(expectErr(decode835(base.replace('DTM*405*20260330~', 'DTM*405*NOPE~')))).toMatchObject({
      kind: 'invalid_element',
    });
  });

  it('reports a bad provider adjustment amount and fiscal period', () => {
    const reversal = readFixture('835-reversal.edi');
    expect(
      expectErr(decode835(reversal.replace('NWMH20260330002*12*', 'NWMH20260330002*LOTS*')))
    ).toMatchObject({ kind: 'invalid_element' });
    expect(
      expectErr(decode835(reversal.replace('PLB*1902874651*20261231*', 'PLB*1902874651*NOPE*')))
    ).toMatchObject({ kind: 'invalid_element' });
  });

  it('reports a SVC loop that appears before any claim', () => {
    expect(
      expectErr(
        decode835(withoutSegment('CLP*CLM00000002*1*303*250.12*20*CI*NWMH20260330001*11*1~'))
      )
    ).toMatchObject({ kind: 'unexpected_segment', actual: 'SVC', expected: ['CLP'] });
  });

  it('reports a CAS that belongs to no loop', () => {
    const orphaned = resize(
      `${base.slice(0, base.indexOf('BPR'))}CAS*CO*45*1~${base.slice(base.indexOf('BPR'))}`,
      1
    );
    expect(expectErr(decode835(orphaned))).toMatchObject({
      kind: 'unexpected_segment',
      actual: 'CAS',
      expected: ['CLP', 'SVC'],
    });
  });

  it('reports each header segment the standard requires', () => {
    for (const [removed, tag] of [
      [
        'BPR*I*250.12*C*ACH*CCP*01*021000021*DA*9988776655*NWMH1**01*011000015*DA*5544332211*20260330~',
        'BPR',
      ],
      ['TRN*1*EFT20260330001*1861234567~', 'TRN'],
      ['N1*PR*NORTHWIND MUTUAL HEALTH*XV*NWMH1~', 'N1*PR'],
      ['N1*PE*CEDAR HOLLOW FAMILY PRACTICE*XX*1902874651~', 'N1*PE'],
    ] as const) {
      expect(expectErr(decode835(withoutSegment(removed)))).toMatchObject({
        kind: 'missing_segment',
        tag,
      });
    }
  });
});

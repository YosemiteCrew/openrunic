import { describe, expect, it } from 'vitest';

import {
  ageingState,
  ALLOCATION_HINTS,
  ALLOCATION_STATE_LABELS,
  allocationState,
  allocationStateName,
  arSummary,
  autoAllocate,
  blockingFindings,
  bucketTone,
  bulkActionsFor,
  claimAgeDays,
  claimAgeingBands,
  claimCounts,
  claimLifecycle,
  diagnosisPointer,
  feeSheetTotals,
  isBlockedByScrub,
  lineCharge,
  lineVariance,
  newChargeLine,
  nextDunningStage,
  receiptRows,
  remittanceSummary,
  scrubFeeSheet,
  statementTotals,
  unallocated,
} from '@/components/billing';
import {
  MOCK_CLAIMS,
  MOCK_FEE_SHEETS,
  MOCK_NOW,
  MOCK_REMITTANCES,
  MOCK_STATEMENT_ACCOUNTS,
} from '@/lib/api';
import type { ChargeLine, FeeSheet } from '@/lib/api';

/**
 * The revenue cycle's arithmetic, tested against the fixtures rather than
 * through a render. A biller is trusting these numbers, so they are checked
 * where they are computed.
 */

function sheet(index = 0): FeeSheet {
  const found = MOCK_FEE_SHEETS[index];
  if (!found) throw new Error('Fixture missing');
  return found;
}

describe('fee sheet totals', () => {
  it('sums units times fee and leaves deleted lines out', () => {
    const first = sheet(0);
    const totals = feeSheetTotals(first, first.lines);
    // 186 + 18 + 96, all one unit.
    expect(totals.charges).toBe(300);
    expect(totals.activeLines).toBe(3);
  });

  it('excludes a removed line from the money but keeps it on the sheet', () => {
    const second = sheet(1);
    const totals = feeSheetTotals(second, second.lines);
    expect(second.lines).toHaveLength(3);
    expect(totals.activeLines).toBe(2);
    expect(totals.charges).toBe(150);
    const removed = second.lines[2];
    expect(removed && lineCharge(removed)).toBe(0);
  });

  it('takes the collected copay off what the payer is asked for', () => {
    const first = sheet(0);
    const totals = feeSheetTotals(first, first.lines);
    expect(totals.copayCollected).toBe(30);
    expect(totals.expectedFromPayer).toBe(270);
  });
});

describe('scrubFeeSheet', () => {
  it('blocks on a line with no diagnosis linked, naming the code', () => {
    const first = sheet(0);
    const blocking = blockingFindings(scrubFeeSheet(first, first.lines));
    expect(blocking).toHaveLength(1);
    expect(blocking[0]?.message).toContain('93000');
    expect(blocking[0]?.lineId).toBe('c001-l3');
  });

  it('clears once every active line carries a diagnosis', () => {
    const first = sheet(0);
    const justified = first.lines.map((line) =>
      line.justifiedBy.length === 0 ? { ...line, justifiedBy: ['I10'] } : line
    );
    expect(blockingFindings(scrubFeeSheet(first, justified))).toHaveLength(0);
  });

  it('blocks a sheet with no charges at all', () => {
    const blocking = blockingFindings(scrubFeeSheet(sheet(0), []));
    expect(blocking[0]?.id).toBe('no-charges');
  });

  it('raises an uncollected copay and an exhausted authorisation as advisory only', () => {
    const second = sheet(1);
    const findings = scrubFeeSheet(second, second.lines);
    const ids = findings.map((finding) => finding.id);
    expect(ids).toContain('copay-outstanding');
    expect(ids).toContain('auth');
    // Advisory findings must never stop the handover.
    expect(blockingFindings(findings).every((finding) => finding.id !== 'auth')).toBe(true);
  });

  it('warns when the same code is billed twice without a modifier', () => {
    const first = sheet(0);
    const doubled: ChargeLine[] = [
      ...first.lines.map((line) => ({ ...line, justifiedBy: ['I10'] })),
      {
        ...newChargeLine({ code: '36415', display: 'Venipuncture', fee: 18 }, 9),
        justifiedBy: ['I10'],
      },
    ];
    const findings = scrubFeeSheet(first, doubled);
    expect(findings.some((finding) => finding.id.startsWith('duplicate-'))).toBe(true);
  });
});

describe('diagnosisPointer', () => {
  it('numbers diagnoses the way a claim form does', () => {
    expect(diagnosisPointer(0)).toBe('A');
    expect(diagnosisPointer(3)).toBe('D');
  });
});

describe('newChargeLine', () => {
  it('starts unjustified, which is the honest state for a code just added', () => {
    const line = newChargeLine({ code: '99213', display: 'Office visit', fee: 128 }, 1);
    expect(line.justifiedBy).toEqual([]);
    expect(line.deleted).toBe(false);
    expect(line.units).toBe(1);
  });
});

describe('claim ageing', () => {
  it('measures age from the state it entered, not from the visit', () => {
    const claim = MOCK_CLAIMS.find((candidate) => candidate.claimNumber === 'CLM-24076');
    expect(claim).toBeDefined();
    if (!claim) return;
    expect(claimAgeDays(claim, MOCK_NOW)).toBeGreaterThan(30);
  });

  it('never returns a negative age', () => {
    const claim = MOCK_CLAIMS[0];
    if (!claim) throw new Error('Fixture missing');
    expect(claimAgeDays(claim, '2020-01-01T00:00:00.000Z')).toBe(0);
  });

  it('labels every age band in words, not by colour alone', () => {
    expect(ageingState(2).label).toBe('On track');
    expect(ageingState(20).label).toBe('Ageing');
    expect(ageingState(45).label).toBe('Over 30 days');
    expect(ageingState(90).label).toBe('Over 60 days');
  });

  it('splits the queue into four bands whose counts add up', () => {
    const bands = claimAgeingBands(MOCK_CLAIMS, MOCK_NOW);
    expect(bands).toHaveLength(4);
    expect(bands.reduce((total, band) => total + band.count, 0)).toBe(MOCK_CLAIMS.length);
  });
});

describe('claim states', () => {
  it('counts every state, including the ones with nothing in them', () => {
    const counts = claimCounts(MOCK_CLAIMS);
    expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBe(
      MOCK_CLAIMS.length
    );
    expect(counts.DENIED).toBeGreaterThan(0);
  });

  it('offers a bulk action only where the state earns one', () => {
    expect(bulkActionsFor('CAPTURED')[0]?.next).toBe('SCRUBBED');
    expect(bulkActionsFor('SCRUBBED')[0]?.next).toBe('SUBMITTED');
    expect(bulkActionsFor('DENIED')[0]?.next).toBe('REBILLED');
    expect(bulkActionsFor('PAID')).toHaveLength(0);
  });

  it('marks a claim carrying scrub errors as blocked', () => {
    const blocked = MOCK_CLAIMS.filter(isBlockedByScrub);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((claim) => claim.status === 'CAPTURED')).toBe(true);
  });

  it('never pretends a denied claim was heading for payment', () => {
    expect(claimLifecycle('DENIED')).not.toContain('PAID');
    expect(claimLifecycle('REBILLED')).toEqual([
      'CAPTURED',
      'SCRUBBED',
      'SUBMITTED',
      'ACKNOWLEDGED',
      'DENIED',
      'REBILLED',
    ]);
    expect(claimLifecycle('SUBMITTED')).toContain('PAID');
  });

  it('gives every claim a timeline that ends in the state the row shows', () => {
    for (const claim of MOCK_CLAIMS) {
      const statuses = claim.events.map((event) => event.status).filter(Boolean);
      expect(statuses).toContain(claim.status);
    }
  });
});

describe('remittance', () => {
  it('labels an underpaid line as underpaid, with the shortfall', () => {
    const era = MOCK_REMITTANCES[0];
    if (!era) throw new Error('Fixture missing');
    const short = era.lines.find((line) => line.claimNumber === 'CLM-24045');
    if (!short) throw new Error('Fixture missing');
    const variance = lineVariance(short);
    expect(variance.label).toBe('Underpaid');
    expect(variance.amount).toBe(-18);
    expect(variance.tone).toBe('danger');
  });

  it('calls a line that paid what was expected matched', () => {
    const era = MOCK_REMITTANCES[1];
    if (!era) throw new Error('Fixture missing');
    expect(era.lines.every((line) => lineVariance(line).label === 'Matched')).toBe(true);
  });

  it('summarises how much posted without a human', () => {
    const era = MOCK_REMITTANCES[0];
    if (!era) throw new Error('Fixture missing');
    const summary = remittanceSummary(era);
    expect(summary.lines).toBe(5);
    expect(summary.exceptions).toBe(3);
    expect(summary.autoPostedPercent).toBe(40);
  });

  it('reports a clean remittance as fully auto-posted', () => {
    const era = MOCK_REMITTANCES[1];
    if (!era) throw new Error('Fixture missing');
    expect(remittanceSummary(era).autoPostedPercent).toBe(100);
  });
});

describe('accounts receivable', () => {
  it('adds every account into the four buckets', () => {
    const summary = arSummary(MOCK_STATEMENT_ACCOUNTS);
    const balances = MOCK_STATEMENT_ACCOUNTS.reduce((total, row) => total + row.balance, 0);
    expect(summary.total).toBe(balances);
    expect(summary.accounts).toBe(MOCK_STATEMENT_ACCOUNTS.length);
  });

  it('treats older money as more serious', () => {
    expect(bucketTone('CURRENT')).toBe('success');
    expect(bucketTone('DAYS_31_60')).toBe('neutral');
    expect(bucketTone('DAYS_91_PLUS')).toBe('danger');
  });

  it('escalates the dunning ladder one rung at a time and stops at collections', () => {
    expect(nextDunningStage('NONE')).toBe('FIRST_NOTICE');
    expect(nextDunningStage('FINAL_NOTICE')).toBe('COLLECTIONS');
    expect(nextDunningStage('COLLECTIONS')).toBe('COLLECTIONS');
  });

  it('totals a statement to what the patient still owes', () => {
    const account = MOCK_STATEMENT_ACCOUNTS.find((row) => row.lines.length > 1);
    if (!account) throw new Error('Fixture missing');
    const totals = statementTotals(account.lines);
    expect(totals.outstanding).toBe(
      account.lines.reduce((total, line) => total + line.outstanding, 0)
    );
  });
});

describe('payment allocation', () => {
  const items = [
    {
      visitId: 'v2',
      serviceDate: '2026-07-01T09:00:00.000Z',
      description: 'Later',
      outstanding: 40,
    },
    {
      visitId: 'v1',
      serviceDate: '2026-05-01T09:00:00.000Z',
      description: 'Older',
      outstanding: 25,
    },
  ];

  it('applies the money to the oldest visit first', () => {
    expect(autoAllocate(30, items)).toEqual({ v1: 25, v2: 5 });
  });

  it('never allocates more than the payment', () => {
    const allocations = autoAllocate(10, items);
    expect(allocations).toEqual({ v1: 10 });
  });

  it('never allocates more to a visit than that visit owes', () => {
    const allocations = autoAllocate(500, items);
    expect(allocations.v1).toBe(25);
    expect(allocations.v2).toBe(40);
  });

  it('reports the remainder without floating-point drift', () => {
    expect(unallocated(38.4, { v1: 12.1, v2: 26.3 })).toBe(0);
    expect(allocationState(38.4, { v1: 12.1, v2: 26.3 }).balanced).toBe(true);
  });

  it('calls an over-allocation an error rather than a warning', () => {
    const state = allocationState(20, { v1: 25 });
    expect(state.over).toBe(true);
    expect(state.balanced).toBe(false);
    expect(state.unallocated).toBe(-5);
  });

  it('is never balanced when nothing is being taken', () => {
    expect(allocationState(0, {}).balanced).toBe(false);
  });

  it('names each of the three allocation states exactly once', () => {
    expect(allocationStateName(allocationState(20, { v1: 25 }))).toBe('over');
    expect(allocationStateName(allocationState(20, { v1: 20 }))).toBe('balanced');
    expect(allocationStateName(allocationState(20, { v1: 5 }))).toBe('short');
    expect(allocationStateName(allocationState(0, {}))).toBe('short');
  });

  it('gives the chip and the button hint the same reading of one payment', () => {
    const over = allocationStateName(allocationState(20, { v1: 25 }));
    expect(ALLOCATION_STATE_LABELS[over]).toBe('Over-allocated');
    expect(ALLOCATION_HINTS[over]).toBe('More is allocated than is being taken.');

    const balanced = allocationStateName(allocationState(20, { v1: 20 }));
    expect(ALLOCATION_STATE_LABELS[balanced]).toBe('Fully allocated');
    expect(ALLOCATION_HINTS[balanced]).toBe('Every amount is applied to a visit.');
  });

  it('reads a receipt oldest visit first', () => {
    const rows = receiptRows([
      {
        id: 'b',
        visitId: 'v2',
        serviceDate: '2026-07-01T09:00:00.000Z',
        description: 'Later',
        outstanding: 10,
        allocated: 10,
      },
      {
        id: 'a',
        visitId: 'v1',
        serviceDate: '2026-05-01T09:00:00.000Z',
        description: 'Older',
        outstanding: 10,
        allocated: 10,
      },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });
});

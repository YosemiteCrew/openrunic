import { describe, expect, it } from 'vitest';

import {
  claimAgeDays,
  claimAgeingBands,
  lineVariance,
  nextDunningStage,
  remittanceSummary,
} from '@/components/billing/billing';
import {
  categoryViz,
  dayWindow,
  findOpenSlots,
  minutesBetween,
  minutesOfDay,
  nextStatus,
  presentStatus,
  rowForInstant,
} from '@/components/schedule/schedule';
import {
  filterInbox,
  filterOrders,
  filterResults,
  isBulkSignable,
  patientProblems,
  slaState,
} from '@/lib/api';
import { MOCK_CLAIMS, MOCK_REMITTANCES } from '@/lib/api/mock/billing';
import {
  MOCK_APPOINTMENTS,
  MOCK_INBOX_ITEMS,
  MOCK_NOW,
  MOCK_ORDERS,
  MOCK_RESULTS,
  mockResultById,
  mockStatusSince,
} from '@/lib/api/mock/fixtures';
import type { Claim, RemittanceLine } from '@/lib/api';

/**
 * The domain helpers, at the edges a screen test never reaches.
 *
 * Each of these is a place where an absent, malformed or out-of-order value
 * arrives from a payer file, an interface message or a clock that disagrees
 * with ours, and each one has to answer with something a clinic can read
 * instead of NaN, Invalid Date, or a countdown running backwards.
 */

function claim(overrides: Partial<Claim>): Claim {
  return { ...MOCK_CLAIMS[0]!, ...overrides };
}

describe('claimAgeDays', () => {
  it('counts whole days a claim has sat in its current state', () => {
    expect(
      claimAgeDays(claim({ statusSince: '2026-07-01T09:00:00.000Z' }), '2026-07-15T09:00:00.000Z')
    ).toBe(14);
  });

  it('reads an unparseable timestamp as zero rather than as NaN days', () => {
    // A payer file with a malformed date must not put "NaN days" in the ageing
    // strip, and must not sort to the top of the work queue as if it were the
    // oldest claim in the practice.
    expect(claimAgeDays(claim({ statusSince: 'not a date' }), MOCK_NOW)).toBe(0);
    expect(claimAgeDays(claim({}), new Date('not a date'))).toBe(0);
  });

  it('takes a Date as readily as an ISO string', () => {
    expect(
      claimAgeDays(
        claim({ statusSince: '2026-07-01T09:00:00.000Z' }),
        new Date('2026-07-03T09:00:00.000Z')
      )
    ).toBe(2);
  });
});

describe('claimAgeingBands', () => {
  it('puts a claim in exactly one band, at every boundary', () => {
    const at = (days: number) =>
      claim({
        id: `c-${days}`,
        statusSince: new Date(Date.parse(MOCK_NOW) - days * 86_400_000).toISOString(),
      });
    const bands = claimAgeingBands(
      [at(0), at(13), at(14), at(29), at(30), at(59), at(60)],
      MOCK_NOW
    );

    expect(bands.map((band) => band.count)).toEqual([2, 2, 2, 1]);
    expect(bands.map((band) => band.label)).toEqual([
      '0 to 13 days',
      '14 to 29 days',
      '30 to 59 days',
      '60 days and over',
    ]);
  });

  it('carries the money still outstanding, not the money already paid', () => {
    const bands = claimAgeingBands(
      [claim({ billed: 200, paid: 50, statusSince: MOCK_NOW })],
      MOCK_NOW
    );

    expect(bands[0]!.amount).toBe(150);
    expect(bands.slice(1).every((band) => band.amount === 0)).toBe(true);
  });

  it('renders every band even with nothing in the queue, so the strip never collapses', () => {
    const bands = claimAgeingBands([], MOCK_NOW);

    expect(bands).toHaveLength(4);
    expect(bands.every((band) => band.count === 0 && band.amount === 0)).toBe(true);
  });
});

describe('lineVariance', () => {
  const base = MOCK_REMITTANCES[0]!.lines[0]!;
  const line = (paid: number, expectedPaid: number): RemittanceLine => ({
    ...base,
    paid,
    expectedPaid,
  });

  it('names an overpayment as such rather than calling it a match', () => {
    // A payer paying more than the contract says is an exception, not a
    // rounding artefact, and it has to be findable later.
    expect(lineVariance(line(120, 100))).toEqual({
      amount: 20,
      tone: 'neutral',
      label: 'Overpaid',
    });
  });

  it('names an underpayment with the shortfall as a negative', () => {
    expect(lineVariance(line(80, 100))).toMatchObject({ amount: -20, label: 'Underpaid' });
  });

  it('calls an exact payment matched', () => {
    expect(lineVariance(line(100, 100))).toMatchObject({ amount: 0, label: 'Matched' });
  });
});

describe('remittanceSummary', () => {
  it('reports zero percent auto-posted for a remittance with no lines at all', () => {
    // Not NaN: an 835 that arrived empty still renders a summary card.
    const summary = remittanceSummary({ ...MOCK_REMITTANCES[0]!, lines: [] });

    expect(summary).toMatchObject({
      lines: 0,
      autoPosted: 0,
      exceptions: 0,
      autoPostedPercent: 0,
      paid: 0,
    });
  });
});

describe('nextDunningStage', () => {
  it('climbs one rung at a time and stops at collections', () => {
    expect(nextDunningStage('NONE')).toBe('FIRST_NOTICE');
    expect(nextDunningStage('FIRST_NOTICE')).toBe('SECOND_NOTICE');
    expect(nextDunningStage('SECOND_NOTICE')).toBe('FINAL_NOTICE');
    expect(nextDunningStage('FINAL_NOTICE')).toBe('COLLECTIONS');
    // Already at the end: a statement run must not invent a rung beyond it.
    expect(nextDunningStage('COLLECTIONS')).toBe('COLLECTIONS');
  });
});

describe('presentStatus', () => {
  it('gives cancelled and entered-in-error their own words', () => {
    expect(presentStatus('CANCELLED')).toMatchObject({ tone: 'neutral', done: true });
    expect(presentStatus('ENTERED_IN_ERROR')).toMatchObject({
      label: 'Entered in error',
      tone: 'danger',
      done: true,
    });
  });
});

describe('categoryViz', () => {
  it('is case-insensitive on a known code', () => {
    expect(categoryViz('followup')).toBe(1);
    expect(categoryViz('FollowUp')).toBe(1);
    expect(categoryViz('IMMUNISATION')).toBe(6);
  });

  it('keeps an unknown code inside the six-slot ramp, deterministically', () => {
    for (const code of ['ZZZ', 'a', 'unknown visit type', '']) {
      const slot = categoryViz(code);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(6);
      expect(categoryViz(code)).toBe(slot);
    }
  });
});

describe('minutesOfDay and rowForInstant', () => {
  it('refuses an absent or malformed instant rather than returning midnight', () => {
    expect(minutesOfDay(null)).toBeNull();
    expect(minutesOfDay(undefined)).toBeNull();
    expect(minutesOfDay('')).toBeNull();
    expect(minutesOfDay('not a date')).toBeNull();
  });

  it('puts an unreadable instant on the first row rather than off the grid', () => {
    const window = dayWindow([]);

    expect(rowForInstant('not a date', window)).toBe(1);
  });

  it('clamps an instant outside the day onto the grid it does have', () => {
    const window = dayWindow([]);

    expect(rowForInstant('2026-08-12T00:00:00.000Z', window)).toBe(1);
    expect(rowForInstant('2026-08-12T23:59:00.000Z', window)).toBe(window.rows + 1);
  });
});

describe('nextStatus', () => {
  it('returns nothing at the end of the flow and for a status off it', () => {
    expect(nextStatus('FULFILLED')).toBeNull();
    expect(nextStatus('CANCELLED')).toBeNull();
    expect(nextStatus('NOSHOW')).toBeNull();
  });
});

describe('minutesBetween', () => {
  it('reads an unparseable start as zero, never as a countdown', () => {
    expect(minutesBetween('not a date', new Date(MOCK_NOW))).toBe(0);
    expect(minutesBetween(null, new Date(MOCK_NOW))).toBe(0);
    expect(minutesBetween(undefined, new Date(MOCK_NOW))).toBe(0);
  });
});

describe('findOpenSlots', () => {
  it('takes the day window as the floor when the search starts before opening', () => {
    const slots = findOpenSlots(
      MOCK_APPOINTMENTS,
      [MOCK_APPOINTMENTS[0]!.providerId],
      '2026-08-12',
      new Date('2026-08-12T00:00:00.000Z'),
      { durationMinutes: 20, limit: 3 }
    );

    // No slot before the clinic opens, however early the caller asks from.
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.start >= '2026-08-12T07:00:00.000Z')).toBe(true);
  });

  it('honours an explicit limit and duration', () => {
    const slots = findOpenSlots(
      MOCK_APPOINTMENTS,
      [MOCK_APPOINTMENTS[0]!.providerId],
      '2026-08-12',
      new Date(MOCK_NOW),
      { durationMinutes: 40, limit: 2 }
    );

    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(Date.parse(slot.end) - Date.parse(slot.start)).toBe(40 * 60_000);
    }
  });
});

describe('slaState', () => {
  it('treats an unreadable due date as on time rather than screaming overdue', () => {
    // A malformed dueAt on one interface message must not paint the whole
    // inbox red and reorder the queue around it.
    expect(slaState('not a date', MOCK_NOW)).toBe('ON_TIME');
  });
});

describe('isBulkSignable', () => {
  it('excludes anything already signed, whatever its flag', () => {
    const signed = MOCK_RESULTS.find((report) => report.status === 'SIGNED');

    expect(signed && isBulkSignable(signed)).toBe(false);
  });
});

describe('patientProblems', () => {
  it('answers with an empty list for no patient and for an unknown one', () => {
    expect(patientProblems(null)).toEqual([]);
    expect(patientProblems('no-such-patient')).toEqual([]);
  });
});

describe('mockResultById and mockStatusSince', () => {
  it('answers nothing for a ledger row with no report behind it', () => {
    expect(mockResultById(null)).toBeUndefined();
    expect(mockResultById('no-such-result')).toBeUndefined();
    expect(mockResultById(MOCK_RESULTS[0]!.id)).toBe(MOCK_RESULTS[0]);
  });

  it('falls back to the arrival time, so a card always has a clock to show', () => {
    for (const appointment of MOCK_APPOINTMENTS) {
      const since = mockStatusSince(appointment);
      expect(since === null || !Number.isNaN(Date.parse(since))).toBe(true);
    }
  });
});

describe('the worklist filters', () => {
  it('scopes orders to one patient, one state and one category', () => {
    const patientId = MOCK_ORDERS[0]!.patientId;
    expect(
      filterOrders(MOCK_ORDERS, { patientId }).every((order) => order.patientId === patientId)
    ).toBe(true);

    const byStatus = filterOrders(MOCK_ORDERS, { status: 'IN_PROGRESS' });
    expect(byStatus.length).toBeGreaterThan(0);
    expect(byStatus.every((order) => order.status === 'IN_PROGRESS')).toBe(true);

    const byCategory = filterOrders(MOCK_ORDERS, { category: 'IMAGING' });
    expect(byCategory.length).toBeGreaterThan(0);
    expect(byCategory.every((order) => order.category === 'IMAGING')).toBe(true);
  });

  it('scopes results by flag, by state and by chart', () => {
    const critical = filterResults(MOCK_RESULTS, { flag: 'CRITICAL' });
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((report) => report.flag === 'CRITICAL')).toBe(true);

    expect(
      filterResults(MOCK_RESULTS, { status: 'SIGNED' }).every(
        (report) => report.status === 'SIGNED'
      )
    ).toBe(true);

    const patientId = MOCK_RESULTS[0]!.patientId;
    expect(
      filterResults(MOCK_RESULTS, { patientId }).every((report) => report.patientId === patientId)
    ).toBe(true);
  });

  it('scopes the inbox by stream and by assignment together', () => {
    const mine = filterInbox(MOCK_INBOX_ITEMS, { assignedTo: 'ME' });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((item) => item.assignedTo === 'ME')).toBe(true);

    const both = filterInbox(MOCK_INBOX_ITEMS, { stream: 'REFILLS', assignedTo: 'ME' });
    expect(both.every((item) => item.stream === 'REFILLS' && item.assignedTo === 'ME')).toBe(true);
    expect(both.length).toBeLessThanOrEqual(mine.length);
  });
});

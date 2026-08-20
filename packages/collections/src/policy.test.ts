import { describe, expect, it } from 'vitest';

import {
  ageBalance,
  agingBucket,
  daysBetween,
  DEFAULT_DUNNING_POLICY,
  nextAction,
  validateDunningPolicy,
  type BalanceState,
  type DunningPolicy,
} from './index.js';

const TODAY = new Date('2026-08-20T00:00:00.000Z');

function days(n: number): Date {
  return new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000);
}

function balance(overrides: Partial<BalanceState> = {}): BalanceState {
  return {
    balanceCents: 12_500,
    noticesSent: 0,
    lastNoticeAt: null,
    dueSince: days(10),
    heldUntil: null,
    ...overrides,
  };
}

describe('ageing', () => {
  it.each([
    [0, 'current'],
    [-5, 'current'],
    [1, '1-30'],
    [30, '1-30'],
    [31, '31-60'],
    [60, '31-60'],
    [61, '61-90'],
    [90, '61-90'],
    [91, '90+'],
    [400, '90+'],
  ])('puts %i days overdue in %s', (overdue, bucket) => {
    expect(agingBucket(overdue)).toBe(bucket);
  });

  it('counts whole days, and reads a balance not yet due as current', () => {
    // A balance due tomorrow is not overdue by minus one day in any report a
    // biller reads; it is simply current.
    expect(daysBetween(new Date('2026-08-21T00:00:00.000Z'), TODAY)).toBe(-1);
    expect(ageBalance(balance({ dueSince: days(-1) }), DEFAULT_DUNNING_POLICY, TODAY).bucket).toBe(
      'current'
    );
  });

  it('does not round a partial day up into the next bucket', () => {
    // 30 days and 23 hours is still the 1-30 bucket. Rounding here would move
    // balances a day early into a bucket a practice may act on.
    const almost = new Date(TODAY.getTime() - (30 * 24 + 23) * 60 * 60 * 1000);
    expect(agingBucket(daysBetween(almost, TODAY))).toBe('1-30');
  });
});

describe('what to do with a balance today', () => {
  it('sends the first notice as soon as there is one owed', () => {
    expect(nextAction(balance(), DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'notice',
      notice: 1,
    });
  });

  it('waits until the interval has passed, then sends the next', () => {
    const sentRecently = balance({ noticesSent: 1, lastNoticeAt: days(10) });
    const waiting = nextAction(sentRecently, DEFAULT_DUNNING_POLICY, TODAY);
    expect(waiting.kind).toBe('wait');

    const sentLongAgo = balance({ noticesSent: 1, lastNoticeAt: days(31) });
    expect(nextAction(sentLongAgo, DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'notice',
      notice: 2,
    });
  });

  it('reports when the next notice falls due, so a worklist can say so', () => {
    const action = nextAction(
      balance({ noticesSent: 1, lastNoticeAt: days(10) }),
      DEFAULT_DUNNING_POLICY,
      TODAY
    );

    expect(action).toStrictEqual({
      kind: 'wait',
      nextNoticeDueAt: new Date('2026-09-09T00:00:00.000Z'),
    });
  });

  it('never sends two notices closer together than the practice allows', () => {
    // A schedule of one day with a seven-day floor. The floor wins, which is
    // the case that matters: replaying a job or a double click must not chase
    // the same patient twice in a week.
    const impatient: DunningPolicy = {
      intervalDays: [1, 1, 1],
      smallBalanceCents: 0,
      minimumNoticeGapDays: 7,
    };
    const yesterday = balance({ noticesSent: 1, lastNoticeAt: days(1) });

    expect(nextAction(yesterday, impatient, TODAY)).toStrictEqual({
      kind: 'wait',
      nextNoticeDueAt: new Date('2026-08-26T00:00:00.000Z'),
    });
  });

  it('leaves the schedule alone when it is already slower than the floor', () => {
    const patient: DunningPolicy = { ...DEFAULT_DUNNING_POLICY, minimumNoticeGapDays: 2 };

    expect(
      nextAction(balance({ noticesSent: 1, lastNoticeAt: days(5) }), patient, TODAY)
    ).toStrictEqual({ kind: 'wait', nextNoticeDueAt: new Date('2026-09-14T00:00:00.000Z') });
  });

  it('escalates to a human once every notice has been sent', () => {
    const exhausted = balance({ noticesSent: 3, lastNoticeAt: days(60) });

    expect(nextAction(exhausted, DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'escalate',
    });
  });

  it('writes off a small balance once the notices are exhausted, not before', () => {
    const small = { balanceCents: 300 };

    // One bill is still worth sending. It is the chasing that costs more than
    // it recovers, and a practice that never asked has not chased.
    expect(nextAction(balance(small), DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'notice',
      notice: 1,
    });
    expect(
      nextAction(
        balance({ ...small, noticesSent: 3, lastNoticeAt: days(60) }),
        DEFAULT_DUNNING_POLICY,
        TODAY
      )
    ).toStrictEqual({ kind: 'write-off', reason: 'small-balance' });
  });

  it('escalates a small balance when the practice turned the threshold off', () => {
    const noWriteOff: DunningPolicy = { ...DEFAULT_DUNNING_POLICY, smallBalanceCents: 0 };

    // Zero is a choice, not a missing value: every balance reaches a human.
    expect(
      nextAction(
        balance({ balanceCents: 1, noticesSent: 3, lastNoticeAt: days(60) }),
        noWriteOff,
        TODAY
      )
    ).toStrictEqual({ kind: 'escalate' });
  });

  it('honours a hold over everything except a settled balance', () => {
    const held = balance({ heldUntil: new Date('2026-09-01T00:00:00.000Z') });

    expect(nextAction(held, DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'held',
      until: new Date('2026-09-01T00:00:00.000Z'),
    });
    // A hold is a promise not to chase, not a reason to keep billing a patient
    // who has already paid.
    expect(nextAction({ ...held, balanceCents: 0 }, DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'settled',
    });
  });

  it('resumes on the day the hold expires', () => {
    const expired = balance({ heldUntil: TODAY });

    expect(nextAction(expired, DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'notice',
      notice: 1,
    });
  });

  it.each([0, -250])('treats a balance of %i as settled', (balanceCents) => {
    // A credit balance is the practice's problem to refund, and it is certainly
    // not something to send a demand for.
    expect(nextAction(balance({ balanceCents }), DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'settled',
    });
  });

  it('bills a row whose notice count and notice date contradict each other', () => {
    // A date for the last notice with a count saying none was sent should not
    // happen, and this is what happens when it does. Without the guard the
    // interval lookup returns undefined, the arithmetic produces an invalid
    // date, the comparison against it is false, and the balance quietly waits
    // instead of being billed. Failing towards sending the first notice is the
    // recoverable direction: a patient can query a bill they did not expect,
    // and nobody can query one that was never sent.
    const contradictory = balance({ noticesSent: 0, lastNoticeAt: days(1) });

    expect(nextAction(contradictory, DEFAULT_DUNNING_POLICY, TODAY)).toStrictEqual({
      kind: 'notice',
      notice: 1,
    });
  });

  it('carries the ageing and the decision together, which is a worklist row', () => {
    expect(
      ageBalance(balance({ dueSince: days(75) }), DEFAULT_DUNNING_POLICY, TODAY)
    ).toStrictEqual({ daysOverdue: 75, bucket: '61-90', action: { kind: 'notice', notice: 1 } });
  });
});

describe('validating a practice policy', () => {
  it('accepts the default', () => {
    expect(validateDunningPolicy(DEFAULT_DUNNING_POLICY)).toStrictEqual([]);
  });

  it('refuses a schedule that would never send anything', () => {
    expect(validateDunningPolicy({ ...DEFAULT_DUNNING_POLICY, intervalDays: [] })).toContainEqual(
      expect.stringContaining('at least one interval')
    );
  });

  it.each([[0], [-1], [1.5]])('refuses an interval of %s days', (bad) => {
    expect(
      validateDunningPolicy({ ...DEFAULT_DUNNING_POLICY, intervalDays: [30, bad] })
    ).toHaveLength(1);
  });

  it.each([[0], [-1], [2.5]])('refuses a notice gap of %s days', (bad) => {
    expect(
      validateDunningPolicy({ ...DEFAULT_DUNNING_POLICY, minimumNoticeGapDays: bad })
    ).toHaveLength(1);
  });

  it.each([[-1], [10.5]])('refuses a write-off threshold of %s cents', (bad) => {
    expect(
      validateDunningPolicy({ ...DEFAULT_DUNNING_POLICY, smallBalanceCents: bad })
    ).toHaveLength(1);
  });

  it('reports every problem at once rather than the first', () => {
    // An operator fixing one thing at a time, guided by one error per save, is
    // how a five-field form takes five round trips.
    expect(
      validateDunningPolicy({ intervalDays: [], smallBalanceCents: -1, minimumNoticeGapDays: 0 })
    ).toHaveLength(3);
  });

  it('returns problems rather than throwing them', () => {
    // A validator that throws is served as a bare 500, which is the validator
    // failing in exactly the way it exists to prevent.
    expect(() =>
      validateDunningPolicy({
        intervalDays: [Number.NaN],
        smallBalanceCents: Number.NaN,
        minimumNoticeGapDays: Number.NaN,
      })
    ).not.toThrow();
  });
});

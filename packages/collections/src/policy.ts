/**
 * WHEN TO ASK AGAIN, AND WHEN TO STOP.
 *
 * A practice that has sent a bill and not been paid has a small number of
 * honest options: wait, ask again, or stop asking. This module decides which,
 * and it is deliberately the only place that decides, because the alternative
 * is that the answer differs between the screen a biller reads, the job that
 * sends notices and the report the practice manager trusts.
 *
 * Everything here is pure. It takes the state of one balance and the practice's
 * own policy, and returns what should happen to it. It reads nothing, writes
 * nothing, and knows no dates except the one it is given.
 *
 * ## Why a practice configures this rather than inheriting it
 *
 * How hard to chase a patient for money is not a technical question. Statutes
 * of limitation, state rules on medical debt, and what a practice is willing to
 * do to the people it treats all vary, and none of them belong hard-coded in an
 * EMR. What the software owes is that the configured policy is applied evenly,
 * that nobody is dunned faster than the practice said, and that the decision is
 * explainable afterwards.
 */

/** Days past due, bucketed the way every ageing report in this industry buckets. */
export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface DunningPolicy {
  /**
   * Days to wait after each notice before the next one is due, in order.
   *
   * The length of this list is the number of notices the practice sends: a
   * three-entry list means notice 1, 2 and 3, and then the balance has run out
   * of notices and needs a decision. There is no implicit fourth.
   */
  readonly intervalDays: readonly number[];
  /**
   * A balance at or below this is not worth pursuing and is written off once
   * the notices are exhausted.
   *
   * Zero disables it, which is a real choice and not a missing value: a practice
   * may want every balance to reach a human.
   */
  readonly smallBalanceCents: number;
  /**
   * The soonest a second notice may follow a first, whatever `intervalDays`
   * says.
   *
   * A floor rather than a duplicate of the interval, because the interval is a
   * schedule and this is a protection. Backfilling old statements, replaying a
   * job, or an operator clicking twice all produce a second notice far sooner
   * than the schedule intended, and the patient experiences that as being
   * chased twice in a day for the same money.
   */
  readonly minimumNoticeGapDays: number;
}

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  intervalDays: [30, 30, 30],
  smallBalanceCents: 500,
  minimumNoticeGapDays: 7,
};

/** What a balance looks like to this module. Deliberately smaller than a Statement. */
export interface BalanceState {
  readonly balanceCents: number;
  /** Which notice has already gone out. 0 means none has. */
  readonly noticesSent: number;
  /** When the last notice went out, or null when none has. */
  readonly lastNoticeAt: Date | null;
  /** When the balance first became the patient's to pay. */
  readonly dueSince: Date;
  /** Set while the practice has agreed not to chase: a dispute, or hardship. */
  readonly heldUntil: Date | null;
}

export type CollectionsAction =
  /** Nothing to do: the schedule says the next notice is not due yet. */
  | { readonly kind: 'wait'; readonly nextNoticeDueAt: Date }
  /** Send the next notice. `notice` is which one it will be, counting from 1. */
  | { readonly kind: 'notice'; readonly notice: number }
  /** Small enough that chasing it costs more than it recovers. */
  | { readonly kind: 'write-off'; readonly reason: 'small-balance' }
  /** Every notice has been sent and the balance is still owed. A human decides. */
  | { readonly kind: 'escalate' }
  /** The practice agreed not to chase this, until the date given. */
  | { readonly kind: 'held'; readonly until: Date }
  /** There is nothing owed. */
  | { readonly kind: 'settled' };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

/**
 * When the next notice becomes due, given how many have gone out.
 *
 * Null means no further notice is scheduled, either because the practice has
 * sent all of them or because none has gone out yet and the first is due now.
 */
function nextNoticeDueAt(state: BalanceState, policy: DunningPolicy): Date | null {
  if (state.lastNoticeAt === null) return null;
  const interval = policy.intervalDays[state.noticesSent - 1];
  if (interval === undefined) return null;
  const scheduled = addDays(state.lastNoticeAt, interval);
  // The gap floor can only ever push a notice later, never earlier. Taking the
  // maximum rather than replacing the schedule is what keeps it a protection
  // instead of a second, competing schedule.
  const floor = addDays(state.lastNoticeAt, policy.minimumNoticeGapDays);
  return scheduled > floor ? scheduled : floor;
}

/**
 * What should happen to this balance today.
 *
 * The order of the checks is the policy. Settled beats everything, because a
 * paid balance must never produce a notice whatever else is true of it. A hold
 * beats the schedule, because a hold is the practice's own promise. Only then
 * does the money matter, and only then the calendar.
 */
export function nextAction(
  state: BalanceState,
  policy: DunningPolicy,
  today: Date
): CollectionsAction {
  if (state.balanceCents <= 0) return { kind: 'settled' };
  if (state.heldUntil !== null && state.heldUntil > today) {
    return { kind: 'held', until: state.heldUntil };
  }

  const exhausted = state.noticesSent >= policy.intervalDays.length;
  if (exhausted) {
    // Write-off is checked only here, not before the first notice. A small
    // balance is still worth one bill; it is the chasing that costs more than
    // it recovers, and a practice that never asked has not chased.
    if (policy.smallBalanceCents > 0 && state.balanceCents <= policy.smallBalanceCents) {
      return { kind: 'write-off', reason: 'small-balance' };
    }
    return { kind: 'escalate' };
  }

  const due = nextNoticeDueAt(state, policy);
  if (due !== null && due > today) return { kind: 'wait', nextNoticeDueAt: due };
  return { kind: 'notice', notice: state.noticesSent + 1 };
}

export interface AgedBalance {
  readonly daysOverdue: number;
  readonly bucket: AgingBucket;
  readonly action: CollectionsAction;
}

/** The ageing line and the decision for one balance, which is what a worklist row is. */
export function ageBalance(state: BalanceState, policy: DunningPolicy, today: Date): AgedBalance {
  const daysOverdue = daysBetween(state.dueSince, today);
  return {
    daysOverdue,
    bucket: agingBucket(daysOverdue),
    action: nextAction(state, policy, today),
  };
}

/**
 * Checks a practice-configured policy before it is saved.
 *
 * Returns the problems rather than throwing them. A validator that throws is
 * reported as a 500, which is the validator failing in exactly the way it
 * exists to prevent, and the operator learns nothing about what they typed.
 *
 * Every rule here describes a policy that would misbehave silently. An empty
 * schedule sends no notice ever while looking configured; a zero interval dunns
 * a patient every time a job runs; a negative threshold writes off balances the
 * practice is owed.
 */
export function validateDunningPolicy(policy: DunningPolicy): string[] {
  const problems: string[] = [];

  if (policy.intervalDays.length === 0) {
    problems.push('intervalDays must contain at least one interval, or no notice is ever sent.');
  }
  if (policy.intervalDays.some((days) => !Number.isInteger(days) || days < 1)) {
    problems.push('Every interval must be a whole number of days, one or more.');
  }
  if (!Number.isInteger(policy.minimumNoticeGapDays) || policy.minimumNoticeGapDays < 1) {
    problems.push('minimumNoticeGapDays must be a whole number of days, one or more.');
  }
  if (!Number.isInteger(policy.smallBalanceCents) || policy.smallBalanceCents < 0) {
    problems.push('smallBalanceCents must be a whole number of cents, zero or more.');
  }

  return problems;
}

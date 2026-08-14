import type { AgentBudgetConfig } from './config.js';

/**
 * Cost and abuse control, enforced server-side before the provider call.
 *
 * A staff assistant is an authenticated door to a metered paid API. Denial of
 * wallet is the relevant risk: a few hundred scripted requests can drain a
 * small clinic's month in under an hour. Provider dashboards are lagging,
 * per-account and not per-tenant; they are a smoke alarm, not a control.
 *
 * On a self-hosted endpoint the cost per token is zero but the GPU is not, so
 * the same abuse becomes a latency denial of service that degrades the clinic's
 * own assistant for everyone. Same limits, different currency.
 *
 * The hard stop degrades the agent to unavailable while **every clinical
 * workflow remains fully functional**. That is the operational proof that the
 * agent is genuinely optional, and it is why the ledger lives here rather than
 * anywhere on a clinical path.
 */

export const BUDGET_REFUSALS = [
  'daily-budget-exhausted',
  'monthly-budget-exhausted',
  'turn-already-in-flight',
  'message-too-long',
  'conversation-too-long',
] as const;

export type BudgetRefusal = (typeof BUDGET_REFUSALS)[number];

export type BudgetVerdict =
  { ok: true; warn: boolean } | { ok: false; reason: BudgetRefusal; detail: string };

export interface TurnRequest {
  tenantId: string;
  principalKey: string;
  characters: number;
  turnIndex: number;
  now?: number;
}

interface Ledger {
  day: string;
  dayCents: number;
  month: string;
  monthCents: number;
}

/**
 * Per-tenant ledger plus a per-principal in-flight lock.
 *
 * **Queue, do not parallelise.** One in-flight turn per principal, because
 * concurrency is how a single user turns a rate limit into a cost event.
 */
export class BudgetGuard {
  private readonly config: AgentBudgetConfig;
  private readonly ledgers = new Map<string, Ledger>();
  private readonly inFlight = new Set<string>();

  constructor(config: AgentBudgetConfig) {
    this.config = config;
  }

  /**
   * Decides whether a turn may start. Refusals are explicit and audited; there
   * is no silent queueing and no unbounded wait.
   */
  admit(request: TurnRequest): BudgetVerdict {
    const now = request.now ?? Date.now();

    if (request.characters > this.config.maxInputCharacters) {
      // Refuse above the limit rather than truncating. Silent truncation hides
      // an attack and produces a wrong answer from a half-read chart.
      return {
        ok: false,
        reason: 'message-too-long',
        detail: `A message may be at most ${String(this.config.maxInputCharacters)} characters. Nothing was sent.`,
      };
    }

    if (request.turnIndex >= this.config.maxTurnsPerConversation) {
      return {
        ok: false,
        reason: 'conversation-too-long',
        detail: `A conversation may run to ${String(this.config.maxTurnsPerConversation)} turns. Start a new one.`,
      };
    }

    if (this.inFlight.has(request.principalKey)) {
      return {
        ok: false,
        reason: 'turn-already-in-flight',
        detail: 'One turn at a time. The previous one is still running.',
      };
    }

    const ledger = this.ledgerFor(request.tenantId, now);
    if (ledger.dayCents >= this.config.dailyCostCents) {
      return {
        ok: false,
        reason: 'daily-budget-exhausted',
        detail: "This server's assistant budget for today is used up. Nothing else is affected.",
      };
    }
    if (ledger.monthCents >= this.config.monthlyCostCents) {
      return {
        ok: false,
        reason: 'monthly-budget-exhausted',
        detail:
          "This server's assistant budget for the month is used up. Nothing else is affected.",
      };
    }

    this.inFlight.add(request.principalKey);
    return {
      ok: true,
      warn: ledger.dayCents >= this.config.dailyCostCents * this.config.warnAtFraction,
    };
  }

  /** Always called, on every path, or a crashed turn locks a principal out forever. */
  release(principalKey: string): void {
    this.inFlight.delete(principalKey);
  }

  /** Records what a turn actually cost, in integer cents. */
  charge(tenantId: string, cents: number, now: number = Date.now()): void {
    const ledger = this.ledgerFor(tenantId, now);
    ledger.dayCents += cents;
    ledger.monthCents += cents;
  }

  spent(tenantId: string, now: number = Date.now()): { dayCents: number; monthCents: number } {
    const ledger = this.ledgerFor(tenantId, now);
    return { dayCents: ledger.dayCents, monthCents: ledger.monthCents };
  }

  private ledgerFor(tenantId: string, now: number): Ledger {
    const day = new Date(now).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const existing = this.ledgers.get(tenantId);

    if (existing === undefined) {
      const created: Ledger = { day, dayCents: 0, month, monthCents: 0 };
      this.ledgers.set(tenantId, created);
      return created;
    }

    if (existing.day !== day) {
      existing.day = day;
      existing.dayCents = 0;
    }
    if (existing.month !== month) {
      existing.month = month;
      existing.monthCents = 0;
    }
    return existing;
  }
}

/**
 * Cost of a turn, in integer cents, rounded up.
 *
 * Integer cents matches the money convention in the schema. Rounding up means
 * the budget is never overrun by accumulated fractions, which is the direction
 * an operator would choose.
 */
export function costInCents(
  usage: { inputTokens: number; outputTokens: number },
  rate: { inputCentsPerMillion: number; outputCentsPerMillion: number }
): number {
  const cents =
    (usage.inputTokens * rate.inputCentsPerMillion +
      usage.outputTokens * rate.outputCentsPerMillion) /
    1_000_000;
  return Math.ceil(cents);
}

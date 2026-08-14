import { describe, expect, it } from 'vitest';

import { BudgetGuard, costInCents } from './budget.js';
import { DEFAULT_BUDGET } from './config.js';

/**
 * Denial of wallet, and the refusals that stop it.
 *
 * The property that matters most is at the bottom: when the budget is gone the
 * assistant is unavailable and nothing else is. That is the operational proof
 * that the agent is optional.
 */

const TENANT = 'tenant-a';
const PRINCIPAL = 'tenant-a:user-1';

function guard(overrides: Partial<typeof DEFAULT_BUDGET> = {}): BudgetGuard {
  return new BudgetGuard({ ...DEFAULT_BUDGET, ...overrides });
}

function request(overrides: Partial<Parameters<BudgetGuard['admit']>[0]> = {}) {
  return {
    tenantId: TENANT,
    principalKey: PRINCIPAL,
    characters: 20,
    turnIndex: 0,
    now: Date.parse('2026-08-13T10:00:00.000Z'),
    ...overrides,
  };
}

describe('admission', () => {
  it('admits a normal turn', () => {
    expect(guard().admit(request())).toEqual({ ok: true, warn: false });
  });

  it('refuses an over-long message rather than truncating it', () => {
    const verdict = guard().admit(request({ characters: DEFAULT_BUDGET.maxInputCharacters + 1 }));
    expect(verdict).toMatchObject({ ok: false, reason: 'message-too-long' });
    expect(verdict.ok === false && verdict.detail).toMatch(/Nothing was sent/);
  });

  it('refuses a conversation past its turn cap', () => {
    expect(
      guard().admit(request({ turnIndex: DEFAULT_BUDGET.maxTurnsPerConversation }))
    ).toMatchObject({ ok: false, reason: 'conversation-too-long' });
  });

  it('queues rather than parallelising: one turn per person at a time', () => {
    const subject = guard();
    expect(subject.admit(request()).ok).toBe(true);
    expect(subject.admit(request())).toMatchObject({
      ok: false,
      reason: 'turn-already-in-flight',
    });

    subject.release(PRINCIPAL);
    expect(subject.admit(request()).ok).toBe(true);
  });

  it('locks one person without locking another', () => {
    const subject = guard();
    subject.admit(request());
    expect(subject.admit(request({ principalKey: 'tenant-a:user-2' })).ok).toBe(true);
  });
});

describe('the tenant ledger', () => {
  it('warns before it stops', () => {
    const subject = guard({ dailyCostCents: 100 });
    subject.charge(TENANT, 75, request().now);
    expect(subject.admit(request())).toEqual({ ok: true, warn: true });
  });

  it('stops the assistant, and only the assistant, when the day is spent', () => {
    const subject = guard({ dailyCostCents: 100 });
    subject.charge(TENANT, 100, request().now);

    const verdict = subject.admit(request());
    expect(verdict).toMatchObject({ ok: false, reason: 'daily-budget-exhausted' });
    expect(verdict.ok === false && verdict.detail).toMatch(/Nothing else is affected/);
  });

  it('stops on the month even when the day is fine', () => {
    const subject = guard({ dailyCostCents: 100_000, monthlyCostCents: 100 });
    subject.charge(TENANT, 100, request().now);
    expect(subject.admit(request())).toMatchObject({
      ok: false,
      reason: 'monthly-budget-exhausted',
    });
  });

  it('does not let one organisation spend another organisation budget', () => {
    const subject = guard({ dailyCostCents: 100 });
    subject.charge(TENANT, 100, request().now);
    expect(
      subject.admit(request({ tenantId: 'tenant-b', principalKey: 'tenant-b:user-1' })).ok
    ).toBe(true);
  });

  it('rolls the day over and keeps the month running', () => {
    const subject = guard();
    const monday = Date.parse('2026-08-13T10:00:00.000Z');
    const tuesday = Date.parse('2026-08-14T10:00:00.000Z');

    subject.charge(TENANT, 50, monday);
    expect(subject.spent(TENANT, monday)).toEqual({ dayCents: 50, monthCents: 50 });

    subject.charge(TENANT, 30, tuesday);
    expect(subject.spent(TENANT, tuesday)).toEqual({ dayCents: 30, monthCents: 80 });
  });

  it('rolls the month over as well', () => {
    const subject = guard();
    const august = Date.parse('2026-08-31T10:00:00.000Z');
    const september = Date.parse('2026-09-01T10:00:00.000Z');

    subject.charge(TENANT, 50, august);
    subject.charge(TENANT, 20, september);
    expect(subject.spent(TENANT, september)).toEqual({ dayCents: 20, monthCents: 20 });
  });
});

describe('costInCents', () => {
  it('rounds up, so accumulated fractions never overrun a budget', () => {
    expect(
      costInCents(
        { inputTokens: 8_000, outputTokens: 400 },
        { inputCentsPerMillion: 100, outputCentsPerMillion: 500 }
      )
    ).toBe(1);
  });

  it('is zero on an endpoint that costs nothing per token', () => {
    expect(
      costInCents(
        { inputTokens: 100_000, outputTokens: 10_000 },
        { inputCentsPerMillion: 0, outputCentsPerMillion: 0 }
      )
    ).toBe(0);
  });
});

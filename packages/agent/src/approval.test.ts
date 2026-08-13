import type { ToolProposal } from '@openrunic/agent-tools';
import { stubPrincipal } from '@openrunic/agent-tools/testing';
import { describe, expect, it } from 'vitest';

import { ApprovalRegistry, type ApprovalVerdict } from './approval.js';

/**
 * The swap, the replay, and the bypass.
 *
 * The failure this file defends against is not "a model called a write tool".
 * It is a proposal being shown, a human approving it, and a different input
 * executing. Every test below is one shape of that.
 */

const SECRET = 'a-test-signing-secret-of-sufficient-length';

const proposal: ToolProposal = {
  kind: 'appointment.book',
  effect: [{ label: 'Type', value: 'FOLLOWUP' }],
  affects: [{ type: 'Patient', id: '018f2b40-0000-7000-8000-000000000003' }],
  commit: {
    method: 'POST',
    path: '/bff/v0/appointments',
    body: { typeCode: 'FOLLOWUP', durationMinutes: 20 },
  },
  derivedFromUntrusted: false,
};

const principal = stubPrincipal({ scopes: ['appointment.write'] });

/** Names the control that fired, so a test reads the way the audit record does. */
function reasonOf(verdict: ApprovalVerdict): string {
  return verdict.ok ? 'accepted' : verdict.reason;
}

function registry(): ApprovalRegistry {
  return new ApprovalRegistry(SECRET);
}

function register(subject: ApprovalRegistry, input: unknown = { typeCode: 'FOLLOWUP' }) {
  return subject.register({
    agentRunId: 'run-1',
    principal,
    toolId: 'appointments.propose',
    input,
    proposal,
    requiredScopes: ['appointment.write'],
  });
}

describe('the signing secret', () => {
  it('has to be long enough to be a secret', () => {
    expect(() => new ApprovalRegistry('short')).toThrow(/at least 32 characters/);
  });
});

describe('a valid approval', () => {
  it('is accepted once', () => {
    const subject = registry();
    const { token } = register(subject);
    expect(
      reasonOf(subject.approve({ token, input: { typeCode: 'FOLLOWUP' }, approver: principal }))
    ).toBe('accepted');
  });
});

describe('an approval cannot be replayed', () => {
  it('is refused the second time, with the same token and the same input', () => {
    const subject = registry();
    const { token } = register(subject);
    const call = { token, input: { typeCode: 'FOLLOWUP' }, approver: principal };

    expect(reasonOf(subject.approve(call))).toBe('accepted');
    expect(reasonOf(subject.approve(call))).toBe('already-used');
  });
});

describe('an approval cannot be swapped', () => {
  it('is refused when the input is not the one that was approved', () => {
    const subject = registry();
    const { token } = register(subject, { appointmentId: 'appointment-123' });

    expect(
      reasonOf(
        subject.approve({ token, input: { appointmentId: 'appointment-456' }, approver: principal })
      )
    ).toBe('input-changed');
  });

  it('is refused when a field is added to an otherwise identical input', () => {
    const subject = registry();
    const { token } = register(subject, { typeCode: 'FOLLOWUP' });

    expect(
      reasonOf(
        subject.approve({
          token,
          input: { typeCode: 'FOLLOWUP', durationMinutes: 480 },
          approver: principal,
        })
      )
    ).toBe('input-changed');
  });

  it('is not defeated by reordering the keys, which would be a false refusal', () => {
    const subject = registry();
    const { token } = register(subject, { a: 1, b: 2 });
    expect(reasonOf(subject.approve({ token, input: { b: 2, a: 1 }, approver: principal }))).toBe(
      'accepted'
    );
  });
});

describe('an approval cannot be forged', () => {
  it('is refused on a tampered signature', () => {
    const subject = registry();
    const { token } = register(subject);

    expect(
      reasonOf(
        subject.approve({
          token: { ...token, signature: token.signature.replace(/.$/, '0') },
          input: { typeCode: 'FOLLOWUP' },
          approver: principal,
        })
      )
    ).toBe('signature-mismatch');
  });

  it('is refused on a signature of a different length', () => {
    const subject = registry();
    const { token } = register(subject);

    expect(
      reasonOf(
        subject.approve({
          token: { ...token, signature: 'short' },
          input: { typeCode: 'FOLLOWUP' },
          approver: principal,
        })
      )
    ).toBe('signature-mismatch');
  });

  it('is refused for a proposal that was never registered', () => {
    const subject = registry();

    expect(
      reasonOf(
        subject.approve({
          token: { proposalId: 'made-up', signature: 'anything' },
          input: {},
          approver: principal,
        })
      )
    ).toBe('unknown-proposal');
  });

  it('does not accept a token signed with another secret', () => {
    const first = registry();
    const second = new ApprovalRegistry('a-completely-different-secret-value-here');
    const { token } = register(first);
    const copied = register(second);

    expect(
      reasonOf(
        first.approve({
          token: { proposalId: token.proposalId, signature: copied.token.signature },
          input: { typeCode: 'FOLLOWUP' },
          approver: principal,
        })
      )
    ).toBe('signature-mismatch');
  });
});

describe('who may approve', () => {
  it('refuses an approver from another organisation', () => {
    const subject = registry();
    const { token } = register(subject);

    expect(
      reasonOf(
        subject.approve({
          token,
          input: { typeCode: 'FOLLOWUP' },
          approver: stubPrincipal({
            tenantId: '018f2b40-0000-7000-8000-0000000000ff',
            scopes: ['appointment.write'],
          }),
        })
      )
    ).toBe('wrong-tenant');
  });

  it('refuses an approver who does not independently hold the permission', () => {
    const subject = registry();
    const { token } = register(subject);

    expect(
      reasonOf(
        subject.approve({
          token,
          input: { typeCode: 'FOLLOWUP' },
          approver: stubPrincipal({ scopes: ['patient.read'] }),
        })
      )
    ).toBe('approver-lacks-permission');
  });
});

describe('an approval expires', () => {
  it('is refused past its window', () => {
    const subject = registry();
    const { token } = subject.register({
      agentRunId: 'run-1',
      principal,
      toolId: 'appointments.propose',
      input: { typeCode: 'FOLLOWUP' },
      proposal,
      requiredScopes: ['appointment.write'],
      now: 1_000,
      ttlMs: 500,
    });

    expect(
      reasonOf(
        subject.approve({
          token,
          input: { typeCode: 'FOLLOWUP' },
          approver: principal,
          now: 2_000,
        })
      )
    ).toBe('expired');
  });

  it('is swept out of the pending set once it has expired', () => {
    const subject = registry();
    const { proposal: pending } = subject.register({
      agentRunId: 'run-1',
      principal,
      toolId: 'appointments.propose',
      input: {},
      proposal,
      requiredScopes: [],
      now: 1_000,
      ttlMs: 100,
    });

    expect(subject.get(pending.proposalId)).toBeDefined();
    expect(subject.sweep(5_000)).toBe(1);
    expect(subject.get(pending.proposalId)).toBeUndefined();
    expect(subject.sweep(5_000)).toBe(0);
  });
});

describe('rejection', () => {
  it('removes the proposal and reports what was rejected', () => {
    const subject = registry();
    const { proposal: pending, token } = register(subject);

    expect(subject.reject(pending.proposalId)?.toolId).toBe('appointments.propose');
    expect(subject.reject(pending.proposalId)).toBeUndefined();
    expect(
      reasonOf(subject.approve({ token, input: { typeCode: 'FOLLOWUP' }, approver: principal }))
    ).toBe('unknown-proposal');
  });
});

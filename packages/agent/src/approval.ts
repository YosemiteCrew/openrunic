import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { AgentPrincipal, ToolProposal } from '@openrunic/agent-tools';

import { hashOf } from './hash.js';

/**
 * Approval, and why a signature rather than a flag.
 *
 * The failure this defends against is not "the model wrote a write tool call".
 * It is the swap: a proposal is shown, a human approves it, and the input that
 * executes is not the input that was shown. So the token is bound by HMAC to a
 * hash of the exact tool input **and** the exact proposal, it is single use, it
 * expires, and it is only accepted from a principal in the same organisation
 * who independently holds the permission the tool requires.
 *
 * Consequences worth stating plainly:
 *
 * - An approved `chart.read(123)` cannot be replayed as `chart.read(456)`: the
 *   input hash is inside the signature.
 * - A re-proposal gets a new token. There is no way to reuse an old one.
 * - Approval is a **fresh authenticated action**, so the verifier is told who
 *   the approver is and what they hold, and it refuses if the approver is not
 *   independently permitted. A model cannot approve its own proposal, because a
 *   model is never an approver.
 */

export const APPROVAL_TTL_MS = 15 * 60 * 1000;

export interface PendingProposal {
  proposalId: string;
  agentRunId: string;
  tenantId: string;
  /** The human the turn is running on behalf of. */
  requestedBy: string;
  toolId: string;
  /** Hash of the exact input the tool validated. */
  inputHash: string;
  /** Hash of the exact proposal the tool produced. */
  proposalHash: string;
  requiredScopes: readonly string[];
  proposal: ToolProposal;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalToken {
  proposalId: string;
  /** HMAC over the binding. Opaque to the client, meaningful only here. */
  signature: string;
}

export const APPROVAL_FAILURES = [
  'unknown-proposal',
  'signature-mismatch',
  'input-changed',
  'expired',
  'already-used',
  'wrong-tenant',
  'approver-lacks-permission',
] as const;

export type ApprovalFailure = (typeof APPROVAL_FAILURES)[number];

export type ApprovalVerdict =
  { ok: true; proposal: PendingProposal } | { ok: false; reason: ApprovalFailure };

export interface ApproveRequest {
  token: ApprovalToken;
  /** The input the caller is asking to execute. Compared, not trusted. */
  input: unknown;
  approver: AgentPrincipal;
  now?: number;
}

export interface RegisterRequest {
  agentRunId: string;
  principal: AgentPrincipal;
  toolId: string;
  input: unknown;
  proposal: ToolProposal;
  requiredScopes: readonly string[];
  now?: number;
  ttlMs?: number;
}

/**
 * Holds pending proposals for the life of a turn plus its approval window.
 *
 * In-memory on purpose in v1: conversation state is per turn and short, there
 * is no durable graph state, and a proposal that does not survive a restart is
 * a proposal a human has to see again - which is the safe direction. A
 * deployer wanting cross-process approval swaps the store, not the rules.
 */
export class ApprovalRegistry {
  private readonly secret: Buffer;
  private readonly pending = new Map<string, PendingProposal>();
  private readonly consumed = new Set<string>();

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error('ApprovalRegistry: the signing secret must be at least 32 characters.');
    }
    this.secret = Buffer.from(secret, 'utf8');
  }

  /** Records a proposal and mints the single-use token bound to it. */
  register(request: RegisterRequest): { proposal: PendingProposal; token: ApprovalToken } {
    const now = request.now ?? Date.now();
    const proposal: PendingProposal = {
      proposalId: randomUUID(),
      agentRunId: request.agentRunId,
      tenantId: request.principal.tenantId,
      requestedBy: request.principal.userId,
      toolId: request.toolId,
      inputHash: hashOf(request.input),
      proposalHash: hashOf(request.proposal),
      requiredScopes: [...request.requiredScopes],
      proposal: request.proposal,
      createdAt: now,
      expiresAt: now + (request.ttlMs ?? APPROVAL_TTL_MS),
    };

    this.pending.set(proposal.proposalId, proposal);
    return { proposal, token: { proposalId: proposal.proposalId, signature: this.sign(proposal) } };
  }

  /**
   * Verifies and consumes. Every failure is a distinct reason so the audit
   * record says which control fired, and every one of them refuses.
   */
  approve(request: ApproveRequest): ApprovalVerdict {
    const now = request.now ?? Date.now();

    // Checked before the lookup, because a consumed proposal has been removed
    // from the pending set: reporting it as unknown would still refuse, but the
    // audit record would name the wrong control.
    if (this.consumed.has(request.token.signature)) {
      return { ok: false, reason: 'already-used' };
    }

    const proposal = this.pending.get(request.token.proposalId);
    if (proposal === undefined) return { ok: false, reason: 'unknown-proposal' };

    if (!this.verifySignature(proposal, request.token.signature)) {
      return { ok: false, reason: 'signature-mismatch' };
    }
    if (now > proposal.expiresAt) return { ok: false, reason: 'expired' };
    if (hashOf(request.input) !== proposal.inputHash) {
      return { ok: false, reason: 'input-changed' };
    }
    if (request.approver.tenantId !== proposal.tenantId) {
      return { ok: false, reason: 'wrong-tenant' };
    }

    const held = new Set(request.approver.scopes);
    if (!proposal.requiredScopes.every((scope) => held.has(scope))) {
      return { ok: false, reason: 'approver-lacks-permission' };
    }

    // Consume before returning: a verdict that has been handed out has been
    // used, whatever the caller does next with it.
    this.consumed.add(request.token.signature);
    this.pending.delete(proposal.proposalId);
    return { ok: true, proposal };
  }

  /** Rejection is an outcome that is audited, not a silent drop. */
  reject(proposalId: string): PendingProposal | undefined {
    const proposal = this.pending.get(proposalId);
    if (proposal !== undefined) this.pending.delete(proposalId);
    return proposal;
  }

  get(proposalId: string): PendingProposal | undefined {
    return this.pending.get(proposalId);
  }

  /** Drops anything past its window. Called on each registration in long-lived processes. */
  sweep(now: number = Date.now()): number {
    let dropped = 0;
    for (const [id, proposal] of this.pending) {
      if (now > proposal.expiresAt) {
        this.pending.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }

  private sign(proposal: PendingProposal): string {
    return createHmac('sha256', this.secret)
      .update(
        [
          proposal.proposalId,
          proposal.tenantId,
          proposal.requestedBy,
          proposal.toolId,
          proposal.inputHash,
          proposal.proposalHash,
          String(proposal.expiresAt),
        ].join('\n')
      )
      .digest('hex');
  }

  private verifySignature(proposal: PendingProposal, candidate: string): boolean {
    const expected = Buffer.from(this.sign(proposal), 'utf8');
    const given = Buffer.from(candidate, 'utf8');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

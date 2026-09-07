import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import { createEmptyDataset, createMemoryRepositoryRegistry } from '../repositories/memory.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { RepositoryRegistry } from '../repositories/types.js';

import { createFakePort } from './fake-port.js';
import { DEMO_TENANT_A, FIXED_NOW, testId } from './support.js';

/**
 * The verification record, proved on BOTH storage implementations.
 *
 * `verifyChain` is written twice - once over the in-memory chain store and once
 * over Prisma - so the record it now leaves is written twice too. The whole
 * HTTP suite runs against the memory registry, which is the same asymmetry that
 * let three `where` clauses disagree with their `matches`: removing the record
 * from the Prisma arm alone leaves every route test green.
 *
 * Measured, not supposed: with the call deleted from the Prisma arm only,
 * `routes.platform`, `audit-chain` and `repositories.port-agreement` were 479
 * passed and this gap is what those 479 could not see.
 *
 * An empty chain is enough. The claim is that asking produces a record, and a
 * verification of nothing is still a verification somebody asked for - it is
 * also the cheapest fixture that cannot accidentally pass by reading a row.
 */
function auditedRegistry(registry: RepositoryRegistry, sink: MemoryAuditSink) {
  return registry.forRequest({
    tenantId: DEMO_TENANT_A,
    audit: new AuditCollector(sink, {
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      actorId: testId(901),
      requestId: 'req-verify',
      method: 'GET',
      path: '/bff/v0/audit/verify',
    }),
  });
}

const SUBJECTS: readonly [string, () => RepositoryRegistry][] = [
  [
    'memory',
    () =>
      createMemoryRepositoryRegistry({
        dataset: createEmptyDataset(),
        clock: { now: () => FIXED_NOW },
        nextId: () => testId(910),
      }),
  ],
  [
    'prisma',
    () => {
      const dataset = createEmptyDataset();
      let counter = 920;
      return createPrismaRepositoryRegistry((tenantId) =>
        createFakePort({
          dataset,
          tenantId,
          now: () => FIXED_NOW,
          nextId: () => testId((counter += 1)),
        })
      );
    },
  ],
];

describe.each(SUBJECTS)('verifyChain on the %s repositories', (_name, build) => {
  it('records the verification', async () => {
    const sink = createMemoryAuditSink();
    const repositories = auditedRegistry(build(), sink);

    const outcome = await repositories.audit.verifyChain();

    expect(outcome.verification.valid).toBe(true);
    expect(outcome.recorded).toBe(true);
    const verifications = sink.writes().filter((entry) => entry.event.action === 'audit.verified');
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.event.metadata).toMatchObject({ valid: true, checked: 0 });
  });

  /**
   * The verdict survives a recorder that cannot write.
   *
   * Before this, the walk completed, `recordVerification` threw, and the
   * computed `{ valid, brokenAtSeq }` was discarded - so the same access that
   * stops the audit sink writing also stopped the tamper report answering, and
   * on this endpoint the sink and the chain are ONE store. Fail closed on the
   * record and report it; do not fail closed on the answer.
   */
  it('keeps the verdict when the recorder is unavailable, and says so', async () => {
    const sink = createMemoryAuditSink();
    const rejecting = {
      ...sink,
      recordWrite: () => Promise.reject(new Error('audit sink unavailable')),
    } as MemoryAuditSink;
    const repositories = auditedRegistry(build(), rejecting);

    const outcome = await repositories.audit.verifyChain();

    expect(outcome.verification.valid).toBe(true);
    expect(outcome.recorded).toBe(false);
  });

  it('records nothing when the chain is never verified', () => {
    // The must-not-fire arm on this axis: the record belongs to the call, not
    // to building a scope, so a request that asks nothing leaves nothing.
    const sink = createMemoryAuditSink();
    auditedRegistry(build(), sink);

    expect(sink.writes().filter((entry) => entry.event.action === 'audit.verified')).toHaveLength(
      0
    );
  });
});

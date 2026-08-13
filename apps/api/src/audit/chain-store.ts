import {
  linkAuditEvent,
  uuidv7,
  verifyAuditChain,
  type AuditChainVerification,
  type AuditChainedEvent,
} from '@openrunic/database';

import type { AuditEvent } from './types.js';

/**
 * The per-tenant hash chain, in memory.
 *
 * The chaining rule itself lives in `@openrunic/database` and is shared with
 * Postgres, so this store and the production sink produce byte-identical
 * hashes for the same events. That is the point: the tamper-detection test runs
 * against a real chain built by the real linker, not against a fixture that
 * agrees with the verifier by construction.
 *
 * Append is the only mutation. There is no update and no delete, because an
 * audit log that can be edited through its own API is not an audit log; the
 * only way to change a past row here is to reach into the array, which is
 * exactly what the tampering test does and exactly what verification catches.
 */
export interface AuditChainStore {
  /** Links an event onto the tenant's chain and returns the stored row. */
  append(tenantId: string, event: AuditEvent, occurredAt: Date): StoredAuditEvent;
  /** The tenant's chain, oldest first. */
  chain(tenantId: string): readonly StoredAuditEvent[];
  /** Walks the tenant's chain and reports the first break. */
  verify(tenantId: string): AuditChainVerification;
  /** Every tenant that has a chain. */
  tenants(): string[];
}

/** A stored event: the chained fields, the two hashes and a row id. */
export interface StoredAuditEvent extends AuditChainedEvent {
  id: string;
}

export function createAuditChainStore(nextId: () => string = uuidv7): AuditChainStore {
  const chains = new Map<string, StoredAuditEvent[]>();

  const chainFor = (tenantId: string): StoredAuditEvent[] => {
    const existing = chains.get(tenantId);
    if (existing !== undefined) return existing;
    const created: StoredAuditEvent[] = [];
    chains.set(tenantId, created);
    return created;
  };

  return {
    append(tenantId: string, event: AuditEvent, occurredAt: Date): StoredAuditEvent {
      const rows = chainFor(tenantId);
      const tail = rows.at(-1);
      const chained = { ...event, tenantId, occurredAt };
      const { seq, prevHash, hash } = linkAuditEvent(
        chained,
        tail === undefined ? null : { seq: tail.seq, hash: tail.hash }
      );
      const stored: StoredAuditEvent = { ...chained, id: nextId(), seq, prevHash, hash };
      rows.push(stored);
      return stored;
    },

    chain(tenantId: string): readonly StoredAuditEvent[] {
      return chains.get(tenantId) ?? [];
    },

    verify(tenantId: string): AuditChainVerification {
      return verifyAuditChain(chains.get(tenantId) ?? []);
    },

    tenants(): string[] {
      return [...chains.keys()];
    },
  };
}

import {
  createAuditChainStore,
  type AuditChainStore,
  type StoredAuditEvent,
} from './chain-store.js';
import type { AuditEvent, AuditSink, AuditUnitOfWork } from './types.js';

/** A recorded event plus the tenant it belongs to and how it was written. */
export interface RecordedAuditEvent {
  tenantId: string;
  channel: 'read-batch' | 'write';
  /** True when the write joined a caller's transaction. */
  transactional: boolean;
  event: AuditEvent;
  /** The chained row this event became. */
  stored: StoredAuditEvent;
}

export interface MemoryAuditSink extends AuditSink {
  readonly events: readonly RecordedAuditEvent[];
  /** The chain these events were linked onto, shared with the audit query. */
  readonly store: AuditChainStore;
  reads(): readonly RecordedAuditEvent[];
  writes(): readonly RecordedAuditEvent[];
  clear(): void;
}

export interface MemoryAuditSinkOptions {
  store?: AuditChainStore;
  now?: () => Date;
}

/**
 * The audit sink the tests assert against, and the sink a database-less
 * development run uses.
 *
 * It keeps every event in memory in emission order *and* links each one onto
 * the tenant's hash chain through the same linker Postgres uses. Chaining in
 * the in-memory path is not decoration: it is what lets the whole chain
 * contract - contiguous sequence, prevHash linkage, tamper detection - be
 * proved by the suite rather than only in production.
 */
export function createMemoryAuditSink(options: MemoryAuditSinkOptions = {}): MemoryAuditSink {
  const events: RecordedAuditEvent[] = [];
  const store = options.store ?? createAuditChainStore();
  const now = options.now ?? ((): Date => new Date());

  const record = (
    tenantId: string,
    channel: RecordedAuditEvent['channel'],
    transactional: boolean,
    event: AuditEvent
  ): void => {
    events.push({
      tenantId,
      channel,
      transactional,
      event,
      stored: store.append(tenantId, event, now()),
    });
  };

  return {
    events,
    store,
    recordReadBatch(tenantId: string, event: AuditEvent): Promise<void> {
      record(tenantId, 'read-batch', false, event);
      return Promise.resolve();
    },
    recordWrite(tenantId: string, event: AuditEvent, unitOfWork?: AuditUnitOfWork): Promise<void> {
      record(tenantId, 'write', unitOfWork !== undefined, event);
      return Promise.resolve();
    },
    reads(): readonly RecordedAuditEvent[] {
      return events.filter((entry) => entry.channel === 'read-batch');
    },
    writes(): readonly RecordedAuditEvent[] {
      return events.filter((entry) => entry.channel === 'write');
    },
    /**
     * Forgets the emission log, never the chain. A chain with a hole in it is
     * a broken chain, and a test helper that could produce one would make the
     * verifier's findings meaningless.
     */
    clear(): void {
      events.length = 0;
    },
  };
}

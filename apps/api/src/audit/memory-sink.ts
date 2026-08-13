import type { AuditEvent, AuditSink, AuditUnitOfWork } from './types.js';

/** A recorded event plus the tenant it belongs to and how it was written. */
export interface RecordedAuditEvent {
  tenantId: string;
  channel: 'read-batch' | 'write';
  /** True when the write joined a caller's transaction. */
  transactional: boolean;
  event: AuditEvent;
}

export interface MemoryAuditSink extends AuditSink {
  readonly events: readonly RecordedAuditEvent[];
  reads(): readonly RecordedAuditEvent[];
  writes(): readonly RecordedAuditEvent[];
  clear(): void;
}

/**
 * The audit sink the tests assert against, and the sink a database-less
 * development run uses. It keeps every event in memory in emission order.
 */
export function createMemoryAuditSink(): MemoryAuditSink {
  const events: RecordedAuditEvent[] = [];

  return {
    events,
    recordReadBatch(tenantId: string, event: AuditEvent): Promise<void> {
      events.push({ tenantId, channel: 'read-batch', transactional: false, event });
      return Promise.resolve();
    },
    recordWrite(tenantId: string, event: AuditEvent, unitOfWork?: AuditUnitOfWork): Promise<void> {
      events.push({
        tenantId,
        channel: 'write',
        transactional: unitOfWork !== undefined,
        event,
      });
      return Promise.resolve();
    },
    reads(): readonly RecordedAuditEvent[] {
      return events.filter((entry) => entry.channel === 'read-batch');
    },
    writes(): readonly RecordedAuditEvent[] {
      return events.filter((entry) => entry.channel === 'write');
    },
    clear(): void {
      events.length = 0;
    },
  };
}

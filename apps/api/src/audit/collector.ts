import type {
  AuditEvent,
  AuditReadTarget,
  AuditRequestContext,
  AuditSink,
  AuditUnitOfWork,
  AuditWriteEntry,
} from './types.js';

/** Cap on targets carried in one batched read event. */
const MAX_BATCHED_TARGETS = 500;

/**
 * The request-scoped audit collector.
 *
 * One instance per request, created by the audit middleware and handed to the
 * repositories, which is what makes auditing structural: a repository method
 * cannot run without a collector, so a handler cannot read or write a chart
 * without leaving a trail.
 */
export class AuditCollector {
  readonly context: AuditRequestContext;

  private readonly sink: AuditSink;
  private readonly reads: AuditReadTarget[] = [];
  private truncated = 0;
  private flushed = false;

  constructor(sink: AuditSink, context: AuditRequestContext) {
    this.sink = sink;
    this.context = context;
  }

  /**
   * Registers a record the request read. Buffered; nothing is written until
   * {@link flush}, which the middleware calls after the response is on the wire.
   */
  read(target: AuditReadTarget): void {
    if (this.reads.length >= MAX_BATCHED_TARGETS) {
      // A chart-wide export can touch thousands of rows. Keeping the head and
      // counting the tail preserves a bounded, honest event rather than an
      // unbounded one or a silently lossy one.
      this.truncated += 1;
      return;
    }
    this.reads.push(target);
  }

  /**
   * Writes one mutation event through the sink, inside `unitOfWork`. Callers
   * are repositories: they own the transaction, so they own this call.
   */
  async write(entry: AuditWriteEntry, unitOfWork?: AuditUnitOfWork): Promise<void> {
    await this.sink.recordWrite(this.context.tenantId, this.stamp(entry), unitOfWork);
  }

  /**
   * Records an authorisation denial. Denials are audited as loudly as grants,
   * and outside any transaction: there is no mutation to be atomic with.
   */
  async denial(entry: AuditWriteEntry): Promise<void> {
    await this.write({ ...entry, outcome: 'failure' });
  }

  /**
   * Emits the batched read event. Idempotent, because the middleware flushes on
   * both the success and the error path and must not double-write.
   */
  async flush(): Promise<void> {
    if (this.flushed) return;
    this.flushed = true;
    if (this.reads.length === 0) return;

    const patientIds = [...new Set(this.reads.map((t) => t.patientId).filter(isDefined))];
    const event = this.stamp({
      action: 'phi.read',
      targetType: 'Request',
      targetId: this.context.requestId,
      ...(patientIds.length === 1 ? { patientId: patientIds[0] } : {}),
      metadata: {
        targets: this.reads.map((target) => ({
          type: target.targetType,
          id: target.targetId,
          ...(target.patientId === undefined ? {} : { patientId: target.patientId }),
        })),
        targetCount: this.reads.length + this.truncated,
        ...(this.truncated > 0 ? { truncated: this.truncated } : {}),
        ...(patientIds.length > 1 ? { patientIds } : {}),
      },
    });

    await this.sink.recordReadBatch(this.context.tenantId, event);
  }

  /** Number of read targets buffered so far, for tests and for metrics. */
  get pendingReadCount(): number {
    return this.reads.length;
  }

  private stamp(entry: AuditWriteEntry): AuditEvent {
    const { method, path, requestId } = this.context;
    return {
      actorType: this.context.actorType,
      actorId: this.context.actorId,
      ...(this.context.actorDisplay === undefined
        ? {}
        : { actorDisplay: this.context.actorDisplay }),
      action: entry.action,
      targetType: entry.targetType,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      ...(entry.patientId === undefined ? {} : { patientId: entry.patientId }),
      ...(entry.encounterId === undefined ? {} : { encounterId: entry.encounterId }),
      ...(entry.facilityId === undefined ? {} : { facilityId: entry.facilityId }),
      ...(this.context.purposeOfUse === undefined
        ? {}
        : { purposeOfUse: this.context.purposeOfUse }),
      ...(this.context.breakglass === undefined ? {} : { breakglass: this.context.breakglass }),
      outcome: entry.outcome ?? 'success',
      metadata: { requestId, method, path, ...entry.metadata },
    };
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

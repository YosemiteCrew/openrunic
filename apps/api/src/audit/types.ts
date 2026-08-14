/**
 * The audit contract.
 *
 * Two paths, deliberately asymmetric (plan section 3.3):
 *
 *   * **Reads** are buffered in a request-scoped collector and flushed *after*
 *     the response as a single batched event listing every target touched.
 *     Chart review would otherwise pay a database round trip per row read, and
 *     a slow-by-default audit log is how audit logging ends up turned off.
 *   * **Writes** are persisted in the *same transaction* as the mutation they
 *     describe. A mutation that commits without its audit row, or an audit row
 *     that commits without its mutation, is a hash chain that lies.
 *
 * Both paths run through the same {@link AuditSink}, so the in-memory sink used
 * by the tests and the Prisma sink used at runtime are interchangeable.
 */

/** One record touched by a read, for the batched per-request event. */
export interface AuditReadTarget {
  targetType: string;
  targetId: string;
  /** Chart the read belongs to; drives the patient access report. */
  patientId?: string;
}

/** A mutation, or a denial, worth its own row. */
export interface AuditWriteEntry {
  /** Verb from the audit vocabulary, e.g. `patient.created`. */
  action: string;
  targetType: string;
  targetId?: string;
  patientId?: string;
  facilityId?: string;
  encounterId?: string;
  outcome?: 'success' | 'failure';
  metadata?: Record<string, unknown>;
}

/** Request-scoped facts stamped onto every event the collector emits. */
export interface AuditRequestContext {
  tenantId: string;
  actorType: string;
  actorId: string;
  actorDisplay?: string;
  purposeOfUse?: string;
  breakglass?: boolean;
  requestId: string;
  method: string;
  path: string;
  sourceIp?: string;
  userAgent?: string;
}

/** A fully stamped event, ready for the sink. */
export interface AuditEvent {
  actorType: string;
  actorId: string;
  actorDisplay?: string;
  action: string;
  targetType: string;
  targetId?: string;
  patientId?: string;
  encounterId?: string;
  facilityId?: string;
  purposeOfUse?: string;
  breakglass?: boolean;
  outcome: 'success' | 'failure';
  metadata: Record<string, unknown>;
}

/**
 * An opaque handle to the caller's unit of work.
 *
 * The repository that is mutating passes its transaction through so the audit
 * row lands inside it. A sink that does not recognise the handle must reject it
 * rather than write outside the transaction, because a silent fallback is
 * exactly the failure mode the in-transaction rule exists to prevent.
 */
export type AuditUnitOfWork = object;

export interface AuditSink {
  /** One event summarising every read the request performed. */
  recordReadBatch(tenantId: string, event: AuditEvent): Promise<void>;
  /** One event per mutation, inside the mutation's own transaction. */
  recordWrite(tenantId: string, event: AuditEvent, unitOfWork?: AuditUnitOfWork): Promise<void>;
}

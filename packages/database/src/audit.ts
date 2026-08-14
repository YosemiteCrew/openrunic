import { createHash } from 'node:crypto';

import { z } from 'zod';

/**
 * Input validation for writing an AuditEvent row. Pure Zod - safe to import
 * without a database or a generated Prisma client. `id`, `tenantId`, `seq`,
 * `prevHash` and `hash` are absent on purpose: the tenant-scoped client
 * supplies the tenant, and {@link linkAuditEvent} supplies the chain fields.
 */
export const auditEventInput = z.strictObject({
  /** Kind of principal acting, e.g. `user`, `service`, `system`. */
  actorType: z.string().min(1).max(64),
  /** Stable identifier of the actor, e.g. a user id or service name. */
  actorId: z.string().min(1).max(128),
  /** Human-readable actor label, cached so the log survives a user rename. */
  actorDisplay: z.string().min(1).max(256).optional(),
  /** What happened, e.g. `patient.record.viewed`. */
  action: z.string().min(1).max(128),
  /** Kind of record acted on, e.g. `Patient`. */
  targetType: z.string().min(1).max(64),
  /** Identifier of the record acted on, when there is a single one. */
  targetId: z.string().min(1).max(128).optional(),
  /** Patient whose chart the action touched; drives the access-report query. */
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  facilityId: z.uuid().optional(),
  /** HL7 PurposeOfUse code, e.g. `TREAT`, `HPAYMT`, `HOPERAT`. */
  purposeOfUse: z.string().min(1).max(32).optional(),
  /** Emergency access outside normal policy. Requires a reason in metadata. */
  breakglass: z.boolean().optional(),
  /** Denials are audited as loudly as grants. */
  outcome: z.enum(['success', 'failure']).optional(),
  sourceIp: z.string().min(1).max(64).optional(),
  userAgent: z.string().min(1).max(512).optional(),
  /** Structured context for the event; must be a JSON object, not a bare scalar. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEventInput = z.infer<typeof auditEventInput>;

/** `prevHash` of the first event in a tenant's chain. */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

/**
 * The fields that participate in the hash. `createdAt` and `updatedAt` are
 * deliberately excluded, so a row rewritten by a backup restore - which
 * necessarily gets a new write timestamp - still verifies against the chain it
 * came from.
 */
export const AUDIT_CHAINED_FIELDS = [
  'action',
  'actorDisplay',
  'actorId',
  'actorType',
  'breakglass',
  'encounterId',
  'facilityId',
  'metadata',
  'occurredAt',
  'outcome',
  'patientId',
  'purposeOfUse',
  'seq',
  'sourceIp',
  'targetId',
  'targetType',
  'tenantId',
  'userAgent',
] as const;

export type AuditChainedField = (typeof AUDIT_CHAINED_FIELDS)[number];

/** The subset of an AuditEvent row that the chain covers. */
export interface AuditChainFields {
  tenantId: string;
  seq: bigint;
  occurredAt: Date;
  actorType: string;
  actorId: string;
  actorDisplay?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  facilityId?: string | null;
  purposeOfUse?: string | null;
  breakglass?: boolean;
  outcome?: string;
  sourceIp?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** A stored event: the chained fields plus the two hash columns. */
export interface AuditChainedEvent extends AuditChainFields {
  prevHash: string;
  hash: string;
}

/** The tail of a chain: what the next event needs in order to link to it. */
export interface AuditChainTail {
  seq: bigint;
  hash: string;
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown, path: string): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJson: ${path} is not a finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    // Object.create(null), not {}, and this is the load-bearing kind of detail.
    //
    // JSON.parse gives an object an OWN "__proto__" property, and Object.keys
    // reports it. Assigning that key to a normal object literal does not create
    // a property: it runs the __proto__ setter and changes the object's
    // prototype instead. The key then vanishes from the output, because
    // JSON.stringify serialises own properties only.
    //
    // For a hash chain that is not an inconvenience, it is a hole. An event
    // carrying {"a":1,"__proto__":{...}} canonicalised to exactly {"a":1} - the
    // same string, and therefore the same hash, as an event that never carried
    // the second field at all. The chain would be attesting content it had not
    // seen, and two distinct events would collide. A null-prototype object has
    // no __proto__ setter to trigger, so the key lands as an ordinary property
    // and is hashed like every other one.
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      // Absent and explicitly-undefined must hash identically, otherwise the
      // same event built two ways would produce two different hashes.
      if (child === undefined) continue;
      result[key] = canonicalize(child, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`canonicalJson: ${path} has unsupported type ${typeof value}`);
}

/**
 * Deterministic JSON: object keys sorted lexicographically at every depth, no
 * insignificant whitespace, `undefined` members dropped. Two structurally equal
 * values always encode to the same string, which is what makes the hash chain
 * reproducible across processes and across language runtimes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, '$'));
}

/** Projects an event onto its chained fields, as plain JSON. */
export function auditChainPayload(event: AuditChainFields): Record<string, JsonValue> {
  return {
    action: event.action,
    actorDisplay: event.actorDisplay ?? null,
    actorId: event.actorId,
    actorType: event.actorType,
    breakglass: event.breakglass ?? false,
    encounterId: event.encounterId ?? null,
    facilityId: event.facilityId ?? null,
    metadata: event.metadata ? canonicalize(event.metadata, '$.metadata') : null,
    occurredAt: event.occurredAt.toISOString(),
    outcome: event.outcome ?? 'success',
    patientId: event.patientId ?? null,
    purposeOfUse: event.purposeOfUse ?? null,
    // BigInt is not JSON, and a lossy Number conversion past 2^53 would be a
    // silent chain break, so the sequence is hashed as its decimal string.
    seq: event.seq.toString(),
    sourceIp: event.sourceIp ?? null,
    targetId: event.targetId ?? null,
    targetType: event.targetType,
    tenantId: event.tenantId,
    userAgent: event.userAgent ?? null,
  };
}

/**
 * `sha256Hex(prevHash + "\n" + canonicalJson(payload))`.
 *
 * The separator matters: without it the concatenation could be re-split at a
 * different offset, so two different (prevHash, payload) pairs could collide.
 */
export function computeAuditHash(prevHash: string, event: AuditChainFields): string {
  return createHash('sha256')
    .update(`${prevHash}\n${canonicalJson(auditChainPayload(event))}`)
    .digest('hex');
}

/**
 * Computes `seq`, `prevHash` and `hash` for the next event in a tenant's chain.
 * `tail` is the tenant's current last event, or null for the very first one.
 *
 * The caller must read the tail and insert the new row in the same transaction;
 * `@@unique([tenantId, seq])` is the backstop that turns a lost race into a
 * failed insert rather than a forked chain.
 */
export function linkAuditEvent(
  event: Omit<AuditChainFields, 'seq'>,
  tail: AuditChainTail | null
): { seq: bigint; prevHash: string; hash: string } {
  const seq = tail ? tail.seq + 1n : 1n;
  const prevHash = tail ? tail.hash : AUDIT_GENESIS_HASH;
  return { seq, prevHash, hash: computeAuditHash(prevHash, { ...event, seq }) };
}

export type AuditChainBreak =
  'tenant-mismatch' | 'seq-not-contiguous' | 'prev-hash-mismatch' | 'hash-mismatch';

export type AuditChainVerification =
  | { valid: true; checked: number; tail: AuditChainTail | null }
  | { valid: false; checked: number; brokenAtSeq: bigint; reason: AuditChainBreak };

/**
 * Verifies a contiguous slice of one tenant's chain, oldest event first.
 *
 * Run it nightly over the whole chain, and on demand over a window when
 * exporting for an investigation. Pass `tail` to verify a window that starts
 * partway through; omit it to verify from the genesis event. Any edit or
 * deletion of a past row breaks every hash after it, so the reported
 * `brokenAtSeq` is where tampering began.
 */
export function verifyAuditChain(
  events: readonly AuditChainedEvent[],
  tail: AuditChainTail | null = null
): AuditChainVerification {
  const first = events[0];
  let previous = tail;
  let checked = 0;

  for (const event of events) {
    const expectedSeq = previous ? previous.seq + 1n : 1n;
    const expectedPrevHash = previous ? previous.hash : AUDIT_GENESIS_HASH;

    if (first && event.tenantId !== first.tenantId) {
      return { valid: false, checked, brokenAtSeq: event.seq, reason: 'tenant-mismatch' };
    }
    if (event.seq !== expectedSeq) {
      return { valid: false, checked, brokenAtSeq: event.seq, reason: 'seq-not-contiguous' };
    }
    if (event.prevHash !== expectedPrevHash) {
      return { valid: false, checked, brokenAtSeq: event.seq, reason: 'prev-hash-mismatch' };
    }
    if (event.hash !== computeAuditHash(event.prevHash, event)) {
      return { valid: false, checked, brokenAtSeq: event.seq, reason: 'hash-mismatch' };
    }

    previous = { seq: event.seq, hash: event.hash };
    checked += 1;
  }

  return { valid: true, checked, tail: previous };
}

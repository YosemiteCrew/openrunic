import { describe, expect, it } from 'vitest';

// Imported from ./audit.js (not the package barrel) so this suite runs before
// `prisma generate` has ever been executed - the barrel pulls in @prisma/client.
import {
  AUDIT_GENESIS_HASH,
  auditChainPayload,
  auditEventInput,
  canonicalJson,
  computeAuditHash,
  linkAuditEvent,
  verifyAuditChain,
} from './audit.js';
import type { AuditChainFields, AuditChainedEvent, AuditEventInput } from './audit.js';

const validEvent: AuditEventInput = {
  actorType: 'user',
  actorId: 'user-42',
  action: 'patient.record.viewed',
  targetType: 'Patient',
};

describe('auditEventInput', () => {
  it('accepts a minimal valid event', () => {
    const parsed = auditEventInput.parse(validEvent);
    expect(parsed).toStrictEqual(validEvent);
  });

  it('accepts optional targetId and metadata', () => {
    const parsed = auditEventInput.parse({
      ...validEvent,
      targetId: '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c',
      metadata: { field: 'allergies', reason: 'chart-review' },
    });
    expect(parsed.targetId).toBe('9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c');
    expect(parsed.metadata).toStrictEqual({ field: 'allergies', reason: 'chart-review' });
  });

  it('accepts the chart-context and breakglass fields', () => {
    const parsed = auditEventInput.parse({
      ...validEvent,
      patientId: '01920000-0000-7000-8000-000000000001',
      encounterId: '01920000-0000-7000-8000-000000000002',
      facilityId: '01920000-0000-7000-8000-000000000003',
      purposeOfUse: 'TREAT',
      breakglass: true,
      outcome: 'failure',
    });
    expect(parsed.breakglass).toBe(true);
    expect(parsed.outcome).toBe('failure');
  });

  it.each(['patientId', 'encounterId', 'facilityId'] as const)('rejects a non-uuid %s', (field) => {
    expect(auditEventInput.safeParse({ ...validEvent, [field]: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an outcome outside the closed set', () => {
    expect(auditEventInput.safeParse({ ...validEvent, outcome: 'maybe' }).success).toBe(false);
  });

  it.each(['actorType', 'actorId', 'action', 'targetType'] as const)(
    'rejects a missing %s',
    (field) => {
      const withoutField = Object.fromEntries(
        Object.entries(validEvent).filter(([key]) => key !== field)
      );
      expect(auditEventInput.safeParse(withoutField).success).toBe(false);
    }
  );

  it.each(['actorType', 'actorId', 'action', 'targetType'] as const)(
    'rejects an empty %s',
    (field) => {
      const result = auditEventInput.safeParse({ ...validEvent, [field]: '' });
      expect(result.success).toBe(false);
    }
  );

  it.each([
    ['actorType', 65],
    ['actorId', 129],
    ['action', 129],
    ['targetType', 65],
    ['targetId', 129],
  ] as const)('rejects %s longer than %i - 1 characters', (field, tooLong) => {
    const result = auditEventInput.safeParse({ ...validEvent, [field]: 'x'.repeat(tooLong) });
    expect(result.success).toBe(false);
  });

  it('accepts fields at exactly their maximum length', () => {
    const result = auditEventInput.safeParse({
      actorType: 'x'.repeat(64),
      actorId: 'x'.repeat(128),
      action: 'x'.repeat(128),
      targetType: 'x'.repeat(64),
      targetId: 'x'.repeat(128),
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string field values', () => {
    expect(auditEventInput.safeParse({ ...validEvent, actorId: 42 }).success).toBe(false);
  });

  it('rejects non-object metadata', () => {
    expect(auditEventInput.safeParse({ ...validEvent, metadata: 'free text' }).success).toBe(false);
    expect(auditEventInput.safeParse({ ...validEvent, metadata: [1, 2] }).success).toBe(false);
  });

  it('rejects unknown keys (strict object)', () => {
    const result = auditEventInput.safeParse({ ...validEvent, seq: 1 });
    expect(result.success).toBe(false);
  });
});

describe('canonicalJson', () => {
  /**
   * The hash has to cover everything the event carried.
   *
   * `JSON.parse` gives an object an own "__proto__" property, and assigning that
   * key to a plain object literal runs the prototype setter instead of creating
   * a property - so the field used to disappear from the canonical form. Two
   * events that differed by exactly that field hashed identically, which is the
   * one thing a hash chain must never do.
   */
  it('carries a __proto__ key into the canonical form instead of losing it', () => {
    const hostile: unknown = JSON.parse('{"a":1,"__proto__":{"injected":true}}');

    expect(canonicalJson(hostile)).toBe('{"__proto__":{"injected":true},"a":1}');
  });

  it('does not collide with the event that lacks that field', () => {
    const hostile: unknown = JSON.parse('{"a":1,"__proto__":{"injected":true}}');
    const plain: unknown = JSON.parse('{"a":1}');

    expect(canonicalJson(hostile)).not.toBe(canonicalJson(plain));
  });

  it('leaves Object.prototype alone', () => {
    canonicalJson(JSON.parse('{"__proto__":{"polluted":true}}'));

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('produces the same string for objects built in different key orders', () => {
    expect(canonicalJson({ a: 1, b: [{ y: 1, x: 2 }] })).toBe(
      canonicalJson({ b: [{ x: 2, y: 1 }], a: 1 })
    );
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined members so absent and undefined hash alike', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s, which JSON cannot represent', (_label, value) => {
    expect(() => canonicalJson({ value })).toThrow(TypeError);
  });

  it('rejects a bigint rather than silently losing precision', () => {
    expect(() => canonicalJson({ seq: 1n })).toThrow(TypeError);
  });
});

const baseEvent: Omit<AuditChainFields, 'seq'> = {
  tenantId: '01920000-0000-7000-8000-0000000000aa',
  occurredAt: new Date('2026-08-13T09:00:00.000Z'),
  actorType: 'user',
  actorId: '01920000-0000-7000-8000-0000000000bb',
  action: 'patient.record.viewed',
  targetType: 'Patient',
  targetId: '01920000-0000-7000-8000-0000000000cc',
};

/** Builds a valid chain of `count` events for the same tenant. */
function buildChain(count: number): AuditChainedEvent[] {
  const events: AuditChainedEvent[] = [];
  let tail: { seq: bigint; hash: string } | null = null;
  for (let index = 0; index < count; index += 1) {
    const event = {
      ...baseEvent,
      occurredAt: new Date(baseEvent.occurredAt.getTime() + index * 1_000),
      action: `patient.record.viewed.${index}`,
    };
    const link = linkAuditEvent(event, tail);
    events.push({ ...event, ...link });
    tail = { seq: link.seq, hash: link.hash };
  }
  return events;
}

describe('computeAuditHash', () => {
  it('returns a 64-character lowercase hex digest', () => {
    const hash = computeAuditHash(AUDIT_GENESIS_HASH, { ...baseEvent, seq: 1n });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls', () => {
    const event = { ...baseEvent, seq: 1n };
    expect(computeAuditHash(AUDIT_GENESIS_HASH, event)).toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, event)
    );
  });

  it('does not depend on the order the event object was built in', () => {
    const forwards: AuditChainFields = { ...baseEvent, seq: 1n, breakglass: false };
    const backwards: AuditChainFields = {
      breakglass: false,
      seq: 1n,
      targetId: baseEvent.targetId,
      targetType: baseEvent.targetType,
      action: baseEvent.action,
      actorId: baseEvent.actorId,
      actorType: baseEvent.actorType,
      occurredAt: baseEvent.occurredAt,
      tenantId: baseEvent.tenantId,
    };
    expect(computeAuditHash(AUDIT_GENESIS_HASH, backwards)).toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, forwards)
    );
  });

  it('treats an omitted optional field as its documented default', () => {
    const withDefaults = computeAuditHash(AUDIT_GENESIS_HASH, {
      ...baseEvent,
      seq: 1n,
      breakglass: false,
      outcome: 'success',
      patientId: null,
    });
    expect(computeAuditHash(AUDIT_GENESIS_HASH, { ...baseEvent, seq: 1n })).toBe(withDefaults);
  });

  it.each([
    ['action', { action: 'patient.record.exported' }],
    ['actorId', { actorId: '01920000-0000-7000-8000-0000000000ff' }],
    ['seq', { seq: 2n }],
    ['occurredAt', { occurredAt: new Date('2026-08-13T09:00:00.001Z') }],
    ['breakglass', { breakglass: true }],
    ['outcome', { outcome: 'failure' }],
    ['metadata', { metadata: { reason: 'chart-review' } }],
  ] as const)('changes when %s changes', (_label, patch) => {
    const original = computeAuditHash(AUDIT_GENESIS_HASH, { ...baseEvent, seq: 1n });
    expect(computeAuditHash(AUDIT_GENESIS_HASH, { ...baseEvent, seq: 1n, ...patch })).not.toBe(
      original
    );
  });

  it('changes when the previous hash changes', () => {
    const event = { ...baseEvent, seq: 1n };
    expect(computeAuditHash('a'.repeat(64), event)).not.toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, event)
    );
  });
});

describe('auditChainPayload', () => {
  it('renders seq as a decimal string so bigint precision survives', () => {
    const payload = auditChainPayload({ ...baseEvent, seq: 9_007_199_254_740_993n });
    expect(payload.seq).toBe('9007199254740993');
  });

  it('renders occurredAt as an ISO instant', () => {
    expect(auditChainPayload({ ...baseEvent, seq: 1n }).occurredAt).toBe(
      '2026-08-13T09:00:00.000Z'
    );
  });
});

describe('linkAuditEvent', () => {
  it('starts a tenant chain at seq 1 with the genesis previous hash', () => {
    const link = linkAuditEvent(baseEvent, null);
    expect(link.seq).toBe(1n);
    expect(link.prevHash).toBe(AUDIT_GENESIS_HASH);
  });

  it('advances the sequence and links to the tail hash', () => {
    const first = linkAuditEvent(baseEvent, null);
    const second = linkAuditEvent(baseEvent, { seq: first.seq, hash: first.hash });
    expect(second.seq).toBe(2n);
    expect(second.prevHash).toBe(first.hash);
  });

  it('gives two identical events different hashes because seq differs', () => {
    const first = linkAuditEvent(baseEvent, null);
    const second = linkAuditEvent(baseEvent, { seq: first.seq, hash: first.hash });
    expect(second.hash).not.toBe(first.hash);
  });
});

describe('verifyAuditChain', () => {
  it('accepts an empty slice', () => {
    expect(verifyAuditChain([])).toStrictEqual({ valid: true, checked: 0, tail: null });
  });

  it('accepts a well-formed chain and reports its tail', () => {
    const chain = buildChain(5);
    const result = verifyAuditChain(chain);
    expect(result.valid).toBe(true);
    expect(result).toMatchObject({ checked: 5, tail: { seq: 5n, hash: chain[4]?.hash } });
  });

  it('accepts a window that continues from a supplied tail', () => {
    const chain = buildChain(5);
    const window = chain.slice(2);
    const tail = { seq: chain[1]?.seq ?? 0n, hash: chain[1]?.hash ?? '' };
    expect(verifyAuditChain(window, tail).valid).toBe(true);
  });

  it('rejects a window verified from the wrong starting point', () => {
    const chain = buildChain(5);
    expect(verifyAuditChain(chain.slice(2))).toMatchObject({
      valid: false,
      reason: 'seq-not-contiguous',
    });
  });

  it('detects a deleted event as a sequence gap', () => {
    const chain = buildChain(5);
    const withHole = [...chain.slice(0, 2), ...chain.slice(3)];
    expect(verifyAuditChain(withHole)).toMatchObject({
      valid: false,
      brokenAtSeq: 4n,
      reason: 'seq-not-contiguous',
    });
  });

  it('detects a tampered field as a hash mismatch at that event', () => {
    const chain = buildChain(4);
    const target = chain[1];
    if (!target) throw new Error('fixture is missing event 2');
    chain[1] = { ...target, action: 'patient.record.exported' };
    expect(verifyAuditChain(chain)).toMatchObject({
      valid: false,
      checked: 1,
      brokenAtSeq: 2n,
      reason: 'hash-mismatch',
    });
  });

  it('detects a relinked event as a previous-hash mismatch', () => {
    const chain = buildChain(3);
    const target = chain[2];
    if (!target) throw new Error('fixture is missing event 3');
    const prevHash = 'b'.repeat(64);
    chain[2] = { ...target, prevHash, hash: computeAuditHash(prevHash, target) };
    expect(verifyAuditChain(chain)).toMatchObject({
      valid: false,
      brokenAtSeq: 3n,
      reason: 'prev-hash-mismatch',
    });
  });

  it('detects an event spliced in from another tenant', () => {
    const chain = buildChain(3);
    const target = chain[1];
    if (!target) throw new Error('fixture is missing event 2');
    chain[1] = { ...target, tenantId: '01920000-0000-7000-8000-0000000000dd' };
    expect(verifyAuditChain(chain)).toMatchObject({
      valid: false,
      brokenAtSeq: 2n,
      reason: 'tenant-mismatch',
    });
  });

  it('reports the first break, not a later one', () => {
    const chain = buildChain(6);
    const second = chain[1];
    const fifth = chain[4];
    if (!second || !fifth) throw new Error('fixture is missing events');
    chain[1] = { ...second, outcome: 'failure' };
    chain[4] = { ...fifth, outcome: 'failure' };
    expect(verifyAuditChain(chain)).toMatchObject({ brokenAtSeq: 2n });
  });
});

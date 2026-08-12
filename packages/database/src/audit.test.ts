import { describe, expect, it } from 'vitest';

// Imported from ./audit.js (not the package barrel) so this suite runs before
// `prisma generate` has ever been executed — the barrel pulls in @prisma/client.
import { auditEventInput } from './audit.js';
import type { AuditEventInput } from './audit.js';

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
    const result = auditEventInput.safeParse({ ...validEvent, occurredAt: '2026-01-01' });
    expect(result.success).toBe(false);
  });
});

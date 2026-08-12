import { z } from 'zod';

/**
 * Input validation for writing an AuditEvent row. Pure Zod — safe to import
 * without a database or a generated Prisma client (`id` and `occurredAt` are
 * database-assigned and deliberately absent).
 */
export const auditEventInput = z.strictObject({
  /** Kind of principal acting, e.g. `user`, `service`, `system`. */
  actorType: z.string().min(1).max(64),
  /** Stable identifier of the actor, e.g. a user id or service name. */
  actorId: z.string().min(1).max(128),
  /** What happened, e.g. `patient.record.viewed`. */
  action: z.string().min(1).max(128),
  /** Kind of record acted on, e.g. `Patient`. */
  targetType: z.string().min(1).max(64),
  /** Identifier of the record acted on, when there is a single one. */
  targetId: z.string().min(1).max(128).optional(),
  /** Structured context for the event; must be a JSON object, not a bare scalar. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEventInput = z.infer<typeof auditEventInput>;

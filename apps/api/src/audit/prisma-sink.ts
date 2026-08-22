import { linkAuditEvent, uuidv7, type Prisma } from '@openrunic/database';

import type { AuditEventDelegate } from '../repositories/db-port.js';

import type { AuditEvent, AuditSink, AuditUnitOfWork } from './types.js';

/**
 * The runtime audit sink: appends to the per-tenant hash chain in Postgres.
 *
 * The chain rule is that `seq` and `prevHash` must be read and the new row
 * written without another writer slipping between them, so both halves happen
 * on the transaction handle the caller passed in. `@@unique([tenantId, seq])`
 * is the backstop: a lost race fails the insert instead of forking the chain.
 */

/** The slice of a transaction this sink needs. */
export interface AuditWriteScope {
  auditEvent: AuditEventDelegate;
}

/** Recognises a unit of work this sink can write through. */
export function isAuditWriteScope(value: AuditUnitOfWork | undefined): value is AuditWriteScope {
  if (value === undefined) return false;
  const candidate = value as { auditEvent?: { create?: unknown; findFirst?: unknown } };
  return (
    typeof candidate.auditEvent?.create === 'function' &&
    typeof candidate.auditEvent.findFirst === 'function'
  );
}

/**
 * Opens a unit of work for an event that has none of its own, bound to one
 * tenant.
 *
 * A function rather than a scope, and both halves of that matter.
 *
 * It takes the TENANT because `AuditEvent` carries a row-level security policy
 * like every other table, so a write issued outside a declared session is
 * refused - and a refused audit write is the quietest possible failure, since
 * the collector logs a flush error and the response has already gone out.
 *
 * It RUNS the work rather than handing back a delegate because the chain rule
 * needs both halves in one transaction: read the tail, write the row linked to
 * it, with nothing slipping between. The old shape was a bare client, so those
 * two statements were two autocommits, and the `@@unique([tenantId, seq])`
 * backstop was doing more work than it should have had to.
 */
export type StandaloneAuditWork = <R>(
  tenantId: string,
  run: (scope: AuditWriteScope) => Promise<R>
) => Promise<R>;

export interface PrismaAuditSinkOptions {
  /** Used when no unit of work is supplied, e.g. for a denial or a read batch. */
  standalone: StandaloneAuditWork;
  now?: () => Date;
}

export function createPrismaAuditSink(options: PrismaAuditSinkOptions): AuditSink {
  const now = options.now ?? ((): Date => new Date());

  const append = async (
    tenantId: string,
    event: AuditEvent,
    scope: AuditWriteScope
  ): Promise<void> => {
    const tail = await scope.auditEvent.findFirst({
      // The tenant, stated. It used to be left to whatever narrowing the scope
      // happened to carry - RLS inside a tenant session, the tenant extension
      // inside a mutation's transaction - and a chain is not a thing to hold
      // together by inference. A deployment whose database role bypasses RLS,
      // which is what the official Postgres image's POSTGRES_USER is, would
      // otherwise link one tenant's event to another tenant's tail, and every
      // per-tenant verification downstream then fails on rows nobody touched.
      //
      // Belt to the braces rather than a replacement for them: the session and
      // the extension both still apply where they apply. This is the half that
      // is true regardless of who the connection is.
      where: { tenantId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    const occurredAt = now();
    const chained = { ...event, tenantId, occurredAt };
    const { seq, prevHash, hash } = linkAuditEvent(chained, tail);
    await scope.auditEvent.create({
      data: {
        ...chained,
        // `metadata` is a JSONB column. The collector guarantees a plain object
        // of JSON-safe values, which is exactly Prisma's `InputJsonObject`; the
        // structural type just cannot see that through `Record<string, unknown>`.
        metadata: chained.metadata as Prisma.InputJsonObject,
        id: uuidv7(),
        seq,
        prevHash,
        hash,
      },
    });
  };

  return {
    recordReadBatch(tenantId: string, event: AuditEvent): Promise<void> {
      // Reads are flushed after the response, so there is no caller transaction
      // to join; this is the one path that legitimately stands alone.
      return options.standalone(tenantId, (scope) => append(tenantId, event, scope));
    },

    // `async` rather than promise-returning so the refusal below arrives as a
    // rejection like every other failure, instead of as a synchronous throw
    // that a `.catch()` on the call site would miss.
    async recordWrite(
      tenantId: string,
      event: AuditEvent,
      unitOfWork?: AuditUnitOfWork
    ): Promise<void> {
      if (unitOfWork === undefined) {
        // A denial: nothing was mutated, so there is no caller transaction to
        // join - but the chain still needs one of its own, and the row still
        // needs a declared tenant to satisfy the policy.
        await options.standalone(tenantId, (scope) => append(tenantId, event, scope));
        return;
      }
      if (!isAuditWriteScope(unitOfWork)) {
        // Falling back to the standalone scope here would write the audit row
        // outside the mutation's transaction, which is the exact failure this
        // sink exists to prevent. Refuse instead.
        throw new TypeError(
          'createPrismaAuditSink: unrecognised unit of work. A mutation audit event must be written through the transaction that performed the mutation.'
        );
      }
      await append(tenantId, event, unitOfWork);
    },
  };
}

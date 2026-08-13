import type { Prisma, TenantClient } from '@openrunic/database';

/**
 * The narrow slice of the Prisma client the API actually uses.
 *
 * Written as an interface rather than taken as `TenantClient` directly for two
 * reasons. It documents the exact surface the API depends on, so a Prisma
 * upgrade that changes something outside this slice cannot break the API
 * silently. And it makes the Prisma adapter testable: the suite drives it with
 * a hand-written fake port, which is why `prisma.ts` needs no database and is
 * covered like any other module.
 *
 * The safety of that arrangement rests on {@link tenantClientSatisfiesPort}
 * below: it is a compile-time assertion that the real tenant-scoped client
 * still satisfies this port. If Prisma changes an argument or return type, the
 * fake keeps passing but `type-check` fails, which is the correct place to find
 * out.
 */

export type PatientRecord = Prisma.PatientGetPayload<Record<string, never>>;
export type AppointmentRecord = Prisma.AppointmentGetPayload<Record<string, never>>;

/**
 * Reads are `findFirst`, never `findUnique`, and writes are `updateMany`,
 * never `update`. Both choices are forced by the tenant extension in
 * `packages/database`: it narrows a query by rewriting `where` into
 * `AND: [original, { tenantId }]`, which is a legal filter but not a legal
 * *unique* filter, so the by-unique-key operations would be the one shape the
 * isolation layer cannot scope. Filter-shaped operations keep every query on
 * the scoped path.
 */
export interface PatientDelegate {
  findMany(args: Prisma.PatientFindManyArgs): Promise<PatientRecord[]>;
  count(args: Prisma.PatientCountArgs): Promise<number>;
  findFirst(args: Prisma.PatientFindFirstArgs): Promise<PatientRecord | null>;
  create(args: Prisma.PatientCreateArgs): Promise<PatientRecord>;
  updateMany(args: Prisma.PatientUpdateManyArgs): Promise<{ count: number }>;
}

export interface AppointmentDelegate {
  findMany(args: Prisma.AppointmentFindManyArgs): Promise<AppointmentRecord[]>;
  count(args: Prisma.AppointmentCountArgs): Promise<number>;
  findFirst(args: Prisma.AppointmentFindFirstArgs): Promise<AppointmentRecord | null>;
  create(args: Prisma.AppointmentCreateArgs): Promise<AppointmentRecord>;
  updateMany(args: Prisma.AppointmentUpdateManyArgs): Promise<{ count: number }>;
}

export interface AuditEventDelegate {
  create(args: Prisma.AuditEventCreateArgs): Promise<{ id: string }>;
  /** Reads the tenant's chain tail so the next event can link to it. */
  findFirst(args: Prisma.AuditEventFindFirstArgs): Promise<{ seq: bigint; hash: string } | null>;
}

/** What a repository sees inside a transaction: the full surface, reads and writes. */
export interface DbTransaction {
  patient: PatientDelegate;
  appointment: AppointmentDelegate;
  auditEvent: AuditEventDelegate;
}

/** The read half of a delegate, which is all of it the port exposes directly. */
export type ReadsOnly<D> = Omit<D, 'create' | 'updateMany'>;

/**
 * What a repository sees outside a transaction: reads, and a way to open one.
 *
 * The port deliberately does not extend {@link DbTransaction}. Every write in
 * this API is paired with an audit event that has to land or fail with it, so
 * `prisma.ts` already issues all of them inside `$transaction`; none of them
 * goes through a delegate on this object. Leaving `create` and `updateMany`
 * exposed here would advertise an unaudited write path that nothing uses and
 * nothing should, so the type withholds it and a stray `port.patient.create`
 * fails `type-check` instead of quietly skipping the audit log.
 */
export interface DbPort {
  patient: ReadsOnly<PatientDelegate>;
  appointment: ReadsOnly<AppointmentDelegate>;
  $transaction<R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R>;
}

/**
 * Compile-time proof that the tenant-scoped Prisma client satisfies both the
 * transaction surface and the port. Both are asserted, because neither implies
 * the other: {@link DbTransaction} says nothing about `$transaction`, and
 * {@link DbPort} withholds the write methods. Type-only: they erase, and they
 * exist so a drift between either shape and the generated client fails
 * `type-check` rather than production.
 */
export type TenantClientSatisfiesTransaction = TenantClient extends DbTransaction ? true : never;
export type TenantClientSatisfiesPort = TenantClient extends DbPort ? true : never;

/** Reified so the assertions cannot be tree-shaken out of the type graph. */
export const tenantClientSatisfiesTransaction: TenantClientSatisfiesTransaction = true;
export const tenantClientSatisfiesPort: TenantClientSatisfiesPort = true;

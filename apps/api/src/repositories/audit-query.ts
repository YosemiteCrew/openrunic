import {
  verifyAuditChain,
  type AuditChainVerification,
  type AuditChainedEvent,
} from '@openrunic/database';

import type { AuditChainStore, StoredAuditEvent } from '../audit/chain-store.js';

import { comparable, inWindow, paginate, type BaseQuery, type Page } from './collection.js';
import type { DbPort } from './db-port.js';
import type { RequestScope } from './registry.js';
import { toPlainRow, type Row } from './rows.js';

/**
 * Reading the audit log.
 *
 * The audit log is the one aggregate the API can read but never write through:
 * events arrive from the collector, in the same transaction as the change they
 * describe, and an endpoint that could insert one would let an actor forge
 * their own alibi. So this repository has a list and a verification, and no
 * create or update at all.
 *
 * Verification walks a tenant's chain from its genesis event and reports the
 * first break. Any edit or deletion of a past row invalidates every hash after
 * it, so the reported sequence number is where tampering began, not merely
 * where it was noticed.
 */

export type AuditEventRow = Row<'AuditEvent'>;

export interface AuditQuery extends BaseQuery {
  patientId?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'failure';
  breakglass?: boolean;
  /** Inclusive lower bound on `occurredAt`. */
  from?: Date;
  /** Exclusive upper bound on `occurredAt`. */
  to?: Date;
  sort: 'occurredAt' | 'seq';
}

export interface AuditQueryRepository {
  list(query: AuditQuery): Promise<Page<AuditEventRow>>;
  findById(id: string): Promise<AuditEventRow | null>;
  /** Walks this tenant's chain and reports the first break, if any. */
  verifyChain(): Promise<AuditChainVerification>;
}

/**
 * Upper bound on a single verification pass.
 *
 * A chain is unbounded and a verification that tried to load all of it would
 * be an availability problem of its own making. Ten thousand events is a long
 * way past what an on-demand check needs, and the nightly job walks the whole
 * chain in windows using the tail from the previous window.
 */
export const MAX_VERIFIED_EVENTS = 10_000;

function matches(row: AuditEventRow, query: AuditQuery): boolean {
  if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
  if (query.actorId !== undefined && row.actorId !== query.actorId) return false;
  if (query.action !== undefined && row.action !== query.action) return false;
  if (query.targetType !== undefined && row.targetType !== query.targetType) return false;
  if (query.targetId !== undefined && row.targetId !== query.targetId) return false;
  if (query.outcome !== undefined && row.outcome !== query.outcome) return false;
  if (query.breakglass !== undefined && row.breakglass !== query.breakglass) return false;
  return inWindow(row.occurredAt, query.from, query.to);
}

/**
 * A compartment-restricted principal sees only events about its own chart.
 *
 * Events with no patient at all - a login, a role change, a chain
 * verification - are organisation-level facts and are withheld rather than
 * shown, because "everything that happened here that was not about you" is a
 * surprisingly good picture of a practice's day.
 */
function inCompartment(row: AuditEventRow, compartmentPatientId: string | undefined): boolean {
  return compartmentPatientId === undefined || row.patientId === compartmentPatientId;
}

function normalise(event: StoredAuditEvent): AuditEventRow {
  return {
    id: event.id,
    tenantId: event.tenantId,
    seq: event.seq,
    occurredAt: event.occurredAt,
    actorType: event.actorType,
    actorId: event.actorId,
    actorDisplay: event.actorDisplay ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    patientId: event.patientId ?? null,
    encounterId: event.encounterId ?? null,
    facilityId: event.facilityId ?? null,
    purposeOfUse: event.purposeOfUse ?? null,
    breakglass: event.breakglass ?? false,
    outcome: event.outcome ?? 'success',
    sourceIp: event.sourceIp ?? null,
    userAgent: event.userAgent ?? null,
    metadata: (event.metadata ?? null) as AuditEventRow['metadata'],
    prevHash: event.prevHash,
    hash: event.hash,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
}

function sortRows(rows: AuditEventRow[], query: AuditQuery): void {
  const direction = query.order === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const left = query.sort === 'seq' ? Number(a.seq) : comparable(a.occurredAt);
    const right = query.sort === 'seq' ? Number(b.seq) : comparable(b.occurredAt);
    const primary = Number(left) - Number(right);
    return (primary === 0 ? a.id.localeCompare(b.id) : primary) * direction;
  });
}

export function createMemoryAuditQuery(
  store: AuditChainStore,
  scope: RequestScope
): AuditQueryRepository {
  const mine = (): AuditEventRow[] =>
    store
      .chain(scope.tenantId)
      .map(normalise)
      .filter((row) => inCompartment(row, scope.compartmentPatientId));

  return {
    list(query: AuditQuery): Promise<Page<AuditEventRow>> {
      const matched = mine().filter((row) => matches(row, query));
      sortRows(matched, query);
      const page = paginate(matched, query.page, query.pageSize);
      recordReads(scope, page.rows);
      return Promise.resolve(page);
    },

    findById(id: string): Promise<AuditEventRow | null> {
      const row = mine().find((candidate) => candidate.id === id) ?? null;
      if (row !== null) recordReads(scope, [row]);
      return Promise.resolve(row);
    },

    verifyChain(): Promise<AuditChainVerification> {
      return Promise.resolve(store.verify(scope.tenantId));
    },
  };
}

export function createPrismaAuditQuery(port: DbPort, scope: RequestScope): AuditQueryRepository {
  const delegate = port.model('AuditEvent');

  const where = (query: AuditQuery): Record<string, unknown> => ({
    ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
    ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.targetType === undefined ? {} : { targetType: query.targetType }),
    ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
    ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
    ...(query.breakglass === undefined ? {} : { breakglass: query.breakglass }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          occurredAt: {
            ...(query.from === undefined ? {} : { gte: query.from }),
            ...(query.to === undefined ? {} : { lt: query.to }),
          },
        }),
    ...(scope.compartmentPatientId === undefined ? {} : { patientId: scope.compartmentPatientId }),
  });

  return {
    async list(query: AuditQuery): Promise<Page<AuditEventRow>> {
      const filter = where(query);
      const [records, total] = await Promise.all([
        delegate.findMany({
          where: filter,
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        delegate.count({ where: filter }),
      ]);
      const rows = records.map((record) => toPlainRow<'AuditEvent'>(record));
      recordReads(scope, rows);
      return { rows, total, page: query.page, pageSize: query.pageSize };
    },

    async findById(id: string): Promise<AuditEventRow | null> {
      const record = await delegate.findFirst({
        where: {
          id,
          ...(scope.compartmentPatientId === undefined
            ? {}
            : { patientId: scope.compartmentPatientId }),
        },
      });
      if (record === null) return null;
      const row = toPlainRow<'AuditEvent'>(record);
      recordReads(scope, [row]);
      return row;
    },

    async verifyChain(): Promise<AuditChainVerification> {
      const records = await delegate.findMany({
        orderBy: [{ seq: 'asc' }],
        take: MAX_VERIFIED_EVENTS,
      });
      // The row type says `metadata` is any JSON value; the chain payload says
      // it is an object or null. The collector only ever writes objects, and
      // the hash covers whatever is there either way, so the narrowing is safe
      // and the alternative would be to re-validate every stored event before
      // checking whether it had been tampered with.
      return verifyAuditChain(
        records.map((record) => toPlainRow<'AuditEvent'>(record)) as AuditChainedEvent[]
      );
    },
  };
}

/**
 * Reading the audit log is itself an access to patient data, so it is audited
 * like any other read. It cannot recurse: the batched read event is flushed
 * after the response, long after this query returned.
 */
function recordReads(scope: RequestScope, rows: readonly AuditEventRow[]): void {
  for (const row of rows) {
    scope.audit.read({
      targetType: 'AuditEvent',
      targetId: row.id,
      ...(row.patientId === null ? {} : { patientId: row.patientId }),
    });
  }
}

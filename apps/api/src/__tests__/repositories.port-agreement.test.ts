import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COLLECTION_SPECS } from '../repositories/specs/index.js';

import { matchesWhere } from './fake-port.js';

/**
 * The contract `CollectionSpec` has always stated, finally asserted.
 *
 * `matches` and `where` answer the same question through different machinery:
 * one filters rows in memory, the other builds a Prisma `where` for Postgres to
 * filter with. The interface says on both members that they must agree, and
 * until now nothing checked that they did.
 *
 * That mattered more than it sounds, because of which port the tests use. The
 * whole HTTP suite runs against the memory registry, where `matches` decides.
 * A spec whose `where` disagrees therefore has a green suite and a wrong
 * database. Three had, and each was found by hand rather than by a test:
 * `Claim.status`, `RoleAssignment.userId` and `Referral.status`, the last of
 * which shipped and returned the entire outstanding-referral tray to a caller
 * who had asked for one status inside it.
 *
 * The oracle is `matchesWhere`, the same interpreter the fake port answers
 * queries with, so the two sides here are the two sides in production.
 *
 * ## Everything this file exercises is derived from something the code under
 * ## test cannot delete
 *
 * The rule that shapes the rest of the file, and the one that was broken twice
 * before it was written down: **a mutation can remove its own detection.**
 *
 * A dropped `where` clause takes its own column out of `constrained(where)`, so
 * a mutation pass driven by the emitted filter cannot mutate the column whose
 * clause has gone - the change deletes the check that would have caught it. The
 * same holds for a filter that is redundant under a query sending every
 * parameter at once: it can be removed without changing a single row, because a
 * neighbouring parameter already implies it.
 *
 * So the sets this file iterates come from outside the thing being tested. The
 * spec list comes from `COLLECTION_SPECS` and is size-floored. The query
 * parameters come from `FILTERS`, which `Required` makes the compiler enforce.
 * The mutated columns and their types come from `schema.prisma`, and that table
 * has a guard of its own, because a parse that silently found nothing would
 * disarm every mutant depending on it while leaving the suite green.
 *
 * A new assertion here should be asked the same question: if the code it checks
 * were deleted, would this still run?
 */

/**
 * The query type a spec filters with, read off its own `where` signature.
 *
 * Taken from the method rather than from `CollectionSpec`'s type parameters
 * because `where` is the member this file actually calls, so the table cannot
 * drift from what is being tested.
 */
type QueryOf<S> = S extends { where: (query: infer TQuery) => unknown } ? TQuery : never;

/**
 * One query per spec, with every parameter it declares set.
 *
 * `Required` is what makes this a gate rather than a sample: adding a filter
 * parameter to any query type, or adding a spec, fails to compile here before
 * it can reach `dev` untested. The values are arbitrary but have to be of the
 * right type, and where a spec has both a scalar and a set over one column they
 * are deliberately compatible, so the intersection is non-empty and the pair is
 * actually exercised rather than short-circuiting to "matches nothing".
 */
const FILTERS: {
  [K in keyof typeof COLLECTION_SPECS]: Required<QueryOf<(typeof COLLECTION_SPECS)[K]>>;
} = {
  allergies: {
    page: 1,
    pageSize: 25,
    sort: 'recordedAt',
    order: 'asc',
    patientId: 'id-patientId',
    clinicalStatus: 'ACTIVE',
    criticality: 'HIGH',
  },
  appointments: {
    page: 1,
    pageSize: 25,
    sort: 'start',
    order: 'asc',
    id: 'id-id',
    facilityId: 'id-facilityId',
    providerId: 'id-providerId',
    patientId: 'id-patientId',
    status: 'BOOKED',
    excludeStatuses: ['CANCELLED'],
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  charges: {
    page: 1,
    pageSize: 25,
    sort: 'serviceDate',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    facilityId: 'id-facilityId',
    status: 'OPEN',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  claimLines: {
    page: 1,
    pageSize: 25,
    sort: 'sequence',
    order: 'asc',
    claimId: 'id-claimId',
    claimIds: ['id-claimId'],
    chargeItemId: 'id-chargeItemId',
  },
  claimStatusHistory: {
    page: 1,
    pageSize: 25,
    sort: 'occurredAt',
    order: 'asc',
    claimId: 'id-claimId',
    status: 'DRAFT',
  },
  claims: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'asc',
    patientId: 'id-patientId',
    payerId: 'id-payerId',
    encounterId: 'id-encounterId',
    status: 'DRAFT',
    statuses: ['DRAFT'],
    window: 'createdAt',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  relatedPersons: {
    page: 1,
    pageSize: 25,
    sort: 'familyName',
    order: 'asc',
    patientId: 'id-patientId',
    active: true,
    isGuardian: true,
    isEmergencyContact: true,
  },
  coverages: {
    page: 1,
    pageSize: 25,
    sort: 'rank',
    order: 'asc',
    patientId: 'id-patientId',
    payerId: 'id-payerId',
    rank: 'PRIMARY',
    status: 'ACTIVE',
  },
  documents: {
    page: 1,
    pageSize: 25,
    sort: 'receivedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    status: 'FILED',
    category: 'needle',
    source: 'UPLOAD',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  encounters: {
    page: 1,
    pageSize: 25,
    sort: 'startedAt',
    order: 'asc',
    patientId: 'id-patientId',
    facilityId: 'id-facilityId',
    providerId: 'id-providerId',
    status: 'IN_PROGRESS',
    excludeStatuses: ['ENTERED_IN_ERROR'],
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  facilities: { page: 1, pageSize: 25, sort: 'name', order: 'asc', active: true, q: 'needle' },
  formDefinitions: {
    page: 1,
    pageSize: 25,
    sort: 'key',
    order: 'asc',
    key: 'id-key',
    status: 'PUBLISHED',
    bindTo: 'PATIENT',
  },
  formSubmissions: {
    page: 1,
    pageSize: 25,
    sort: 'effectiveAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    formDefinitionId: 'id-formDefinitionId',
    status: 'COMPLETED',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  imagingStudies: {
    page: 1,
    pageSize: 25,
    sort: 'startedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    serviceRequestId: 'id-serviceRequestId',
    accessionNumber: 'id-accessionNumber',
    studyInstanceUid: 'id-studyInstanceUid',
    status: 'AVAILABLE',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  immunisations: {
    page: 1,
    pageSize: 25,
    sort: 'administeredAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    cvxCode: 'id-cvxCode',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  medicationStatements: {
    page: 1,
    pageSize: 25,
    sort: 'reportedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    status: 'ACTIVE',
  },
  messageThreads: {
    page: 1,
    pageSize: 25,
    sort: 'lastMessageAt',
    order: 'asc',
    kind: 'PATIENT',
    patientId: 'id-patientId',
    open: true,
  },
  messages: {
    page: 1,
    pageSize: 25,
    sort: 'sentAt',
    order: 'asc',
    threadId: 'id-threadId',
    senderUserId: 'id-senderUserId',
    read: true,
  },
  noteAddenda: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'asc',
    noteId: 'id-noteId',
    authorId: 'id-authorId',
  },
  notes: {
    page: 1,
    pageSize: 25,
    sort: 'signedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    authorId: 'id-authorId',
    state: 'SIGNED',
  },
  observations: {
    page: 1,
    pageSize: 25,
    sort: 'effectiveAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    status: 'FINAL',
    category: 'VITAL_SIGNS',
    code: 'id-code',
    loincCode: 'id-loincCode',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  orders: {
    page: 1,
    pageSize: 25,
    sort: 'requestedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    status: 'SIGNED',
    category: 'LAB',
    priority: 'ROUTINE',
    orderedById: 'id-orderedById',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  patients: {
    page: 1,
    pageSize: 25,
    sort: 'familyName',
    order: 'asc',
    id: 'id-id',
    q: 'needle',
    mrn: 'id-mrn',
    sexAtBirth: 'FEMALE',
    family: 'needle',
    given: 'needle',
    birthDate: new Date('2026-08-01T00:00:00.000Z'),
    active: true,
    facilityId: 'id-facilityId',
  },
  paymentAllocations: {
    page: 1,
    pageSize: 25,
    sort: 'appliedAt',
    order: 'asc',
    paymentId: 'id-paymentId',
    patientId: 'id-patientId',
    claimId: 'id-claimId',
  },
  payments: {
    page: 1,
    pageSize: 25,
    sort: 'receivedAt',
    order: 'asc',
    patientId: 'id-patientId',
    payerId: 'id-payerId',
    remittanceId: 'id-remittanceId',
    status: 'PENDING',
    source: 'PATIENT',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  prescriptions: {
    page: 1,
    pageSize: 25,
    sort: 'writtenAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    prescriberId: 'id-prescriberId',
    status: 'DRAFT',
  },
  carePlans: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'desc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    status: 'ACTIVE',
    ids: ['id-id'],
  },
  devices: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'desc',
    patientId: 'id-patientId',
    status: 'ACTIVE',
    deviceIdentifier: '08717648200274',
  },
  breakGlassGrants: {
    page: 1,
    pageSize: 25,
    sort: 'grantedAt',
    order: 'desc',
    userId: 'id-userId',
    patientId: 'id-patientId',
    unexpiredAt: new Date('2026-01-01T00:00:00.000Z'),
    grantedSince: new Date('2025-12-31T00:00:00.000Z'),
  },
  goals: {
    page: 1,
    pageSize: 25,
    sort: 'dueDate',
    order: 'asc',
    patientId: 'id-patientId',
    carePlanId: 'id-carePlanId',
    lifecycleStatus: 'ACTIVE',
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-02-01T00:00:00.000Z'),
  },
  careTeams: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'desc',
    patientId: 'id-patientId',
    status: 'ACTIVE',
  },
  careTeamParticipants: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'asc',
    careTeamId: 'id-careTeamId',
    careTeamIds: ['id-careTeamId'],
    memberUserId: 'id-memberUserId',
    patientId: 'id-patientId',
  },
  procedures: {
    page: 1,
    pageSize: 25,
    sort: 'performedStart',
    order: 'desc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    status: 'COMPLETED',
    code: '99213',
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-02-01T00:00:00.000Z'),
  },
  problems: {
    page: 1,
    pageSize: 25,
    sort: 'recordedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    category: 'PROBLEM_LIST_ITEM',
    clinicalStatus: 'ACTIVE',
    code: 'id-code',
  },
  referrals: {
    page: 1,
    pageSize: 25,
    sort: 'priority',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    referredById: 'id-referredById',
    status: 'SENT',
    priority: 'URGENT',
    specialtyCode: 'id-specialtyCode',
    openOnly: true,
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  remittanceLines: {
    page: 1,
    pageSize: 25,
    sort: 'sequence',
    order: 'asc',
    remittanceId: 'id-remittanceId',
    claimId: 'id-claimId',
    matched: true,
  },
  remittances: {
    page: 1,
    pageSize: 25,
    sort: 'receivedAt',
    order: 'asc',
    payerId: 'id-payerId',
    status: 'RECEIVED',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  reports: {
    page: 1,
    pageSize: 25,
    sort: 'issuedAt',
    order: 'asc',
    patientId: 'id-patientId',
    encounterId: 'id-encounterId',
    serviceRequestId: 'id-serviceRequestId',
    status: 'FINAL',
    category: 'LAB',
    abnormalFlag: 'NORMAL',
    reviewed: true,
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  resultObservations: {
    page: 1,
    pageSize: 25,
    sort: 'sequence',
    order: 'asc',
    diagnosticReportId: 'id-diagnosticReportId',
    patientId: 'id-patientId',
    loincCode: 'id-loincCode',
    abnormalFlag: 'NORMAL',
  },
  roleAssignments: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'asc',
    userId: 'id-userId',
    userIds: ['id-userId'],
    roleId: 'id-roleId',
    facilityId: 'id-facilityId',
  },
  roles: { page: 1, pageSize: 25, sort: 'key', order: 'asc', isSystem: true },
  specimens: {
    page: 1,
    pageSize: 25,
    sort: 'collectedAt',
    order: 'asc',
    patientId: 'id-patientId',
    serviceRequestId: 'id-serviceRequestId',
    status: 'AVAILABLE',
    accessionNumber: 'id-accessionNumber',
  },
  statements: {
    page: 1,
    pageSize: 25,
    sort: 'generatedAt',
    order: 'asc',
    patientId: 'id-patientId',
    status: 'DRAFT',
    dunningCycle: 0,
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  stockItems: {
    page: 1,
    pageSize: 25,
    sort: 'name',
    order: 'asc',
    q: 'needle',
    active: true,
    controlled: true,
    unit: 'tablet',
  },
  stockLotStatusChanges: {
    page: 1,
    pageSize: 25,
    sort: 'effectiveOn',
    order: 'asc',
    lotId: 'id-lotId',
    lotIds: ['id-lotId'],
    status: 'AVAILABLE',
  },
  stockLots: {
    page: 1,
    pageSize: 25,
    sort: 'expiresOn',
    order: 'asc',
    itemId: 'id-itemId',
    facilityId: 'id-facilityId',
    status: 'AVAILABLE',
    lotNumber: 'LOT-0001',
    expiringBefore: new Date('2026-09-01T00:00:00.000Z'),
  },
  stockMovements: {
    page: 1,
    pageSize: 25,
    sort: 'occurredOn',
    order: 'asc',
    itemId: 'id-itemId',
    lotId: 'id-lotId',
    facilityId: 'id-facilityId',
    postingId: 'id-postingId',
  },
  stockPostings: {
    page: 1,
    pageSize: 25,
    patientId: 'id-patientId',
    // Compatible with `patientId` on purpose, per the note above: a named chart
    // is a charted posting, so the pair intersects and is actually exercised.
    // The conflicting case is generated from it rather than written here.
    charted: true,
    sort: 'occurredOn',
    order: 'asc',
    facilityId: 'id-facilityId',
    kind: 'DISPENSE',
  },
  tasks: {
    page: 1,
    pageSize: 25,
    sort: 'dueAt',
    order: 'asc',
    type: 'RESULT',
    status: 'OPEN',
    priority: 'NORMAL',
    patientId: 'id-patientId',
    assigneeUserId: 'id-assigneeUserId',
    assigneeTeamKey: 'id-assigneeTeamKey',
    slaState: 'OK',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  telehealthVisits: {
    page: 1,
    pageSize: 25,
    sort: 'scheduledStart',
    order: 'asc',
    appointmentId: 'id-appointmentId',
    status: 'OPEN',
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-09-01T00:00:00.000Z'),
  },
  terminology: {
    page: 1,
    pageSize: 25,
    sort: 'display',
    order: 'asc',
    system: 'id-system',
    code: 'id-code',
    isActive: true,
    q: 'needle',
  },
  userFacilities: {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'asc',
    userId: 'id-userId',
    facilityId: 'id-facilityId',
  },
  users: {
    page: 1,
    pageSize: 25,
    sort: 'familyName',
    order: 'asc',
    status: 'ACTIVE',
    isProvider: true,
    taxonomyCode: 'id-taxonomyCode',
    // Both columns admitted, which is what a bare token resolves to and the
    // only shape with a disjunction in it. The single-column and no-column
    // shapes are exercised in `specs.user-identifier.test.ts`, where the row
    // that must NOT be selected can be stated.
    identifier: { value: 'id-npi', columns: ['npi', 'dea'] },
    q: 'needle',
  },
  valueSets: { page: 1, pageSize: 25, sort: 'url', order: 'asc', url: 'id-url' },
};

/** Marker for a clause no value can satisfy, e.g. `{ in: [] }`. */
const UNSATISFIABLE = Symbol('unsatisfiable');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** Undoes `escapeLike`, so a row can hold the characters the caller typed. */
function unescapeLike(pattern: string): string {
  return pattern.replaceAll(/\\(.)/gu, '$1');
}

/** A value satisfying one column's clause, or `UNSATISFIABLE`. */
function satisfying(clause: unknown): unknown {
  if (!isRecord(clause) || clause instanceof Date) return clause;
  if ('equals' in clause) return clause['equals'];
  if ('in' in clause) {
    const list = asArray(clause['in']);
    return list.length === 0 ? UNSATISFIABLE : list[0];
  }
  if ('has' in clause) return [clause['has']];
  if ('contains' in clause) return `x${unescapeLike(String(clause['contains']))}y`;
  if ('startsWith' in clause) return `${unescapeLike(String(clause['startsWith']))}y`;
  if ('not' in clause) return clause['not'] === null ? 'not-null' : null;
  // A half-open window. The lower bound is inclusive where there is one, and
  // the upper bound is exclusive, so the lower bound itself always satisfies.
  for (const key of ['gte', 'gt', 'lt', 'lte'] as const) {
    if (key in clause) {
      const bound = clause[key];
      if (bound instanceof Date) {
        return key === 'gte' || key === 'gt'
          ? new Date(bound.getTime() + (key === 'gt' ? 1 : 0))
          : new Date(bound.getTime() - 1);
      }
      if (typeof bound === 'number') return key === 'lt' || key === 'lte' ? bound - 1 : bound + 1;
    }
  }
  return UNSATISFIABLE;
}

/**
 * A row satisfying every clause in an emitted `where`.
 *
 * Read out of the `where` rather than out of a fixture, which is what makes
 * this generic: there is no per-model row factory to keep in step with the
 * schema, and a spec that gains a filter gets a row carrying that column for
 * free. The row is not a valid record - it holds only the columns the filter
 * mentions - and that is fine, because `matches` reads only those too.
 */
function satisfy(where: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  // Direct clauses first. A disjunction may name a column one of these has
  // already pinned - `patients` constrains `familyName` by prefix and then
  // offers it again inside the free-text `OR` - and a branch that overwrote it
  // would produce a row satisfying the branch and not the clause above it.
  for (const [key, clause] of Object.entries(where)) {
    if (key === 'AND') {
      for (const inner of asArray(clause)) {
        for (const [column, value] of Object.entries(satisfy(inner as never))) {
          /*
           * The rule stated below for disjunctions, which applies to
           * conjunctions for the same reason and did not used to.
           *
           * Two clauses under one `AND` may name one column - an equality and a
           * `not: null` over a nullable column is how a filter says "this chart"
           * alongside "any chart at all" - and `Object.assign` kept the later,
           * producing a row that satisfies the second clause and not the first.
           * A conjunction has to satisfy both, so a column an earlier clause has
           * already pinned keeps its value whenever that value also satisfies
           * this one.
           */
          if (column in row && matchesWhere(row, inner)) continue;
          row[column] = value;
        }
      }
      continue;
    }
    if (key === 'OR' || key === 'NOT') continue;
    const value = satisfying(clause);
    if (value !== UNSATISFIABLE) row[key] = value;
  }

  // Then each disjunction, taking the first branch that leaves the whole `where`
  // satisfied rather than the first branch outright. The oracle decides, so the
  // search cannot talk itself into a row that only looks right.
  for (const [key, clause] of Object.entries(where)) {
    if (key !== 'OR') continue;
    for (const branch of asArray(clause)) {
      const candidate = { ...row, ...satisfy(branch as never) };
      if (matchesWhere(candidate, where)) {
        Object.assign(row, candidate);
        break;
      }
    }
  }

  return row;
}

/**
 * Fills in the nullable columns the synthesised row does not carry.
 *
 * `satisfy` builds the row out of the emitted `where`, so a column no clause
 * mentions is simply absent - and absent is not a state a database row can be
 * in. That gap hid a whole variant of the drift this file exists to catch.
 *
 * A presence filter reads its column as `row.readAt !== null`. Drop that clause
 * from `where` while leaving it in `matches` and the column stops being
 * mentioned, so the row does not carry it, so `matches` compares `undefined`
 * against null, decides the row qualifies, and agrees with a `where` that is no
 * longer filtering at all. Both ports say yes and the filter has vanished.
 * Verified on this branch: removing the `read` clause from `messageSpec.where`
 * left all 166 cases green before this existed.
 *
 * Null rather than a guessed value, and only for columns the schema says are
 * nullable, because null is the one value those columns are certainly allowed
 * to hold. A non-nullable column stays absent: inventing a value for it would
 * mean knowing its type, and getting that wrong produces a row the schema could
 * not hold - the thing the mutant pass is careful about for the same reason.
 */
function complete(spec: Loose, row: Record<string, unknown>): Record<string, unknown> {
  const filled = { ...row };
  for (const column of (NULLABLE_COLUMNS.get(spec.model) ?? new Map<string, string>()).keys()) {
    if (!(column in filled)) filled[column] = null;
  }
  return filled;
}

/** Every column the emitted `where` constrains, for the mutation pass. */
function constrained(where: Readonly<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  for (const [key, clause] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR') {
      for (const inner of asArray(clause))
        for (const c of constrained(inner as never)) columns.add(c);
      continue;
    }
    if (key === 'NOT') continue;
    columns.add(key);
  }
  return [...columns];
}

/**
 * Which columns of each model may hold null, and what type each one is, read
 * out of the schema.
 *
 * The one-column-away pass below needs this, and needs it to be true rather
 * than approximately true. Its mutants have to be rows the database could
 * actually hold: a null in a `NOT NULL` column is not a caller two filters
 * disagree for, it is a row that cannot exist, and `matches` reading a date off
 * it throws before either port has answered anything.
 *
 * Parsed from `schema.prisma` rather than read from Prisma's runtime metadata,
 * because there is none to read. The `prisma-client` generator emits TypeScript;
 * the runtime `Prisma` namespace carries the scalar field enums and the Decimal
 * helpers and no `dmmf`. The generated model types do carry nullability, and
 * types erase, so a runtime check cannot use them. The schema is what the
 * generated types are derived from, so parsing it is closer to the truth than
 * either - and a hand-kept list is the thing that goes stale the first time a
 * column becomes optional.
 *
 * Relation fields are excluded by name: their type is another model, and they
 * are not columns a `where` can constrain, so admitting them would let a
 * meaningless mutant through.
 */
function nullableColumns(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const schema = readFileSync(
    fileURLToPath(new URL('../../../../packages/database/prisma/schema.prisma', import.meta.url)),
    'utf8'
  );

  const blocks = new Map<string, string[]>();
  let open: string[] | undefined;
  for (const raw of schema.split('\n')) {
    const line = raw.trim();
    const header = /^model\s+(\w+)\s*\{/u.exec(line);
    if (header?.[1] !== undefined) {
      open = [];
      blocks.set(header[1], open);
      continue;
    }
    if (open !== undefined && line === '}') {
      open = undefined;
      continue;
    }
    if (open !== undefined) open.push(line);
  }

  const modelNames = new Set(blocks.keys());
  const nullable = new Map<string, ReadonlyMap<string, string>>();
  for (const [model, lines] of blocks) {
    const columns = new Map<string, string>();
    for (const line of lines) {
      // `///` documentation, `@@` block attributes and blank lines carry no field.
      if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = /^(\w+)\s+([A-Za-z_]\w*)(\[\])?(\?)?/u.exec(line);
      if (field?.[1] === undefined || field[4] !== '?') continue;
      if (modelNames.has(field[2] ?? '')) continue;
      columns.set(field[1], field[2] ?? 'String');
    }
    nullable.set(model, columns);
  }
  return nullable;
}

const NULLABLE_COLUMNS = nullableColumns();

/**
 * The table has to have found something, and the right something.
 *
 * Found in review, and it is this file's own subject one level up. An empty
 * `NULLABLE_COLUMNS` - a moved schema, a Prisma syntax change, a regex that
 * stops matching - silently disarms every mutant that depends on it: two of the
 * three reproductions this change added go green again, and the third survives
 * by accident rather than by design, because with no table the row simply omits
 * the column and `matches` disagrees for an unrelated reason. A pass that
 * happens for the wrong reason reads as coverage.
 *
 * Both halves earn their place. A size floor survives a regex that matched the
 * wrong thing and found plenty of it; a named canary survives a parse that found
 * two models and stopped. `StockPosting.patientId` is the canary because it is
 * the column the reported case turns on.
 */
describe('the nullable-column table', () => {
  it('found the schema, and found the column the reported case turns on', () => {
    expect(NULLABLE_COLUMNS.size).toBeGreaterThan(40);
    expect(NULLABLE_COLUMNS.get('StockPosting')?.get('patientId')).toBe('String');
    expect(NULLABLE_COLUMNS.get('MessageThread')?.get('closedAt')).toBe('DateTime');
    // And it is a table of nullable columns, not of every column: a `NOT NULL`
    // one must not be in it, or the null mutants become rows the schema forbids.
    expect(NULLABLE_COLUMNS.get('StockPosting')?.has('facilityId')).toBe(false);
  });
});

/**
 * A non-null value of the column's own type, for the mutant that null cannot be.
 *
 * A filter can be satisfied BY null - `open: true` asks for a thread with no
 * `closedAt` - and for those the separating row is a non-null one. Building it
 * needs the column's type, which is the same reason the null mutant needs the
 * column's nullability, and the schema carries both.
 *
 * A type this does not name falls back to a foreign string. That is right for
 * an enum, which is a string column whose members this file has no business
 * enumerating, and safe for anything else: a comparison against it is false,
 * which is what a mutant is for.
 */
function nonNullOfType(prismaType: string): unknown {
  if (prismaType === 'DateTime') return new Date('2031-07-04T00:00:00.000Z');
  if (['Int', 'Float', 'Decimal', 'BigInt'].includes(prismaType)) return 4_070_909;
  if (prismaType === 'Boolean') return true;
  if (prismaType === 'Json') return {};
  return FOREIGN;
}

/** A value no fixture uses, for building a row or a query that should not match. */
const FOREIGN = 'a-value-nothing-asked-for';

/**
 * A value of the same type as the one given, and never equal to it.
 *
 * Type-preserving on purpose. A string parameter swapped for a date does not
 * describe a caller two filters disagree for; it describes a request the schema
 * would have rejected, and it throws inside `matches` before either port has
 * answered anything.
 */
function conflictingValue(held: unknown): unknown {
  if (Array.isArray(held)) {
    const first: unknown = (held as unknown[])[0];
    return [conflictingValue(first ?? FOREIGN)];
  }
  if (held instanceof Date) return new Date(held.getTime() + 86_400_000 * 4000);
  if (typeof held === 'number') return held + 9973;
  if (typeof held === 'boolean') return !held;
  return FOREIGN;
}

/** The BaseQuery half, which every spec needs and none filters on. */
function paging(query: Record<string, unknown>): Record<string, unknown> {
  return {
    page: query['page'],
    pageSize: query['pageSize'],
    sort: query['sort'],
    order: query['order'],
  };
}

/**
 * Query parameters that end up writing the same `where` column.
 *
 * Found by asking rather than by listing: each parameter is sent on its own and
 * the columns it produces are recorded, so a pair is "colliding" when their
 * column sets intersect. That means a new pair is detected the day it is added,
 * with nothing here to update.
 *
 * This is the shape that has gone wrong three times - `Claim.status`/`statuses`,
 * `RoleAssignment.userId`/`userIds`, `Referral.status`/`openOnly` - and each
 * time as two spreads onto one key, where the later silently won.
 */
function collidingPairs(spec: Loose, query: Record<string, unknown>): [string, string][] {
  const base = paging(query);
  const columnsOf = new Map<string, Set<string>>();
  for (const [param, value] of Object.entries(query)) {
    if (param in base) continue;
    let emitted: Record<string, unknown>;
    try {
      emitted = spec.where({ ...base, [param]: value } as never);
    } catch {
      continue;
    }
    columnsOf.set(param, new Set(constrained(emitted)));
  }

  const pairs: [string, string][] = [];
  const params = [...columnsOf.keys()];
  for (let i = 0; i < params.length; i += 1) {
    for (let j = i + 1; j < params.length; j += 1) {
      const left = columnsOf.get(params[i] ?? '') ?? new Set();
      const right = columnsOf.get(params[j] ?? '') ?? new Set();
      if ([...left].some((column) => right.has(column))) {
        pairs.push([params[i] ?? '', params[j] ?? '']);
      }
    }
  }
  return pairs;
}

interface Loose {
  /** The Prisma model, which is how the nullable-column table is keyed. */
  model: string;
  matches: (row: never, query: never) => boolean;
  where: (query: never) => Record<string, unknown>;
}

const SPECS = Object.entries(COLLECTION_SPECS) as [keyof typeof COLLECTION_SPECS, Loose][];

describe('every spec answers the same question through both ports', () => {
  it('checks every collection there is', () => {
    // Guards against a refactor that empties the map and turns this whole file
    // into a test of nothing.
    expect(SPECS.length).toBeGreaterThan(40);
    expect(Object.keys(FILTERS)).toHaveLength(SPECS.length);
  });

  describe.each(SPECS)('%s', (key, spec) => {
    const query = FILTERS[key] as never;

    it('agrees on a row the filter should select', () => {
      const where = spec.where(query);
      const row = complete(spec, satisfy(where));

      expect(matchesWhere(row, where), 'the synthesised row satisfies its own where').toBe(true);
      expect(spec.matches(row as never, query), 'and matches agrees it does').toBe(true);
    });

    /**
     * The case the other two cannot reach.
     *
     * Where two parameters write one column, they agree trivially while they
     * ask for the same thing. The divergence only appears once they disagree:
     * the Prisma object literal keeps whichever spread came last and drops the
     * other, while `matches` goes on testing both. So each colliding pair is
     * re-asked with the two sides deliberately in conflict.
     *
     * Every historical instance of this bug is invisible without this test, and
     * all three are caught by it.
     */
    it('agrees when two parameters over one column disagree', () => {
      const pairs = collidingPairs(spec, query);
      const disagreements: string[] = [];

      for (const [left, right] of pairs) {
        for (const target of [left, right]) {
          const held = (query as Record<string, unknown>)[target];
          // Point one side at something the other cannot be, keeping the type
          // the parameter actually has. A mutant of the wrong type does not
          // model a disagreement, it models a caller the schema would have
          // refused, and it crashes `matches` on the way past.
          const conflicting = {
            ...(query as Record<string, unknown>),
            [target]: conflictingValue(held),
          };
          let where: Record<string, unknown>;
          try {
            where = spec.where(conflicting as never);
          } catch {
            continue;
          }

          // Rows drawn from both sides of the conflict, plus the foreign value
          // the dropped filter would have let through.
          const candidates = [
            satisfy(where),
            satisfy(spec.where(query)),
            { ...satisfy(where), [String(constrained(where)[0] ?? 'id')]: FOREIGN },
          ];
          for (const row of candidates) {
            let memory: boolean;
            try {
              memory = spec.matches(row as never, conflicting as never);
            } catch {
              // A discriminator parameter (`window` on claims picks which column
              // the date bounds apply to) has no conflicting value that is still
              // a legal member of its union. Nothing to compare.
              continue;
            }
            const prisma = matchesWhere(row, where);
            if (memory !== prisma) {
              disagreements.push(
                `${left}/${right} conflicting on ${target}: memory=${memory} prisma=${prisma} row=${JSON.stringify(row)}`
              );
            }
          }
        }
      }

      expect(disagreements).toEqual([]);
    });

    /**
     * The same agreement, asked one parameter at a time.
     *
     * Everything above sends the whole query, and a filter can be redundant
     * under it. `stockPostingSpec` is the worked example: `patientId` names a
     * chart and `charted` asks whether there is one, so with both sent, every
     * row satisfying the first satisfies the second - drop `charted` from
     * `where` while leaving it in `matches` and the two ports agree on every row
     * the pass above can build, because the row that separates them is one the
     * other parameter has already excluded.
     *
     * Sent alone the redundancy is gone and the clause is the only thing
     * filtering, so its absence is immediately a disagreement. This is the
     * whole of #274: a dropped clause was invisible exactly when another
     * parameter happened to constrain the same column.
     */
    it('agrees on every parameter asked on its own', () => {
      const base = paging(query);
      const disagreements: string[] = [];

      for (const [param, value] of Object.entries(query)) {
        if (param in base) continue;
        const alone = { ...base, [param]: value } as never;
        let where: Record<string, unknown>;
        try {
          where = spec.where(alone);
        } catch {
          // A parameter that needs a companion to be meaningful - the claims
          // date `window` discriminator is the example - throws on its own.
          continue;
        }
        const row = complete(spec, satisfy(where));
        const nullable = NULLABLE_COLUMNS.get(spec.model) ?? new Map<string, string>();

        const rows: [string, Record<string, unknown>][] = [['selected', row]];
        /*
         * Every nullable column, not only the ones this `where` constrains.
         *
         * A dropped clause takes its own column out of `constrained(where)`, so
         * a pass driven by the emitted filter cannot mutate the column whose
         * clause has gone - the mutation removes its own detection. Driving it
         * from the schema instead is independent of the thing under test, which
         * is the property the rest of this file already relies on for `matches`.
         */
        for (const [column, prismaType] of nullable) {
          const held = row[column];
          rows.push([
            `${column}=${held === null ? 'non-null' : 'null'}`,
            { ...row, [column]: held === null ? nonNullOfType(prismaType) : null },
          ]);
        }
        for (const column of constrained(where)) {
          const held = row[column];
          rows.push([
            `${column}=foreign`,
            {
              ...row,
              [column]:
                held instanceof Date
                  ? new Date(held.getTime() + 86_400_000 * 400)
                  : typeof held === 'number'
                    ? held + 9973
                    : typeof held === 'boolean'
                      ? !held
                      : Array.isArray(held)
                        ? []
                        : FOREIGN,
            },
          ]);
          if (nullable.has(column)) rows.push([`${column}=null`, { ...row, [column]: null }]);
        }

        for (const [label, candidate] of rows) {
          let memory: boolean;
          try {
            memory = spec.matches(candidate as never, alone);
          } catch {
            continue;
          }
          const prisma = matchesWhere(candidate, where);
          if (memory !== prisma) {
            disagreements.push(`${param} alone, ${label}: memory=${memory} prisma=${prisma}`);
          }
        }
      }

      expect(disagreements).toEqual([]);
    });

    it('agrees on every row one column away from selected', () => {
      const where = spec.where(query);
      const row = complete(spec, satisfy(where));
      const nullable = NULLABLE_COLUMNS.get(spec.model) ?? new Map<string, string>();

      const disagreements: string[] = [];
      for (const column of constrained(where)) {
        // A value of the same shape as the one that satisfied, so the mutant is
        // a row the schema could actually hold rather than a type error.
        const held = row[column];
        const foreign =
          held instanceof Date
            ? new Date(held.getTime() + 86_400_000 * 400)
            : typeof held === 'number'
              ? held + 9973
              : typeof held === 'boolean'
                ? !held
                : Array.isArray(held)
                  ? []
                  : 'a-value-nothing-asked-for';

        /*
         * And null, where the column may hold it.
         *
         * A foreign value of the same type cannot separate two filters that
         * both constrain one column when one of them tests presence rather than
         * value: `{ patientId: id }` and `{ patientId: { not: null } }` both
         * reject a foreign id, so dropping the second from `where` while
         * leaving it in `matches` left both ports agreeing on every row this
         * pass built. Null is the row that separates them, and nothing built it.
         *
         * Only for columns the schema says are nullable. A null in a `NOT NULL`
         * column is not a caller two filters disagree for; it is a row that
         * cannot exist, and `matches` reading a date off it throws before either
         * port has answered - which is a crash worth failing on somewhere else,
         * not something to be caught and swallowed here.
         */
        const mutants = nullable.has(column) ? [foreign, null] : [foreign];

        for (const value of mutants) {
          const mutant = { ...row, [column]: value };
          const memory = spec.matches(mutant as never, query);
          const prisma = matchesWhere(mutant, where);
          if (memory !== prisma) {
            disagreements.push(
              `${column}=${value === null ? 'null' : 'foreign'}: memory=${memory} prisma=${prisma}`
            );
          }
        }
      }

      expect(disagreements).toEqual([]);
    });
  });
});

/**
 * The one divergence the walk above cannot see.
 *
 * It synthesises its row from the emitted `where`, so for a date filter it
 * builds exactly the instant the filter asks for - and an exact-equality
 * `where` and a same-day `matches` both accept that. Catching the difference
 * needs a row whose birthDate carries a time, which nothing in the tree
 * constructs, because `@db.Date` and both parsers conspire to make midnight the
 * only value that ever arrives.
 *
 * That conspiracy is the point. It holds today across three files that never
 * change together, and this is what notices when one of them moves.
 */
describe('the patient birth-date filter states one rule, not two', () => {
  const query = {
    page: 1,
    pageSize: 25,
    sort: 'familyName',
    order: 'asc',
    birthDate: new Date('1985-03-14T00:00:00.000Z'),
  } as const;

  const born = (iso: string): Record<string, unknown> => ({ birthDate: new Date(iso) });

  it('accepts any instant on the day, through both ports', () => {
    const where = COLLECTION_SPECS.patients.where(query);

    for (const iso of [
      '1985-03-14T00:00:00.000Z',
      '1985-03-14T09:30:00.000Z',
      '1985-03-14T23:59:59.999Z',
    ]) {
      const row = born(iso);
      const memory = COLLECTION_SPECS.patients.matches(row as never, query);
      const prisma = matchesWhere(row, where);
      expect(memory, `memory accepts ${iso}`).toBe(true);
      expect(prisma, `Prisma accepts ${iso}`).toBe(true);
    }
  });

  it('rolls the upper bound over a month and a year end', () => {
    // The range is built from `Date.UTC(y, m, d + 1)`, which carries into the
    // next month or year on its own. These are the days where a hand-rolled
    // `+ 1` would have produced 32 December.
    for (const day of ['1985-12-31', '1984-02-29', '1985-01-31']) {
      const dayQuery = { ...query, birthDate: new Date(`${day}T00:00:00.000Z`) };
      const where = COLLECTION_SPECS.patients.where(dayQuery);
      const late = born(`${day}T23:59:59.999Z`);

      expect(COLLECTION_SPECS.patients.matches(late as never, dayQuery), `memory ${day}`).toBe(
        true
      );
      expect(matchesWhere(late, where), `Prisma ${day}`).toBe(true);
    }
  });

  it('rejects the instants either side of it, through both ports', () => {
    const where = COLLECTION_SPECS.patients.where(query);

    for (const iso of ['1985-03-13T23:59:59.999Z', '1985-03-15T00:00:00.000Z']) {
      const row = born(iso);
      expect(COLLECTION_SPECS.patients.matches(row as never, query), `memory rejects ${iso}`).toBe(
        false
      );
      expect(matchesWhere(row, where), `Prisma rejects ${iso}`).toBe(false);
    }
  });
});

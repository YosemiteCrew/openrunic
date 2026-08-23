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
      for (const inner of asArray(clause)) Object.assign(row, satisfy(inner as never));
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

  it('agrees on a birthDate recorded at a non-midnight instant on the queried UTC day', () => {
    // satisfy() only ever builds midnight instants - it reads the gte bound off
    // the window - so the generic pass above cannot reach a row whose birthDate
    // falls later in the same UTC day. This case pins that row directly: it is
    // red on exact-equality where (memory=true, prisma=false) and green once
    // where emits the same UTC-day window matches already tests.
    const spec = COLLECTION_SPECS.patients as unknown as Loose;
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'familyName',
      order: 'asc',
      birthDate: new Date('2026-08-01T00:00:00.000Z'),
    };
    const row = { birthDate: new Date('2026-08-01T13:00:00.000Z') };
    const where = spec.where(query as never);

    expect(spec.matches(row as never, query as never)).toBe(matchesWhere(row, where));
    expect(matchesWhere(row, where)).toBe(true);
  });

  describe.each(SPECS)('%s', (key, spec) => {
    const query = FILTERS[key] as never;

    it('agrees on a row the filter should select', () => {
      const where = spec.where(query);
      const row = satisfy(where);

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

    it('agrees on every row one column away from selected', () => {
      const where = spec.where(query);
      const row = satisfy(where);

      const disagreements: string[] = [];
      for (const column of constrained(where)) {
        // A value of the same shape as the one that satisfied, so the mutant is
        // a row the schema could actually hold rather than a type error.
        const held = row[column];
        const mutant = {
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
                    : 'a-value-nothing-asked-for',
        };
        const memory = spec.matches(mutant as never, query);
        const prisma = matchesWhere(mutant, where);
        if (memory !== prisma) {
          disagreements.push(`${column}: memory=${memory} prisma=${prisma}`);
        }
      }

      expect(disagreements).toEqual([]);
    });
  });
});

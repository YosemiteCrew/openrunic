import type { StockMovement as PackageMovement } from '@openrunic/inventory';

import { ApiError } from '../../errors.js';
import { movementColumns, toIsoDate } from '../../inventory/marshal.js';
import { assertPostable } from '../../inventory/posting.js';
import {
  type BaseQuery,
  childBatch,
  type ChildBatch,
  childPatch,
  type ChildPatch,
  type CollectionSpec,
  containsFold,
  equalsIfSet,
  inWindow,
  likeContains,
  type RowContext,
  windowFilter,
  type Writable,
} from '../collection.js';
import { STOCK_ITEM_DEFAULTS, STOCK_LOT_DEFAULTS } from '../defaults.js';
import type { PrismaModelName, Row, ScopedRow } from '../rows.js';

/**
 * THE STOCKROOM'S FIVE TABLES.
 *
 * `StockItem` is the catalogue, `StockLot` is a carton at a site, `StockPosting`
 * is one thing that happened, and `StockMovement` is the append-only ledger line
 * it produced. On-hand is nowhere: it is summed from the movements every time it
 * is asked for, because a stored quantity can be set, and once it can be set it
 * will be, by a well-meant repair of a number that looked wrong - which is
 * exactly what a controlled-substance audit exists to detect.
 *
 * `StockLotStatusChange` is the fifth, and it is there for the same reason the
 * ledger is. A lot's status was one mutable value, so every as-of question was
 * answered with today's answer: a lot retired on the 10th dropped out of a
 * query about the 1st, and a reconciliation of the 1st came up short against a
 * shelf that had been correct. A quantity that can be set and a status that can
 * be overwritten are the same mistake twice.
 *
 * ## Why all four are `closed`
 *
 * Not one of these tables is safe to serve to a patient-scoped token. Three of
 * them are the stockroom and carry no chart at all. The fourth, `StockPosting`,
 * *does* carry a `patientId`, and it is still closed: the compartment rule is
 * table-level while the leak is row-level, because one posting carries the
 * supplier's packing slip and its sibling lines name every other patient's lot
 * draws. "What was dispensed to me" is a purpose-built endpoint with its own
 * DTO, and it is not this change.
 *
 * `patientColumn` on the posting spec therefore narrows nothing. It is declared
 * so the audit event stamps the chart and a dispense lands on the patient access
 * report; `compartment` is the separate field that restricts, and it says
 * closed. The pairing looks like an oversight and is not.
 *
 * ## Why the ledger is written here rather than by a route
 *
 * `stockPostingSpec.childRows` is the only place a `StockMovement` row is ever
 * built, and it runs {@link assertPostable} - the package's `movementProblems` -
 * on every line before returning it. Both storage implementations call
 * `childRows` inside the parent's own transaction, so a route added later by
 * somebody who has not read this file cannot reach the table with an invalid
 * row, and the memory-backed HTTP suite exercises the same refusal Postgres
 * would otherwise have to be trusted for.
 */

/**
 * The three enum columns, taken from the generated row types rather than
 * restated. `packages/database`'s `EnumParityProof` already ties each Prisma
 * enum to its tuple, and `apps/api/src/inventory/units.ts` ties it to the
 * package's own union, so this is the third side of a triangle that is already
 * proved on both of the others.
 */
export type StockLotStatus = Row<'StockLot'>['status'];
export type StockMovementKind = Row<'StockMovement'>['kind'];
export type StockPostingKind = Row<'StockPosting'>['kind'];

/* ------------------------------------------------------------- stock items */

export interface StockItemCreateInput {
  readonly sku: string;
  readonly name: string;
  /** One of `STOCK_UNITS`; see `apps/api/src/inventory/units.ts` for the proof. */
  readonly unit: string;
  readonly rxnormCode?: string;
  readonly ndcCode?: string;
  readonly cvxCode?: string;
  readonly packSize?: number;
  readonly reorderLevel?: number;
  readonly controlled?: boolean;
  readonly controlledSchedule?: string;
  readonly active?: boolean;
}

/**
 * What an amend may change.
 *
 * Neither `sku` nor `unit` is here. The sku is the natural key the practice
 * orders against, and the unit is what every historical quantity in the ledger
 * *means* - re-labelling an item from tablets to boxes would silently reinterpret
 * every movement ever posted against it. Both are strict-object omissions rather
 * than ignored fields, so a client that sends one gets a 422 instead of
 * believing it was applied.
 */
export type StockItemUpdateInput = {
  readonly name?: string;
  readonly rxnormCode?: string;
  readonly ndcCode?: string;
  readonly cvxCode?: string;
  readonly packSize?: number;
  readonly reorderLevel?: number;
  readonly controlled?: boolean;
  readonly controlledSchedule?: string;
  readonly active?: boolean;
};

export interface StockItemListQuery extends BaseQuery {
  /** Free text over the catalogue code and the name, which is how a clerk looks. */
  q?: string;
  active?: boolean;
  controlled?: boolean;
  unit?: string;
  sort: 'name' | 'sku' | 'createdAt';
}

export const stockItemSpec: CollectionSpec<
  'StockItem',
  StockItemCreateInput,
  StockItemUpdateInput,
  StockItemListQuery
> = {
  model: 'StockItem',
  targetType: 'StockItem',
  action: 'stock.item',
  compartment: 'closed',

  newRow(input: StockItemCreateInput): Writable<'StockItem'> {
    return {
      sku: input.sku,
      name: input.name,
      unit: input.unit,
      rxnormCode: input.rxnormCode ?? null,
      ndcCode: input.ndcCode ?? null,
      cvxCode: input.cvxCode ?? null,
      packSize: input.packSize ?? null,
      reorderLevel: input.reorderLevel ?? null,
      controlled: input.controlled ?? STOCK_ITEM_DEFAULTS.controlled,
      controlledSchedule: input.controlledSchedule ?? null,
      active: input.active ?? STOCK_ITEM_DEFAULTS.active,
    };
  },

  patchData(patch: StockItemUpdateInput): Partial<Writable<'StockItem'>> {
    return mentionedColumns<'StockItem'>(patch);
  },

  matches(row: ScopedRow<'StockItem'>, query: StockItemListQuery): boolean {
    return (
      equalsIfSet(query.active, row.active) &&
      equalsIfSet(query.controlled, row.controlled) &&
      equalsIfSet(query.unit, row.unit) &&
      (query.q === undefined || containsFold([row.sku, row.name], query.q))
    );
  },

  where(query: StockItemListQuery) {
    return {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.controlled === undefined ? {} : { controlled: query.controlled }),
      ...(query.unit === undefined ? {} : { unit: query.unit }),
      // `mode` on every branch of the OR, not only the first. A branch without
      // it is case-sensitive in Postgres and case-insensitive in the memory
      // store, which is the shape of a filter that passes its tests and finds
      // nothing in production.
      ...(query.q === undefined
        ? {}
        : {
            OR: [{ sku: likeContains(query.q) }, { name: likeContains(query.q) }],
          }),
    };
  },

  sortValue(row: ScopedRow<'StockItem'>, sort: StockItemListQuery['sort']): number | string {
    if (sort === 'sku') return row.sku;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.name;
  },

  orderBy(query: StockItemListQuery) {
    if (query.sort === 'sku') return [{ sku: query.order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ name: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'StockItem'>): Record<string, unknown> {
    return { sku: row.sku, unit: row.unit };
  },

  uniqueBy: {
    where: (input: StockItemCreateInput) => ({ sku: input.sku }),
    matches: (row: ScopedRow<'StockItem'>, input: StockItemCreateInput) => row.sku === input.sku,
    message: (input: StockItemCreateInput) => `A stock item with sku ${input.sku} already exists.`,
  },
};

/* -------------------------------------------------------------- stock lots */

export interface StockLotCreateInput {
  readonly itemId: string;
  readonly facilityId: string;
  readonly lotNumber: string;
  readonly receivedOn: Date;
  readonly status?: StockLotStatus;
  readonly expiresOn?: Date;
  readonly openedOn?: Date;
  readonly beyondUseDays?: number;
  readonly manufacturer?: string;
  readonly ndcCode?: string;
}

/**
 * Declared as a type alias rather than an interface, and both patch shapes here
 * are, because only an alias carries an implicit index signature - which is what
 * lets {@link mentionedColumns} walk it without a cast at the call site.
 */
export type StockLotUpdateInput = {
  readonly status?: StockLotStatus;
  readonly openedOn?: Date;
  readonly beyondUseDays?: number;
};

export interface StockLotListQuery extends BaseQuery {
  itemId?: string;
  facilityId?: string;
  status?: StockLotStatus;
  lotNumber?: string;
  /** Exclusive upper bound on `expiresOn`. A lot with no expiry is outside it. */
  expiringBefore?: Date;
  sort: 'expiresOn' | 'receivedOn' | 'lotNumber' | 'createdAt';
}

/**
 * A lot that cannot expire sorts last, ascending.
 *
 * The sentinel mirrors `fefo`, which puts an undated lot behind everything that
 * can go off - there is never a reason to spend it ahead of something with a
 * clock on it. A far-future string rather than `Infinity` because the memory
 * comparator subtracts numbers, and `Infinity - Infinity` is `NaN`, which makes
 * two undated lots compare as neither before nor after each other and leaves
 * their order to whatever the array happened to be. It also matches Postgres,
 * which puts NULLs last ascending and first descending - exactly where this
 * sentinel lands.
 */
const NEVER_EXPIRES = '9999-12-31';

export const stockLotSpec: CollectionSpec<
  'StockLot',
  StockLotCreateInput,
  StockLotUpdateInput,
  StockLotListQuery
> = {
  model: 'StockLot',
  targetType: 'StockLot',
  action: 'stock.lot',
  facilityColumn: 'facilityId',
  facilityScoped: true,
  compartment: 'closed',

  newRow(input: StockLotCreateInput): Writable<'StockLot'> {
    return lotColumns(input);
  },

  patchData(patch: StockLotUpdateInput): Partial<Writable<'StockLot'>> {
    return mentionedColumns<'StockLot'>(patch);
  },

  matches(row: ScopedRow<'StockLot'>, query: StockLotListQuery): boolean {
    return (
      equalsIfSet(query.itemId, row.itemId) &&
      equalsIfSet(query.facilityId, row.facilityId) &&
      equalsIfSet(query.status, row.status) &&
      equalsIfSet(query.lotNumber, row.lotNumber) &&
      inWindow(row.expiresOn, undefined, query.expiringBefore)
    );
  },

  where(query: StockLotListQuery) {
    return {
      ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.lotNumber === undefined ? {} : { lotNumber: query.lotNumber }),
      ...(query.expiringBefore === undefined
        ? {}
        : { expiresOn: windowFilter(undefined, query.expiringBefore) }),
    };
  },

  sortValue(row: ScopedRow<'StockLot'>, sort: StockLotListQuery['sort']): number | string {
    if (sort === 'receivedOn') return row.receivedOn.getTime();
    if (sort === 'lotNumber') return row.lotNumber;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.expiresOn === null ? NEVER_EXPIRES : toIsoDate(row.expiresOn);
  },

  orderBy(query: StockLotListQuery) {
    if (query.sort === 'receivedOn') return [{ receivedOn: query.order }, { id: 'asc' as const }];
    if (query.sort === 'lotNumber') return [{ lotNumber: query.order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ expiresOn: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'StockLot'>): Record<string, unknown> {
    return { lotNumber: row.lotNumber, status: row.status };
  },

  uniqueBy: {
    where: (input: StockLotCreateInput) => ({
      itemId: input.itemId,
      facilityId: input.facilityId,
      lotNumber: input.lotNumber,
    }),
    matches: (row: ScopedRow<'StockLot'>, input: StockLotCreateInput) =>
      row.itemId === input.itemId &&
      row.facilityId === input.facilityId &&
      row.lotNumber === input.lotNumber,
    message: (input: StockLotCreateInput) =>
      `Lot ${input.lotNumber} of that item already exists at that facility.`,
  },
};

/* ---------------------------------------------------------- stock postings */

/** One ledger line of a posting, before it has an id or a home. */
export interface StockPostingLine {
  /** The movement as the package models it. Checked by `childRows`, never before. */
  readonly movement: PackageMovement;
  /** Its position in its lot's ledger, computed from the same snapshot the allocation was. */
  readonly lotSeq: number;
}

export interface StockPostingCreateInput {
  readonly kind: StockPostingKind;
  readonly facilityId: string;
  readonly patientId?: string;
  readonly encounterId?: string;
  readonly prescriptionId?: string;
  readonly immunizationId?: string;
  readonly occurredOn: Date;
  readonly postedById: string;
  readonly witnessedById?: string;
  readonly reference?: string;
  readonly note?: string;
  /**
   * Lots this posting brings into existence, written before the movements that
   * name them. A delivery of a carton number this site has never seen is a lot
   * row and an opening movement, and they are one act.
   */
  readonly newLots?: readonly (StockLotCreateInput & { readonly id: string })[];
  /**
   * Status changes this posting records, one per lot at most.
   *
   * A recall, a quarantine, a retirement or a release. Each writes a history
   * row and amends the lot's own `status` column, and the two travel together
   * for the reason `ChildPatch` exists: the history is the truth, the column is
   * what the lot list narrows on, and a recall in one and not the other
   * produces a `status=RECALLED` listing with the recalled carton missing.
   *
   * The route refuses a change dated before the lot's latest recorded entry, so
   * the newest entry is always the one in force - which is why amending the
   * column needs no comparison here.
   */
  readonly statusChanges?: readonly (StockLotStatusChangeCreateInput & { readonly id: string })[];
  readonly lines: readonly StockPostingLine[];
}

/**
 * The patch type of a table that has no patch.
 *
 * `Record<string, never>` rather than `never` or `unknown`: the generated
 * isolation contract calls `update(id, {})` against a cross-tenant row, and it
 * has to type-check. Both implementations return null from the "no such row in
 * scope" branch before `patchData` is reached, so that call never lands here.
 */
export type StockLedgerPatch = Record<string, never>;

const APPEND_ONLY =
  'The stock ledger is append-only. Correct a movement by posting one that points at it.';

export interface StockPostingListQuery extends BaseQuery {
  facilityId?: string;
  kind?: StockPostingKind;
  /** The chart a posting belongs to, for the postings that belong to one. */
  patientId?: string;
  sort: 'occurredOn' | 'createdAt';
}

export const stockPostingSpec: CollectionSpec<
  'StockPosting',
  StockPostingCreateInput,
  StockLedgerPatch,
  StockPostingListQuery
> = {
  model: 'StockPosting',
  targetType: 'StockPosting',
  action: 'stock.posting',
  patientColumn: 'patientId',
  facilityColumn: 'facilityId',
  facilityScoped: true,
  encounterColumn: 'encounterId',
  /*
   * Compartmented on the chart rather than closed, which is a deliberate
   * widening and the reason `MedicationDispense` can be served at all.
   *
   * `closed` refuses a patient-scoped principal the whole table. That was the
   * right default while nothing here was addressed to a patient, and it stops
   * being right once a dispense to that patient is a resource they are entitled
   * to read: US Core requires it, and a patient reconciling their medicines
   * against a recall has nowhere else to find the lot.
   *
   * The narrowing is an equality on `patientId`, so it excludes rather than
   * exposes the operational postings. A receipt, a cycle count, a wastage and a
   * transfer all carry a null chart, and null does not equal a compartment id
   * in either storage implementation, so none of them is reachable by a
   * patient-scoped token. `specs.stock-posting-compartment.test.ts` pins that,
   * because it is the half a reader has to take on trust otherwise.
   */
  compartment: { column: 'patientId' },

  newRow(input: StockPostingCreateInput): Writable<'StockPosting'> {
    return {
      kind: input.kind,
      facilityId: input.facilityId,
      patientId: input.patientId ?? null,
      encounterId: input.encounterId ?? null,
      prescriptionId: input.prescriptionId ?? null,
      immunizationId: input.immunizationId ?? null,
      occurredOn: input.occurredOn,
      postedById: input.postedById,
      witnessedById: input.witnessedById ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
    };
  },

  /**
   * Two batches, and the order between them is a foreign key.
   *
   * A delivery of a lot number this site has never seen has to create the lot
   * before the movement that references it, and both implementations write
   * batches in array order inside the parent's own transaction - so a receipt is
   * atomic all the way down rather than a lot row written by one call and a
   * movement by another.
   *
   * An empty movement batch is deliberate and is not a no-op: a cycle count
   * where every lot agreed posts a `COUNT` with no lines, because proving the
   * shelf was right is most of what a count is for, and a posting that vanished
   * when it found nothing would make a clean count indistinguishable from a
   * count nobody did.
   */
  childRows(
    input: StockPostingCreateInput,
    parent: ScopedRow<'StockPosting'>,
    context: RowContext
  ): ChildBatch[] {
    const lots = (input.newLots ?? []).map((lot) => ({ id: lot.id, ...lotColumns(lot) }));
    const movements = input.lines.map((line, index) => ({
      id: line.movement.id,
      ...movementColumns(assertPostable(line.movement, index), {
        postingId: parent.id,
        facilityId: input.facilityId,
        lotSeq: line.lotSeq,
      }),
    }));

    /**
     * The opening entry in each new lot's status history, written in the same
     * transaction as the lot itself.
     *
     * Without it a lot minted today has no history, so the first recorded
     * change would also be the earliest one - and `statusAt` takes the earliest
     * entry as the state before it. A carton received in August and recalled in
     * September would then read as recalled in August too, which is the
     * fail-safe direction but is not what happened, and a back-dated
     * reconciliation would be short by a carton that was genuinely on the shelf.
     *
     * `postedById` is the actor: the person who booked the delivery in is the
     * person who put the lot into the state it starts in.
     */
    const openings = lots.map((lot) => ({
      id: context.nextId(),
      ...statusChangeColumns({
        lotId: lot.id,
        status: lot.status,
        effectiveOn: lot.receivedOn,
        lotSeq: 1,
        actorId: input.postedById,
      }),
    }));

    const changes = (input.statusChanges ?? []).map((change) => ({
      id: change.id,
      ...statusChangeColumns(change),
    }));
    const history = [...openings, ...changes];

    return lots.length === 0 && history.length === 0
      ? [childBatch('StockMovement', movements)]
      : [
          childBatch('StockLot', lots),
          childBatch('StockLotStatusChange', history),
          childBatch('StockMovement', movements),
        ];
  },

  /**
   * The lot's own status column, brought up to date with the history.
   *
   * Only for lots this posting changed the status of. A receipt mints lots
   * already carrying the status its opening entry records, so amending them
   * would be a write that changes nothing.
   */
  childPatches(input: StockPostingCreateInput): ChildPatch[] {
    return (input.statusChanges ?? []).map((change) =>
      childPatch('StockLot', change.lotId, { status: change.status })
    );
  },

  /**
   * A posting is never amended.
   *
   * It is the header of an act that already happened, and its lines cannot be
   * changed at all, so an editable header would let the two disagree about what
   * the act was. There is no PATCH route; this throw is what keeps that true for
   * a caller that reaches the repository some other way.
   */
  patchData(): never {
    throw ApiError.conflict(APPEND_ONLY);
  },

  matches(row: ScopedRow<'StockPosting'>, query: StockPostingListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    return equalsIfSet(query.facilityId, row.facilityId) && equalsIfSet(query.kind, row.kind);
  },

  where(query: StockPostingListQuery) {
    return {
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
    };
  },

  sortValue(row: ScopedRow<'StockPosting'>, sort: StockPostingListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.occurredOn.getTime();
  },

  orderBy(query: StockPostingListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ occurredOn: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'StockPosting'>): Record<string, unknown> {
    return { kind: row.kind };
  },
};

/* --------------------------------------------------------- stock movements */

/**
 * A ledger line as the repository would create one on its own.
 *
 * No route reaches this: movements exist only as children of a posting, which is
 * what makes a dispense drawn from three lots one act rather than three. The
 * create path is written honestly anyway because the spec type requires it, and
 * it goes through the same {@link movementColumns} the posting's `childRows`
 * uses, so a column added to the table cannot be built two ways.
 */
export interface StockMovementCreateInput {
  readonly postingId: string;
  readonly facilityId: string;
  readonly lotSeq: number;
  readonly movement: PackageMovement;
}

export interface StockMovementListQuery extends BaseQuery {
  itemId?: string;
  lotId?: string;
  facilityId?: string;
  postingId?: string;
  sort: 'occurredOn' | 'createdAt';
}

export const stockMovementSpec: CollectionSpec<
  'StockMovement',
  StockMovementCreateInput,
  StockLedgerPatch,
  StockMovementListQuery
> = {
  model: 'StockMovement',
  targetType: 'StockMovement',
  action: 'stock.movement',
  facilityColumn: 'facilityId',
  facilityScoped: true,
  compartment: 'closed',

  newRow(input: StockMovementCreateInput): Writable<'StockMovement'> {
    return movementColumns(assertPostable(input.movement, 0), input);
  },

  /**
   * A movement is never amended, and this is the rule the whole design rests on.
   *
   * The migration revokes UPDATE and DELETE from the application role, so
   * Postgres refuses it whatever this file says. What this throw adds is that
   * the in-memory implementation - which the entire HTTP suite runs against, and
   * which has no grants - refuses it identically, so a green test can never mean
   * something Postgres would have rejected.
   */
  patchData(): never {
    throw ApiError.conflict(APPEND_ONLY);
  },

  matches(row: ScopedRow<'StockMovement'>, query: StockMovementListQuery): boolean {
    return (
      equalsIfSet(query.itemId, row.itemId) &&
      equalsIfSet(query.lotId, row.lotId) &&
      equalsIfSet(query.facilityId, row.facilityId) &&
      equalsIfSet(query.postingId, row.postingId)
    );
  },

  where(query: StockMovementListQuery) {
    return {
      ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
      ...(query.lotId === undefined ? {} : { lotId: query.lotId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.postingId === undefined ? {} : { postingId: query.postingId }),
    };
  },

  sortValue(row: ScopedRow<'StockMovement'>, sort: StockMovementListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.occurredOn.getTime();
  },

  orderBy(query: StockMovementListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ occurredOn: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'StockMovement'>): Record<string, unknown> {
    return { kind: row.kind, lotSeq: row.lotSeq };
  },
};

/* ------------------------------------------------------------------ shared */

/**
 * A status-history row's columns, built in one place.
 *
 * Three callers: the spec's own `newRow`, the opening entry a receipt writes,
 * and the change a recall writes. A second copy is how the opening entry would
 * come to carry a different default from the change that follows it, in a table
 * whose whole purpose is that the entries can be compared with each other.
 */
function statusChangeColumns(
  input: StockLotStatusChangeCreateInput
): Writable<'StockLotStatusChange'> {
  return {
    lotId: input.lotId,
    status: input.status,
    effectiveOn: input.effectiveOn,
    lotSeq: input.lotSeq,
    reason: input.reason ?? null,
    actorId: input.actorId ?? null,
  };
}

/**
 * The lot's columns, built in one place.
 *
 * Two callers: `stockLotSpec.newRow`, and the posting's `childRows` when a
 * delivery brings a carton number the site has never seen. A second copy is how
 * a lot created by a receipt would come to carry a different default from one
 * created directly.
 */
function lotColumns(input: StockLotCreateInput): Writable<'StockLot'> {
  return {
    itemId: input.itemId,
    facilityId: input.facilityId,
    lotNumber: input.lotNumber,
    status: input.status ?? STOCK_LOT_DEFAULTS.status,
    expiresOn: input.expiresOn ?? null,
    openedOn: input.openedOn ?? null,
    beyondUseDays: input.beyondUseDays ?? null,
    manufacturer: input.manufacturer ?? null,
    ndcCode: input.ndcCode ?? null,
    receivedOn: input.receivedOn,
  };
}

/**
 * The columns a patch mentioned.
 *
 * An absent key stays absent rather than becoming null, because "not mentioned"
 * and "clear this column" are different requests and only one of them was made.
 * The assertion at the end is the price of filtering a record: the association
 * between the keys and the model is lost by `Object.entries`, and each call site
 * names its own model one line up.
 */
function mentionedColumns<M extends PrismaModelName>(
  patch: Record<string, unknown>
): Partial<Writable<M>> {
  const data: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(patch)) {
    if (value !== undefined) data[column] = value;
  }
  return data as Partial<Writable<M>>;
}

export interface StockLotStatusChangeCreateInput {
  lotId: string;
  status: StockLotStatus;
  /** The first day this status was in force, inclusive. */
  effectiveOn: Date;
  /** Order within one lot, so two changes on one day still have a sequence. */
  lotSeq: number;
  reason?: string;
  actorId?: string;
}

export interface StockLotStatusChangeListQuery extends BaseQuery {
  lotId?: string;
  lotIds?: readonly string[];
  status?: StockLotStatus;
  sort: 'effectiveOn' | 'lotSeq' | 'createdAt';
}

/**
 * One lot filter from the two ways a caller can ask for one.
 *
 * `lotId` is a single lot's history; `lotIds` is a page of lots at once. They
 * resolve through one function and intersect, because two spreads writing the
 * same `where` key is how one of them silently stops applying - the shape that
 * has gone wrong four times in this repository and is now checked for every
 * spec by `repositories.port-agreement.test.ts`.
 */
function statusChangeLots(query: StockLotStatusChangeListQuery): readonly string[] | undefined {
  const { lotId, lotIds } = query;
  if (lotIds === undefined) return lotId === undefined ? undefined : [lotId];
  if (lotId === undefined) return lotIds;
  return lotIds.includes(lotId) ? [lotId] : [];
}

/**
 * Every status a lot has held, append-only.
 *
 * `closed` for the same reason the other four are: a chart is two joins away
 * and this layer performs neither, so the fail-closed reading is the right one.
 *
 * The patch is empty and its type says so. A transition that was recorded
 * happened, and a record of it that can be edited is not a record of anything -
 * which is the whole point of the table, because a back-dated report is only
 * reproducible if the history behind it cannot be rewritten. The database
 * agrees: the migration revokes UPDATE and DELETE from the application role.
 */
export const stockLotStatusChangeSpec: CollectionSpec<
  'StockLotStatusChange',
  StockLotStatusChangeCreateInput,
  Record<string, never>,
  StockLotStatusChangeListQuery
> = {
  model: 'StockLotStatusChange',
  targetType: 'StockLotStatusChange',
  action: 'stockLotStatus',
  compartment: 'closed',

  newRow(input: StockLotStatusChangeCreateInput): Writable<'StockLotStatusChange'> {
    return statusChangeColumns(input);
  },

  patchData(): Partial<Writable<'StockLotStatusChange'>> {
    return {};
  },

  matches(row: ScopedRow<'StockLotStatusChange'>, query: StockLotStatusChangeListQuery): boolean {
    const wanted = statusChangeLots(query);
    if (wanted !== undefined && !wanted.includes(row.lotId)) return false;
    return query.status === undefined || row.status === query.status;
  },

  where(query: StockLotStatusChangeListQuery) {
    const wanted = statusChangeLots(query);
    return {
      ...(wanted === undefined ? {} : { lotId: { in: [...wanted] } }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
  },

  sortValue(
    row: ScopedRow<'StockLotStatusChange'>,
    sort: StockLotStatusChangeListQuery['sort']
  ): number {
    if (sort === 'lotSeq') return row.lotSeq;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.effectiveOn.getTime();
  },

  orderBy(query: StockLotStatusChangeListQuery) {
    const { order } = query;
    if (query.sort === 'lotSeq') return [{ lotSeq: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    // `lotSeq` breaks the tie rather than `id`: two changes on one day are
    // ordered by the sequence that made them, not by whichever uuid sorted
    // first.
    return [{ effectiveOn: order }, { lotSeq: order }];
  },
};

export const inventorySpecs = {
  stockItems: stockItemSpec,
  stockLots: stockLotSpec,
  stockPostings: stockPostingSpec,
  stockMovements: stockMovementSpec,
  stockLotStatusChanges: stockLotStatusChangeSpec,
} as const;

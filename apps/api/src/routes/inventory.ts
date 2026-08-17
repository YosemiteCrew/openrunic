import { uuidv7 } from '@openrunic/database';
import {
  addDays,
  allocate,
  balancesByLot,
  countVariance,
  expiringWithin,
  fefo,
  itemBalance,
  lastUsableDay,
  lotBalance,
  movementsFor,
  needsReorder,
  packsToUnits,
  unusableReason,
  usableBalance,
  type Allocation,
  type CountVariance,
  type IsoDate,
  type Lot,
  type StockMovement as PackageMovement,
} from '@openrunic/inventory';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import { fromIsoDate, toLot, toMovement, toStockItem, todayAt } from '../inventory/marshal.js';
import { causeText, dispensedQuantity } from '../inventory/posting.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { BaseQuery, Page } from '../repositories/collection.js';
import type {
  StockItemListQuery,
  StockLotCreateInput,
  StockLotListQuery,
  StockMovementListQuery,
  StockPostingCreateInput,
  StockPostingLine,
} from '../repositories/specs/inventory.js';
import type { ScopedRow } from '../repositories/types.js';
import {
  administrationResultSchema,
  administrationSchema,
  countResultSchema,
  countSchema,
  dispenseSchema,
  expiringDtoSchema,
  expiringQuerySchema,
  itemStockDtoSchema,
  itemStockQuerySchema,
  receiptSchema,
  reorderDtoSchema,
  reorderQuerySchema,
  stockItemCreateSchema,
  stockItemDtoSchema,
  stockItemListQuerySchema,
  stockItemPatchSchema,
  stockLotDtoSchema,
  stockLotListQuerySchema,
  stockPostingDtoSchema,
  toStockItemCreateInput,
  toStockItemDto,
  toStockItemListQuery,
  toStockItemPatchInput,
  toStockLotDto,
  toStockLotListQuery,
  toStockPostingDto,
  wastageSchema,
  type AdministrationResult,
  type CountResult,
  type StockPostingDto,
  type ReceiptBody,
} from '../schemas/inventory.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import {
  CRUD_ERRORS,
  NOT_FOUND_RESPONSE,
  UNPROCESSABLE_RESPONSE,
  defineCrud,
  type CrudModule,
} from './crud.js';
import { attributedTo, idParamSchema, policyOf, repositories, required } from './helpers.js';

/**
 * THE STOCKROOM'S SEVEN JOBS.
 *
 * Book in a delivery, dispense against a prescription, administer a dose, throw
 * away what was drawn and not used, count the shelf, find what is about to
 * expire, and find what needs ordering. Everything in this file is one of those
 * or a read one of them needs.
 *
 * ## On-hand is never stored, so every write reads first
 *
 * There is no quantity column anywhere in these four tables. A balance is summed
 * from the movements each time it is asked for, because a stored figure can be
 * set - and once it can be set it will be, by a well-meant repair of a number
 * that looked wrong, leaving no trace of what was wrong or who decided it. On a
 * controlled substance that repair is precisely what an audit exists to detect.
 *
 * The consequence is that a dispense reads the whole ledger for its item at its
 * site before it writes anything, and that snapshot is taken with **no limit**.
 * `lotBalance` applies its own `occurredOn <= asOf` filter, so a date cutoff is
 * safe; a page limit is not, because it returns a confidently wrong number with
 * no error at all - and `lotSeq` needs the unfiltered per-lot maximum from the
 * same rows.
 *
 * ## Nothing here writes a movement
 *
 * Every write below builds a `StockPosting` and hands its lines to
 * `stockPostings.create`. The spec's `childRows` is what turns those lines into
 * rows, in the posting's own transaction, after running the package's
 * `movementProblems` on each - so a dispense drawn from three lots is three
 * lines and one act, and a half-recorded act is unrepresentable rather than
 * merely unlikely.
 *
 * ## Registration order is load-bearing
 *
 * Hono matches in registration order, so `/inventory/items/:id/stock` is
 * registered before the CRUD module that owns `/inventory/items/:id`. Getting it
 * wrong is a wrong-handler 200 rather than a startup error, and `openapi.test`
 * would not catch it, because Hono still reports the shadowed route.
 */

type ItemRow = ScopedRow<'StockItem'>;
type LotRow = ScopedRow<'StockLot'>;
type MovementRow = ScopedRow<'StockMovement'>;

/** One lot line on a balance report, as the response schema declares it. */
type LotBalance = z.infer<typeof itemStockDtoSchema>['lots'][number];

const NO_ITEM = 'No such stock item.';
/**
 * The lot row a receipt line describes, when the carton is one this site has
 * not seen before.
 *
 * Extracted from the receipt handler because its five optional-field spreads
 * were most of that function's branching, and none of them is a decision the
 * handler makes - they are the shape of a `StockLot`, which belongs beside the
 * type rather than inside a loop.
 *
 * `receivedOn` falls back to the posting's own date. A delivery is received on
 * the day it is booked in unless the packing slip says otherwise, and the
 * column is not nullable because it is FEFO's tie-break and the not-yet-on-the-
 * shelf gate.
 */
function newLotFrom(
  line: ReceiptBody['lines'][number],
  id: string,
  facilityId: string,
  occurredOn: IsoDate
): StockLotCreateInput & { id: string } {
  return {
    id,
    itemId: line.itemId,
    facilityId,
    lotNumber: line.lotNumber,
    receivedOn: fromIsoDate(line.receivedOn ?? occurredOn),
    ...(line.expiresOn === undefined ? {} : { expiresOn: fromIsoDate(line.expiresOn) }),
    ...(line.beyondUseDays === undefined ? {} : { beyondUseDays: line.beyondUseDays }),
    ...(line.manufacturer === undefined ? {} : { manufacturer: line.manufacturer }),
    ...(line.ndcCode === undefined ? {} : { ndcCode: line.ndcCode }),
  };
}

const NO_PATIENT = 'No such patient.';
const NO_ENCOUNTER = 'No such encounter.';

/**
 * Resolves the chart a removal is filed against, before it is filed.
 *
 * Every id on a posting was checked except the two that decide whose record it
 * lands on. The prescription was resolved and its patient compared; the witness
 * was resolved; the patient the stock was actually removed for was taken on
 * trust. Against Postgres that is an unknown id surfacing as a bare 500 from a
 * foreign key, or - because the relation references `Patient.id` with no tenant
 * component - another organisation's patient satisfying the constraint and the
 * removal landing on a foreign chart.
 *
 * 404 rather than 403 for a chart in another tenant, matching the rest of the
 * boundary: the two answers must not be distinguishable, or the endpoint is an
 * enumeration oracle.
 */
async function resolveChart(
  c: Context<AppEnv>,
  body: { patientId?: string; encounterId?: string }
): Promise<void> {
  const repos = repositories(c);
  if (body.patientId !== undefined) {
    const patient = required(await repos.patients.findById(body.patientId), NO_PATIENT);
    if (body.encounterId !== undefined) {
      const encounter = required(await repos.encounters.findById(body.encounterId), NO_ENCOUNTER);
      // An encounter belonging to a different patient would file the removal
      // against two charts that disagree, which no later reader can resolve.
      if (encounter.patientId !== patient.id) {
        throw ApiError.malformed('The encounter does not belong to that patient.', {
          issues: [{ path: 'encounterId', message: 'belongs to another patient' }],
        });
      }
    }
    return;
  }
  if (body.encounterId !== undefined) {
    required(await repos.encounters.findById(body.encounterId), NO_ENCOUNTER);
  }
}
const NO_LOT = 'No such stock lot.';
const NO_FACILITY = 'No such facility.';

/**
 * How many rows a snapshot fetches per round trip.
 *
 * Not a cap: {@link collect} keeps going until it holds the whole result set. It
 * is the batch size, and it is deliberately smaller than a busy lot's ledger so
 * that the second iteration is a path the suite exercises rather than a path
 * production discovers.
 */
const SNAPSHOT_PAGE = 100;

/**
 * Every row a query matches, paged to exhaustion.
 *
 * The assertion re-attaches the paging fields to the caller's query. Expressing
 * "this query, plus a page" in the type would mean being generic over a query
 * minus two of its own keys, which buys nothing the two call sites do not
 * already prove.
 */
async function collect<TRow, TQuery extends BaseQuery>(
  list: (query: TQuery) => Promise<Page<TRow>>,
  query: Omit<TQuery, 'page' | 'pageSize'>
): Promise<TRow[]> {
  const rows: TRow[] = [];
  for (let page = 1; ; page += 1) {
    const result = await list({ ...query, page, pageSize: SNAPSHOT_PAGE } as TQuery);
    rows.push(...result.rows);
    if (rows.length >= result.total) return rows;
  }
}

function allLots(
  c: Context<AppEnv>,
  query: Omit<StockLotListQuery, 'page' | 'pageSize'>
): Promise<LotRow[]> {
  return collect((q: StockLotListQuery) => repositories(c).stockLots.list(q), query);
}

function allMovements(
  c: Context<AppEnv>,
  query: Omit<StockMovementListQuery, 'page' | 'pageSize'>
): Promise<MovementRow[]> {
  return collect((q: StockMovementListQuery) => repositories(c).stockMovements.list(q), query);
}

/** One lot's whole ledger at one site, oldest first. */
function ledgerOfLot(
  c: Context<AppEnv>,
  lotId: string,
  facilityId: string
): Promise<MovementRow[]> {
  return allMovements(c, { lotId, facilityId, sort: 'occurredOn', order: 'asc' });
}

/**
 * Refuses a patient-scoped token before it touches the stockroom.
 *
 * All four inventory specs declare `compartment: 'closed'`, which narrows every
 * read - but neither storage implementation consults it on `create`, so the only
 * thing standing between a patient-scoped token and a stock write would
 * otherwise be that no role bundle grants one an inventory permission. That is a
 * true statement about today's bundles rather than a guarantee, since a tenant
 * may fork a role. This is the guarantee.
 */
function assertNotCompartmentScoped(c: Context<AppEnv>): void {
  if (c.get('principal')?.compartmentPatientId !== undefined) {
    throw ApiError.forbidden('A patient-scoped token cannot post to the stock ledger.');
  }
}

/** Both refusals every write owes, before it reads or writes anything. */
function beginWrite(c: Context<AppEnv>, facilityId: string): void {
  assertNotCompartmentScoped(c);
  assertFacilityAccess(policyOf(c), facilityId);
}

/**
 * The day a computed read is taken as of.
 *
 * The facility is loaded even when the caller named a date, so an unknown site
 * is a 404 rather than an empty report that reads as "nothing is expiring".
 * Today comes from the facility's own timezone, because a clinic in Los Angeles
 * at five in the afternoon is already tomorrow in UTC, and a beyond-use window
 * judged against the UTC day retires a vial a day early.
 */
async function resolveAsOf(
  c: Context<AppEnv>,
  facilityId: string,
  supplied: string | undefined
): Promise<IsoDate> {
  const facility = required(await repositories(c).facilities.findById(facilityId), NO_FACILITY);
  return supplied ?? todayAt(facility.timezone, new Date());
}

/**
 * Hands out the next `lotSeq` for a lot, continuing its existing ledger.
 *
 * The sequence is the ledger's order and its concurrency guard at once. It is
 * derived from the same snapshot the allocation was, so writing it asserts that
 * nothing has touched the lot since that snapshot was taken: in Postgres a
 * second writer that got there first takes the unique index and this one gets a
 * conflict. The in-memory store has no index, which is why no test in this
 * repository claims the guard works - only Postgres can be asked that.
 */
function seqTracker(movements: readonly MovementRow[]): (lotId: string) => number {
  const highest = new Map<string, number>();
  for (const movement of movements) {
    highest.set(movement.lotId, Math.max(highest.get(movement.lotId) ?? 0, movement.lotSeq));
  }
  return (lotId: string): number => {
    const next = (highest.get(lotId) ?? 0) + 1;
    highest.set(lotId, next);
    return next;
  };
}

/** Pairs each movement with its place in its lot's ledger. */
function linesFor(
  movements: readonly PackageMovement[],
  nextSeq: (lotId: string) => number
): StockPostingLine[] {
  return movements.map((movement) => ({ movement, lotSeq: nextSeq(movement.lotId) }));
}

/**
 * Writes the posting, reads back what landed, and records that stock moved.
 *
 * The lines are re-read rather than echoed from what was sent, so the response
 * describes the rows that exist rather than the rows that were intended. The
 * hand-written audit event is not redundant with the repositories' own: theirs
 * say which rows were touched, and this one says that stock left the building,
 * naming every movement. It matters because `phi.read` batching caps at 500
 * targets with a counter for the rest, and a from-inception ledger sum passes
 * that on a busy item - silently truncating exactly the record a diversion
 * investigation reads.
 */
async function writeAct(
  c: Context<AppEnv>,
  input: StockPostingCreateInput
): Promise<StockPostingDto> {
  const { stockPostings, stockMovements } = repositories(c);
  const posting = await stockPostings.create(input);
  const lines = await collect((q: StockMovementListQuery) => stockMovements.list(q), {
    postingId: posting.id,
    sort: 'occurredOn' as const,
    order: 'asc' as const,
  });

  await c.get('audit')?.write({
    action: 'stock.posted',
    targetType: 'StockPosting',
    targetId: posting.id,
    facilityId: posting.facilityId,
    ...(posting.patientId === null ? {} : { patientId: posting.patientId }),
    metadata: {
      kind: posting.kind,
      movements: lines.map((line) => ({
        id: line.id,
        lotId: line.lotId,
        kind: line.kind,
        quantity: line.quantity,
      })),
    },
  });

  return toStockPostingDto(posting, lines);
}

/** Records that somebody asked what the shelf holds, which the row reads do not say. */
async function recordBalanceRead(
  c: Context<AppEnv>,
  target: { targetType: string; targetId: string; facilityId: string; asOf: IsoDate }
): Promise<void> {
  await c.get('audit')?.write({
    action: 'stock.balance.read',
    targetType: target.targetType,
    targetId: target.targetId,
    facilityId: target.facilityId,
    metadata: { asOf: target.asOf },
  });
}

/** One lot on a balance report. */
function lotBalanceDto(lot: Lot, onHand: number, asOf: IsoDate): LotBalance {
  return {
    lotId: lot.id,
    lotNumber: lot.lotNumber,
    status: lot.status,
    expiresOn: lot.expiresOn ?? null,
    openedOn: lot.openedOn ?? null,
    receivedOn: lot.receivedOn,
    onHand,
    lastUsableDay: lastUsableDay(lot, asOf) ?? null,
    unusableReason: unusableReason(lot, asOf) ?? null,
  };
}

/**
 * The stock units a delivery line brings in.
 *
 * The only call to `packsToUnits` in this repository, and it happens once, at
 * receipt, where somebody is holding the carton. The package's own comment says
 * why that matters: it validates nothing, and applying it twice silently squares
 * the conversion. An item with no pack size is bought in the unit it is counted
 * in, so a delivery in packs against one is a request nobody can convert - and a
 * 422 naming the line is a better answer than quietly treating four boxes as
 * four tablets.
 */
function packsInUnits(item: ItemRow, packs: number, line: number): number {
  if (item.packSize === null) {
    throw ApiError.validation('A delivery in packs needs the item to have a pack size.', [
      {
        path: `lines.${String(line)}.packs`,
        message: `${item.sku} has no packSize; send the quantity in ${item.unit} instead`,
      },
    ]);
  }
  return packsToUnits(toStockItem(item), packs);
}

/**
 * Turns an allocation into the lines a posting will write, or refuses it.
 *
 * A shortfall writes nothing at all and answers 409, rather than posting a
 * partial fill. The package models a partial fill as a legitimate outcome, and
 * it is - at a counter, with somebody there to be told they are owed ten more.
 * Through an API it is a silent short delivery, so the caller is handed the
 * numbers and decides.
 *
 * `blockedByIndivisibility` gets its own sentence because it is the state that
 * makes people stop trusting the system: the screen says there is no stock, the
 * fridge visibly has some, and both are true.
 */
function allocatedLines(
  allocation: Allocation,
  detail: { kind: 'DISPENSE' | 'ADMINISTER'; occurredOn: IsoDate; actorId: string }
): readonly PackageMovement[] {
  if (allocation.shortfall > 0) {
    throw ApiError.conflict(
      allocation.blockedByIndivisibility === true
        ? `There is enough stock in total, but no single lot holds ${String(allocation.requested)} and the request was marked indivisible.`
        : `Only ${String(allocation.allocated)} of ${String(allocation.requested)} could be allocated from the lots on the shelf.`
    );
  }

  // Checked after the shortfall, not before it. A request blocked by
  // indivisibility also allocates nothing, and answering 422 there would have
  // replaced the one message that tells somebody standing in front of a full
  // fridge why the system says there is none.
  //
  // Nothing allocated is not a completed dispense. A request that rounds to
  // zero on the stock grid took the `requested <= 0` early return in
  // `allocate`, which reports no shortfall - so this passed, wrote a posting
  // with no movement lines, and answered 201. A DISPENSE stamped on a patient
  // chart that moved nothing off the shelf is worse than a refusal, because it
  // reads to everyone downstream as a fill that happened.
  //
  // The quantity schema now refuses a sub-grid figure before it reaches here,
  // so this is the second door rather than the first. It is kept because the
  // course path multiplies three fields, and a product can be small in ways
  // none of its factors were.
  if (allocation.allocated <= 0) {
    throw ApiError.validation('The dispensed quantity rounds to nothing on the stock grid.', [
      { path: 'quantity', message: 'must be at least one six-decimal stock unit' },
    ]);
  }

  return movementsFor(
    {
      ...allocation,
      // The trailing zero-quantity line is dropped here. Lots of 0.7, 0.1, 0.2
      // and 5 against a request of 1 come back as four lines with the last of
      // them empty, and `movementProblems` refuses a zero movement - so a
      // legitimate, completely filled allocation would be turned away at the
      // write door.
      lines: allocation.lines.filter((line) => line.quantity > 0),
    },
    {
      kind: detail.kind,
      occurredOn: detail.occurredOn,
      actorId: detail.actorId,
      // Injective, never a constant: two rows sharing an id make the next
      // balance read throw "supplied twice with different contents", on a table
      // nobody can delete from.
      idFor: () => uuidv7(),
    }
  );
}

/** The lots and the ledger for a site, or for one item at a site, whole. */
async function snapshot(
  c: Context<AppEnv>,
  where: { facilityId: string; itemId?: string }
): Promise<{
  lots: Lot[];
  movements: PackageMovement[];
  movementRows: MovementRow[];
}> {
  const lotRows = await allLots(c, { ...where, sort: 'receivedOn', order: 'asc' });
  const movementRows = await allMovements(c, { ...where, sort: 'occurredOn', order: 'asc' });
  return { lots: lotRows.map(toLot), movements: movementRows.map(toMovement), movementRows };
}

/** The variance a line found, or nothing when the shelf and the ledger agree. */
function varianceFor(counted: number, expected: number, line: number): CountVariance | undefined {
  try {
    return countVariance(counted, expected);
  } catch (error) {
    // `countVariance` refuses a figure it cannot carry at six decimal places
    // rather than returning one, and the generic boundary would render that as a
    // bare 500. The fault is in the count somebody typed, so it is reported as
    // one, against the line it was typed on.
    throw ApiError.validation('That count cannot be compared with the ledger.', [
      { path: `lines.${String(line)}.counted`, message: causeText(error) },
    ]);
  }
}

/* -------------------------------------------------------------- the module */

export function inventoryRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /* ------------------------------------------------------------- the reads */

  router.get('/inventory/items/:id/stock', requirePermission('inventory.read'), async (c) => {
    const itemId = parseParam(c.req.param('id'), idParamSchema, 'id');
    const query = parseQuery(c, itemStockQuerySchema);
    assertFacilityAccess(policyOf(c), query.facilityId);

    const item = required(await repositories(c).stockItems.findById(itemId), NO_ITEM);
    const asOf = await resolveAsOf(c, query.facilityId, query.asOf);
    const { lots, movements } = await snapshot(c, { facilityId: query.facilityId, itemId });

    const balances = balancesByLot(movements, itemId, asOf);
    const drawable = fefo(lots, asOf);
    const drawableIds = new Set(drawable.map((lot) => lot.id));
    const balanceOf = (lot: Lot): number => balances.get(lot.id) ?? 0;

    await recordBalanceRead(c, {
      targetType: 'StockItem',
      targetId: itemId,
      facilityId: query.facilityId,
      asOf,
    });

    return c.json({
      itemId,
      facilityId: query.facilityId,
      asOf,
      onHand: itemBalance(movements, itemId, asOf),
      usable: usableBalance(lots, movements, itemId, asOf),
      needsReorder: needsReorder(toStockItem(item), lots, movements, asOf),
      lots: drawable.map((lot) => lotBalanceDto(lot, balanceOf(lot), asOf)),
      // Everything `fefo` held back. Most carry a reason; a lot that has simply
      // not arrived yet carries none, because there is nothing wrong with it.
      unusable: lots
        .filter((lot) => !drawableIds.has(lot.id))
        .map((lot) => lotBalanceDto(lot, balanceOf(lot), asOf)),
    } satisfies z.infer<typeof itemStockDtoSchema>);
  });

  router.get('/inventory/lots', requirePermission('inventory.read'), async (c) => {
    const query = parseQuery(c, stockLotListQuerySchema);
    assertFacilityAccess(policyOf(c), query.facilityId);

    const page = await repositories(c).stockLots.list(
      toStockLotListQuery(
        query,
        query.expiringBefore === undefined ? undefined : fromIsoDate(query.expiringBefore)
      )
    );
    return c.json(toListResponse(page, toStockLotDto));
  });

  /**
   * What is about to go off and is still worth doing something about.
   *
   * Zero-balance lots are dropped: an empty lot that expires next week is not
   * work, and a tray full of them is how a report stops being read.
   * Already-expired lots are excluded by the package, because they are waste to
   * dispose of rather than stock to use up, and mixing the two puts two
   * different jobs under one heading.
   */
  router.get('/inventory/expiring', requirePermission('inventory.read'), async (c) => {
    const query = parseQuery(c, expiringQuerySchema);
    assertFacilityAccess(policyOf(c), query.facilityId);

    const asOf = await resolveAsOf(c, query.facilityId, query.asOf);
    const { lots, movements } = await snapshot(c, {
      facilityId: query.facilityId,
      ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
    });

    const data = expiringWithin(lots, asOf, query.days)
      .map((lot) => ({
        ...lotBalanceDto(lot, lotBalance(movements, lot.id, asOf), asOf),
        itemId: lot.itemId,
      }))
      .filter((entry) => entry.onHand > 0);

    await recordBalanceRead(c, {
      targetType: 'Facility',
      targetId: query.facilityId,
      facilityId: query.facilityId,
      asOf,
    });

    return c.json({
      asOf,
      through: addDays(asOf, query.days),
      data,
    } satisfies z.infer<typeof expiringDtoSchema>);
  });

  /**
   * What to order, judged against usable stock rather than physical stock.
   *
   * An item with a reorder level of fifty and a hundred units sitting in an
   * expired lot can supply nobody, and a decision made on the physical figure
   * suppresses the replenishment precisely when the shelf is empty in every
   * sense that matters. Both figures are published, because the gap between them
   * is itself the finding.
   */
  router.get('/inventory/reorder', requirePermission('inventory.read'), async (c) => {
    const query = parseQuery(c, reorderQuerySchema);
    assertFacilityAccess(policyOf(c), query.facilityId);

    const asOf = await resolveAsOf(c, query.facilityId, query.asOf);
    const { lots, movements } = await snapshot(c, { facilityId: query.facilityId });
    const items = await collect((q: StockItemListQuery) => repositories(c).stockItems.list(q), {
      active: true,
      sort: 'name' as const,
      order: 'asc' as const,
    });

    const data = items
      // Narrowed by predicate rather than by a later `?? 0`, so "never flag this
      // item" cannot quietly become "flag it at zero" - which is the same
      // null-versus-absent trap the marshalling layer exists to close.
      .filter((item): item is ItemRow & { reorderLevel: number } => item.reorderLevel !== null)
      .map((item) => ({
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        reorderLevel: item.reorderLevel,
        onHand: itemBalance(movements, item.id, asOf),
        usable: usableBalance(lots, movements, item.id, asOf),
      }))
      .filter((entry) => entry.usable <= entry.reorderLevel);

    await recordBalanceRead(c, {
      targetType: 'Facility',
      targetId: query.facilityId,
      facilityId: query.facilityId,
      asOf,
    });

    return c.json({ asOf, data } satisfies z.infer<typeof reorderDtoSchema>);
  });

  /* ------------------------------------------------------------ the writes */

  /**
   * A delivery arrives.
   *
   * The same carton number arriving twice is a second delivery into the same
   * box, never a second box, so a line whose lot number this site already knows
   * posts a RECEIPT against the existing lot instead of creating a duplicate.
   * When the lot is new, the lot row and its first movement are written in one
   * transaction by the posting's `childRows`: a lot created by one request and
   * stocked by another is a carton that exists and holds nothing.
   */
  router.post('/inventory/receipts', requirePermission('inventory.write'), async (c) => {
    const body = await parseJsonBody(c, receiptSchema);
    beginWrite(c, body.facilityId);
    const actorId = attributedTo(c);
    const repos = repositories(c);

    const newLots: (StockLotCreateInput & { id: string })[] = [];
    const lines: StockPostingLine[] = [];
    // One tracker per item, built from that item's whole ledger at this site, so
    // two lines of one delivery into the same lot take consecutive sequences
    // rather than colliding on one.
    const trackers = new Map<string, (lotId: string) => number>();

    for (const [index, line] of body.lines.entries()) {
      const item = required(await repos.stockItems.findById(line.itemId), NO_ITEM);
      const quantity = 'packs' in line ? packsInUnits(item, line.packs, index) : line.quantity;

      let nextSeq = trackers.get(line.itemId);
      if (nextSeq === undefined) {
        nextSeq = seqTracker(
          await allMovements(c, {
            itemId: line.itemId,
            facilityId: body.facilityId,
            sort: 'occurredOn',
            order: 'asc',
          })
        );
        trackers.set(line.itemId, nextSeq);
      }

      const known = await repos.stockLots.list({
        page: 1,
        pageSize: 1,
        sort: 'createdAt',
        order: 'asc',
        facilityId: body.facilityId,
        itemId: line.itemId,
        lotNumber: line.lotNumber,
      });
      // Also against the lots this same delivery has already minted, so two
      // lines naming one new carton land in one lot rather than in two rows
      // that would then violate the unique key.
      const minted = newLots.find(
        (lot) => lot.itemId === line.itemId && lot.lotNumber === line.lotNumber
      );
      let lotId = known.rows[0]?.id ?? minted?.id;

      if (lotId === undefined) {
        lotId = uuidv7();
        newLots.push(newLotFrom(line, lotId, body.facilityId, body.occurredOn));
      }

      lines.push({
        movement: {
          id: uuidv7(),
          lotId,
          itemId: line.itemId,
          kind: 'RECEIPT',
          quantity,
          occurredOn: body.occurredOn,
          actorId,
        },
        lotSeq: nextSeq(lotId),
      });
    }

    return c.json(
      await writeAct(c, {
        kind: 'RECEIPT',
        facilityId: body.facilityId,
        occurredOn: fromIsoDate(body.occurredOn),
        postedById: actorId,
        ...(body.reference === undefined ? {} : { reference: body.reference }),
        ...(body.note === undefined ? {} : { note: body.note }),
        newLots,
        lines,
      }),
      201
    );
  });

  /**
   * A fill against a prescription.
   *
   * The prescription is checked to belong to the patient named, because the two
   * arrive as separate ids and a mismatch would file a controlled removal
   * against the wrong chart. One in another organisation reads as absent, so it
   * is a 404 and never a 403: a 403 would confirm the id exists and turn this
   * route into a cross-tenant enumeration oracle.
   */
  router.post('/inventory/dispenses', requirePermission('inventory.write'), async (c) => {
    const body = await parseJsonBody(c, dispenseSchema);
    beginWrite(c, body.facilityId);
    const actorId = attributedTo(c);

    await resolveChart(c, body);
    if (body.prescriptionId !== undefined) {
      const prescription = required(
        await repositories(c).prescriptions.findById(body.prescriptionId),
        'No such prescription.'
      );
      if (prescription.patientId !== body.patientId) {
        throw ApiError.validation('That prescription belongs to a different patient.', [
          { path: 'prescriptionId', message: 'the prescription names another patient' },
        ]);
      }
    }

    const { lots, movements, movementRows } = await snapshot(c, {
      facilityId: body.facilityId,
      itemId: body.itemId,
    });
    const allocation = allocate(
      lots,
      movements,
      body.itemId,
      'course' in body
        ? dispensedQuantity({ course: body.course })
        : dispensedQuantity({ quantity: body.quantity }),
      body.occurredOn,
      { divisible: body.divisible }
    );

    return c.json(
      await writeAct(c, {
        kind: 'DISPENSE',
        facilityId: body.facilityId,
        occurredOn: fromIsoDate(body.occurredOn),
        postedById: actorId,
        patientId: body.patientId,
        ...(body.prescriptionId === undefined ? {} : { prescriptionId: body.prescriptionId }),
        ...(body.encounterId === undefined ? {} : { encounterId: body.encounterId }),
        ...(body.note === undefined ? {} : { note: body.note }),
        lines: linesFor(
          allocatedLines(allocation, {
            kind: 'DISPENSE',
            occurredOn: body.occurredOn,
            actorId,
          }),
          seqTracker(movementRows)
        ),
      }),
      201
    );
  });

  /**
   * A dose given here and now.
   *
   * It does not create the `Immunization` row: that aggregate owns it, and
   * writing two aggregates in one request is how half of each comes to be
   * written. What it answers with is the lots drawn from, precisely because
   * `Immunization.lotNumber` and `expirationDate` are free strings a nurse would
   * otherwise retype off the carton.
   */
  router.post('/inventory/administrations', requirePermission('inventory.write'), async (c) => {
    const body = await parseJsonBody(c, administrationSchema);
    beginWrite(c, body.facilityId);
    const actorId = attributedTo(c);
    await resolveChart(c, body);

    const { lots, movements, movementRows } = await snapshot(c, {
      facilityId: body.facilityId,
      itemId: body.itemId,
    });
    const allocation = allocate(
      lots,
      movements,
      body.itemId,
      'course' in body
        ? dispensedQuantity({ course: body.course })
        : dispensedQuantity({ quantity: body.quantity }),
      body.occurredOn,
      { divisible: body.divisible }
    );
    const drawn = allocatedLines(allocation, {
      kind: 'ADMINISTER',
      occurredOn: body.occurredOn,
      actorId,
    });

    const posting = await writeAct(c, {
      kind: 'ADMINISTRATION',
      facilityId: body.facilityId,
      occurredOn: fromIsoDate(body.occurredOn),
      postedById: actorId,
      patientId: body.patientId,
      ...(body.encounterId === undefined ? {} : { encounterId: body.encounterId }),
      ...(body.immunizationId === undefined ? {} : { immunizationId: body.immunizationId }),
      ...(body.note === undefined ? {} : { note: body.note }),
      lines: linesFor(drawn, seqTracker(movementRows)),
    });

    // The carton, not only its id. `Immunization.lotNumber` and `expirationDate`
    // are free strings, so the alternative is a nurse retyping the number off the
    // box - and a retyped lot number is the one a recall notice fails to match.
    // Walked from the snapshot rather than from the movements, so the carton
    // details come from the lot row that was read and never from a lookup that
    // could come back empty.
    const drawnFrom = new Map(drawn.map((movement) => [movement.lotId, movement.quantity]));

    return c.json(
      {
        posting,
        lots: lots.flatMap((lot) => {
          const quantity = drawnFrom.get(lot.id);
          return quantity === undefined
            ? []
            : [
                {
                  lotId: lot.id,
                  lotNumber: lot.lotNumber,
                  expiresOn: lot.expiresOn ?? null,
                  quantity,
                },
              ];
        }),
      } satisfies AdministrationResult,
      201
    );
  });

  /**
   * The remainder of a drawn vial goes in the bin.
   *
   * Named against a lot rather than an item, and with no allocation, because you
   * discard what you drew from: letting the system choose a lot would file the
   * waste against a sealed box and leave the opened one reading as full.
   *
   * Destroying a controlled substance takes a witness. It is required here
   * rather than only in a policy document, and the witness has to resolve to
   * somebody in this organisation - a witness id naming nobody is worse than a
   * blank field, because it looks like a second person was there.
   */
  router.post('/inventory/wastages', requirePermission('inventory.write'), async (c) => {
    const body = await parseJsonBody(c, wastageSchema);
    beginWrite(c, body.facilityId);
    const actorId = attributedTo(c);
    const repos = repositories(c);
    await resolveChart(c, body);

    const lot = required(await repos.stockLots.findById(body.lotId), NO_LOT);
    // A lot at another site is not a lot this request may waste from, and it is
    // reported as absent rather than as forbidden for the same reason a
    // cross-tenant row is.
    if (lot.facilityId !== body.facilityId) throw ApiError.notFound(NO_LOT);
    const item = required(await repos.stockItems.findById(lot.itemId), NO_ITEM);

    if (item.controlled && body.witnessedById === undefined) {
      throw ApiError.validation('Destroying a controlled substance needs a witness.', [
        { path: 'witnessedById', message: `${item.sku} is a controlled substance` },
      ]);
    }
    if (body.witnessedById !== undefined) {
      required(await repos.users.findById(body.witnessedById), 'No such witness.');
    }

    const movementRows = await ledgerOfLot(c, body.lotId, body.facilityId);
    const onHand = lotBalance(movementRows.map(toMovement), body.lotId, body.occurredOn);
    if (body.quantity > onHand) {
      throw ApiError.conflict(
        `Lot ${lot.lotNumber} held ${String(onHand)} on ${body.occurredOn}, so ${String(body.quantity)} cannot be wasted from it.`
      );
    }

    return c.json(
      await writeAct(c, {
        kind: 'WASTAGE',
        facilityId: body.facilityId,
        occurredOn: fromIsoDate(body.occurredOn),
        postedById: actorId,
        ...(body.patientId === undefined ? {} : { patientId: body.patientId }),
        ...(body.witnessedById === undefined ? {} : { witnessedById: body.witnessedById }),
        ...(body.note === undefined ? {} : { note: body.note }),
        lines: linesFor(
          [
            {
              id: uuidv7(),
              lotId: body.lotId,
              itemId: lot.itemId,
              kind: 'WASTE',
              quantity: body.quantity,
              occurredOn: body.occurredOn,
              actorId,
              reason: body.reason,
            },
          ],
          seqTracker(movementRows)
        ),
      }),
      201
    );
  });

  /**
   * The shelf is counted and the ledger is told what it found.
   *
   * `inventory.adjust` rather than `inventory.write`, because the control that
   * makes a stock ledger defensible is that the person who dispenses is not the
   * person who reconciles the difference away.
   *
   * A line that agrees writes no movement and is still reported: proving the
   * shelf was right is most of what a count is for, and a response carrying only
   * the problems makes a clean count look like nothing happened. A count with no
   * variances at all still writes its posting, so "we counted, and it was right"
   * is a fact in the record rather than an absence.
   */
  router.post('/inventory/counts', requirePermission('inventory.adjust'), async (c) => {
    const body = await parseJsonBody(c, countSchema);
    beginWrite(c, body.facilityId);
    const actorId = attributedTo(c);
    const repos = repositories(c);

    const movements: PackageMovement[] = [];
    const agreed: CountResult['agreed'] = [];
    const variances: CountResult['variances'] = [];
    const ledger: MovementRow[] = [];

    const countedLots = new Set<string>();
    for (const [index, line] of body.lines.entries()) {
      const lot = required(await repos.stockLots.findById(line.lotId), NO_LOT);
      if (lot.facilityId !== body.facilityId) throw ApiError.notFound(NO_LOT);

      // Asserted here as well as refused by the schema, because this loop's
      // correctness depends on it and nothing in the loop says so. Each
      // iteration reads the lot's ledger before any of this posting's lines are
      // written, so a lot named twice would have its variance computed against
      // a baseline that does not include the first line - applying the same
      // discrepancy twice, to an append-only ledger, against an audit trail
      // showing two shortfalls that never happened.
      //
      // The schema is where a client is told, in a 422 naming the field. This
      // is where the invariant is stated at the code that relies on it, so a
      // later relaxation of the schema cannot silently re-open it.
      if (countedLots.has(line.lotId)) {
        throw ApiError.malformed('A count may name each lot once.', {
          issues: [{ path: `lines.${String(index)}.lotId`, message: 'already counted above' }],
        });
      }
      countedLots.add(line.lotId);

      const lotLedger = await ledgerOfLot(c, line.lotId, body.facilityId);
      ledger.push(...lotLedger);
      const expected = lotBalance(lotLedger.map(toMovement), line.lotId, body.occurredOn);
      const variance = varianceFor(line.counted, expected, index);

      if (variance === undefined) {
        agreed.push({ lotId: line.lotId, counted: line.counted, expected });
        continue;
      }

      variances.push({
        lotId: line.lotId,
        counted: line.counted,
        expected,
        kind: variance.kind,
        quantity: variance.quantity,
      });
      movements.push({
        id: uuidv7(),
        lotId: line.lotId,
        itemId: lot.itemId,
        kind: variance.kind,
        quantity: variance.quantity,
        occurredOn: body.occurredOn,
        actorId,
        // `countVariance` returns a variance rather than a movement: the reason,
        // the actor and the dates are the persistence layer's to attach. Both
        // figures go into the reason so the row says what was found rather than
        // only what changed.
        reason: `${body.reason} (counted ${String(line.counted)}, expected ${String(expected)})`,
      });
    }

    const posting = await writeAct(c, {
      kind: 'COUNT',
      facilityId: body.facilityId,
      occurredOn: fromIsoDate(body.occurredOn),
      postedById: actorId,
      ...(body.reference === undefined ? {} : { reference: body.reference }),
      ...(body.note === undefined ? {} : { note: body.note }),
      lines: linesFor(movements, seqTracker(ledger)),
    });

    return c.json({ posting, variances, agreed } satisfies CountResult, 201);
  });

  // Last, and deliberately: `/inventory/items/:id` would otherwise swallow
  // `/inventory/items/:id/stock`, and the failure would be a wrong-handler 200.
  for (const module of crudModules()) {
    router.route('/', module.routes);
  }

  return router;
}

function crudModules(): CrudModule[] {
  return [
    defineCrud({
      segment: 'inventory/items',
      singular: 'stock item',
      plural: 'stock items',
      tag: 'inventory',
      operation: 'StockItem',
      readPermission: 'inventory.read',
      writePermission: 'inventory.write',
      collection: (repos) => repos.stockItems,
      listQuerySchema: stockItemListQuerySchema,
      toQuery: toStockItemListQuery,
      listDescription:
        'The catalogue screen is `active=true`; `q` matches the sku and the name, folded. Neither `sku` nor `unit` can be amended: the sku is what the practice orders against, and the unit is what every quantity already in the ledger means.',
      createSchema: stockItemCreateSchema,
      toCreate: toStockItemCreateInput,
      patchSchema: stockItemPatchSchema,
      toPatch: toStockItemPatchInput,
      dtoSchema: stockItemDtoSchema,
      toDto: toStockItemDto,
      writeResponses: [{ status: 409, description: 'That sku belongs to another stock item.' }],
    }),
  ];
}

/* ---------------------------------------------------------- the contracts */

const WRITE_ERRORS = [...CRUD_ERRORS, NOT_FOUND_RESPONSE, UNPROCESSABLE_RESPONSE] as const;

const POSTING_RESPONSE = {
  status: 201,
  description: 'The posting, with every ledger line it wrote.',
  schema: stockPostingDtoSchema,
} as const;

const NOTHING_WRITTEN = {
  status: 409,
  description: 'The shelf cannot supply that, and nothing was written.',
  schema: problemDocumentSchema,
} as const;

export function inventoryRouteContracts(): RouteContract[] {
  return [
    ...crudModules().flatMap((module) => [...module.contracts]),
    {
      method: 'get',
      path: '/bff/v0/inventory/items/{id}/stock',
      operationId: 'readStockItemBalance',
      summary: 'What is on the shelf for one item at one site.',
      description:
        'Publishes `onHand` and `usable` separately, because they answer different questions: `onHand` is what is physically present, expired and quarantined stock included, and `usable` is what an allocation would actually hand out. `needsReorder` judges against the second, deliberately - an item with a hundred units in an expired lot can supply nobody.',
      tags: ['inventory'],
      permission: 'inventory.read',
      pathParams: [{ name: 'id', description: 'Stock item id (UUIDv7).', schema: idParamSchema }],
      query: itemStockQuerySchema,
      responses: [
        {
          status: 200,
          description: 'The balance, and the lots behind it.',
          schema: itemStockDtoSchema,
        },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/inventory/lots',
      operationId: 'listStockLots',
      summary: 'List the cartons at one site.',
      description:
        '`facilityId` is required rather than optional. A spec’s facility column is an audit stamp and narrows nothing, so naming the site is what lets this route ask `assertFacilityAccess` - and without it a principal holding no grant could list another site’s lots by guessing its id.',
      tags: ['inventory'],
      permission: 'inventory.read',
      query: stockLotListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'One page of lots.',
          schema: listResponseSchema(stockLotDtoSchema),
        },
        ...CRUD_ERRORS,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/inventory/expiring',
      operationId: 'listExpiringStock',
      summary: 'Lots about to go off that still hold something.',
      description:
        'Already-expired lots are excluded rather than listed first: they are waste to dispose of, not stock to use up, and mixing the two puts two different jobs under one heading. Lots at zero are dropped for the same reason - an empty lot expiring next week is not work.',
      tags: ['inventory'],
      permission: 'inventory.read',
      query: expiringQuerySchema,
      responses: [
        { status: 200, description: 'The tray, soonest first.', schema: expiringDtoSchema },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/inventory/reorder',
      operationId: 'listReorderStock',
      summary: 'Items whose usable stock has fallen to their reorder level.',
      description:
        'Inclusive: the reorder level is the quantity at which somebody should already be ordering, not the last one before it. Both `onHand` and `usable` are returned, because the gap between them is itself the finding.',
      tags: ['inventory'],
      permission: 'inventory.read',
      query: reorderQuerySchema,
      responses: [
        { status: 200, description: 'What to order.', schema: reorderDtoSchema },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/inventory/receipts',
      operationId: 'receiveStock',
      summary: 'Book in a delivery.',
      description:
        'A line gives exactly one of `packs` and `quantity`; `packs` is converted once, here, and an item with no pack size refuses it rather than treating four boxes as four tablets. A lot number this site already knows posts against the existing lot instead of creating a second one, because the same carton number arriving twice is a second delivery into the same box.',
      tags: ['inventory'],
      permission: 'inventory.write',
      body: receiptSchema,
      responses: [POSTING_RESPONSE, ...WRITE_ERRORS],
    },
    {
      method: 'post',
      path: '/bff/v0/inventory/dispenses',
      operationId: 'dispenseStock',
      summary: 'Dispense against a prescription.',
      description:
        'Give `course` or `quantity`, never both: "one tablet twice daily for ten days" removes twenty, and deducting the dose instead is the quiet, cumulative error this aggregate is shaped around. `divisible` has no default, because millilitres are divisible when filling a bottle and indivisible within one injection. A shortfall writes nothing and answers 409.',
      tags: ['inventory'],
      permission: 'inventory.write',
      body: dispenseSchema,
      responses: [POSTING_RESPONSE, ...WRITE_ERRORS, NOTHING_WRITTEN],
    },
    {
      method: 'post',
      path: '/bff/v0/inventory/administrations',
      operationId: 'administerStock',
      summary: 'Record a dose given from stock.',
      description:
        'Does not create the `Immunization` record: that aggregate owns it, and writing two aggregates in one request is how half of each ends up written. It answers with the lots drawn from, because `Immunization.lotNumber` and `expirationDate` are free strings a nurse would otherwise retype off the carton.',
      tags: ['inventory'],
      permission: 'inventory.write',
      body: administrationSchema,
      responses: [
        {
          status: 201,
          description: 'The posting, and the cartons the dose came out of.',
          schema: administrationResultSchema,
        },
        ...WRITE_ERRORS,
        NOTHING_WRITTEN,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/inventory/wastages',
      operationId: 'wasteStock',
      summary: 'Discard what was drawn and not used.',
      description:
        'Names a lot rather than an item and does no allocation: you discard the vial you drew from, and letting the system choose one would file the waste against a sealed box. `reason` is required by the package for a WASTE and is named here so the client hears it first. A controlled substance needs a witness who resolves to somebody in this organisation.',
      tags: ['inventory'],
      permission: 'inventory.write',
      body: wastageSchema,
      responses: [
        POSTING_RESPONSE,
        ...WRITE_ERRORS,
        {
          status: 409,
          description: 'The lot did not hold that much on the day named.',
          schema: problemDocumentSchema,
        },
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/inventory/counts',
      operationId: 'countStock',
      summary: 'Reconcile a physical count against the ledger.',
      description:
        '`inventory.adjust`, not `inventory.write`: what makes a stock ledger defensible is that the person who dispenses is not the person who reconciles the difference away. A line that agrees writes no movement and is still reported, because proving the shelf was right is most of what a count is for.',
      tags: ['inventory'],
      permission: 'inventory.adjust',
      body: countSchema,
      responses: [
        {
          status: 201,
          description: 'The posting, the variances it wrote, and the lines that agreed.',
          schema: countResultSchema,
        },
        ...WRITE_ERRORS,
      ],
    },
  ];
}

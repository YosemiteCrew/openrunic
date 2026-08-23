import type {
  IsoDate,
  Lot,
  StockItem as PackageStockItem,
  StockMovement as PackageMovement,
} from '@openrunic/inventory';

import type { Writable } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';

/**
 * THE ONE PLACE A STORED ROW BECOMES SOMETHING `@openrunic/inventory` WILL
 * ACCEPT, AND BACK.
 *
 * The package works in ISO date strings and plain numbers, with absent facts
 * spelled `undefined`. Postgres works in `Date`, `Decimal` and `null`. Neither
 * side is wrong and the gap between them is where a wrong answer comes from
 * rather than an error, so the conversion happens here and nowhere else.
 *
 * ## The two conversions that can lie
 *
 * **Dates.** A `@db.Date` column comes back as a `Date` at midnight *UTC*, and
 * every comparison in the package is a lexicographic one on `YYYY-MM-DD`. So
 * {@link toIsoDate} reads the UTC fields and never the local ones: a server in
 * `UTC-5` calling `toLocaleDateString` would render midnight-UTC as the
 * previous day, and a lot would expire twenty-four hours early on every screen
 * that showed it. {@link todayAt} makes the opposite call for the opposite
 * reason - see its own comment.
 *
 * **Absence.** Every optional is converted with `?? undefined` rather than
 * passed through, because `null` and `undefined` mean different things to the
 * package and none of the differences are loud. A `null` `expiresOn` reaches
 * `assertIsoDate` and throws a `RangeError` out of a balance read; a `null`
 * `reorderLevel` turns "never flag this item" into "flag it at zero", which
 * reorders stock nobody asked for; a `null` `actorId` or `correctsMovementId`
 * throws a raw `TypeError` out of `movementProblems` - the one function in the
 * package that collects its complaints instead of throwing them, so a throw
 * from it arrives as a bare 500 rather than as the field-by-field 422 the write
 * door exists to produce.
 *
 * ## The conversion that is not here
 *
 * `Decimal` is not converted here, and looking for it is the reason this
 * paragraph exists. Prisma renders `packSize`, `reorderLevel` and `quantity` as
 * arbitrary-precision objects, and `toPlainRow` in `repositories/rows.ts`
 * flattens every one of them to a `number` in the single place a record crosses
 * that boundary; the in-memory store never holds a Decimal at all, because a
 * spec builds its rows from plain numbers. `Row<M>` types the columns as
 * `number` accordingly, so both implementations reach this file having already
 * done it. A second conversion here would be dead code wearing the costume of a
 * safety net.
 *
 * ## Why the object literals are written out longhand
 *
 * Each conversion below is a single literal with its properties in a fixed
 * order rather than a spread of the row. The package's duplicate detection
 * compares two records for the same id with `JSON.stringify`, which is
 * key-order sensitive: two code paths producing the same movement in two key
 * orders would be reported as "supplied twice with different contents" and
 * would take down the balance read rather than being deduplicated. One literal
 * per type is what makes that unrepresentable.
 */

/** A stored day column, as the package's lexicographic comparisons need it. */
export function toIsoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

/**
 * The reverse: a `YYYY-MM-DD` back into the `Date` a `@db.Date` column holds.
 *
 * Explicitly at midnight UTC, matching what Postgres hands back, so a value
 * that makes a round trip through the database compares equal to the one that
 * went in. Constructed from the literal rather than by `new Date(value)`,
 * which is only UTC for this exact shape and drifts to local time the moment
 * a caller passes a date-time.
 */
export function fromIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Today, where the stock physically is.
 *
 * The opposite decision to {@link toIsoDate}, for the opposite reason. A clinic
 * in Los Angeles at five in the afternoon is already tomorrow in UTC, so a
 * beyond-use window judged against the UTC day retires a vial a day early -
 * every day, for every clinic west of Greenwich. `Facility.timezone` exists
 * precisely so this question has an answer that is not the server's own
 * timezone.
 *
 * Assembled from named `formatToParts` entries rather than from the formatted
 * string, because the order and the separators of a locale's output are a
 * presentation decision that has changed between ICU versions. `en-US` is
 * passed only to pin the calendar and numbering system; nothing here reads the
 * shape it would produce.
 *
 * A timezone the platform does not know throws out of the `Intl` constructor
 * rather than quietly falling back to the server's own zone, which is the right
 * failure: a silently substituted zone is the same off-by-one-day bug this
 * function exists to prevent, with nothing to notice it by.
 */
export function todayAt(timeZone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  // Collected rather than found, so there is no "what if the part is missing"
  // fallback pretending to be a decision somebody made. The three parts are
  // exactly what was asked for, and concatenating a single-element list is the
  // same value with no branch attached to it.
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts
      .filter((part) => part.type === type)
      .map((part) => part.value)
      .join('');
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** A stored lot, as `fefo`, `lastUsableDay` and `unusableReason` read it. */
export function toLot(
  row: ScopedRow<'StockLot'>,
  statusHistory: readonly ScopedRow<'StockLotStatusChange'>[] = []
): Lot {
  return {
    id: row.id,
    itemId: row.itemId,
    lotNumber: row.lotNumber,
    status: row.status,
    // Absent rather than empty when nothing is recorded, because the package
    // reads the two differently: an absent history means "judge on `status`",
    // which is what every caller did before the table existed, while an empty
    // one would be a history that says the lot has never had a status.
    ...(statusHistory.length === 0
      ? {}
      : {
          statusHistory: statusHistory.map((change) => ({
            status: change.status,
            effectiveOn: toIsoDate(change.effectiveOn),
          })),
        }),
    ...(row.expiresOn === null ? {} : { expiresOn: toIsoDate(row.expiresOn) }),
    ...(row.openedOn === null ? {} : { openedOn: toIsoDate(row.openedOn) }),
    ...(row.beyondUseDays === null ? {} : { beyondUseDays: row.beyondUseDays }),
    receivedOn: toIsoDate(row.receivedOn),
  };
}

/**
 * A stored catalogue item, as `needsReorder` and `packsToUnits` read it.
 *
 * `unit` is asserted rather than checked. The column is a `String` and the
 * value set is closed at the write door by `units.ts`; the package never reads
 * `unit` at runtime, so a value that got in some other way changes a label and
 * never a decision - which is why this is the one field here worth a cast
 * instead of a refusal that would take an item's whole balance offline.
 */
export function toStockItem(row: ScopedRow<'StockItem'>): PackageStockItem {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit as PackageStockItem['unit'],
    ...(row.packSize === null ? {} : { packSize: row.packSize }),
    ...(row.reorderLevel === null ? {} : { reorderLevel: row.reorderLevel }),
    controlled: row.controlled,
  };
}

/** A stored ledger line, as every balance function reads it. */
export function toMovement(row: ScopedRow<'StockMovement'>): PackageMovement {
  return {
    id: row.id,
    lotId: row.lotId,
    itemId: row.itemId,
    kind: row.kind,
    quantity: row.quantity,
    occurredOn: toIsoDate(row.occurredOn),
    actorId: row.actorId,
    ...(row.correctsMovementId === null ? {} : { correctsMovementId: row.correctsMovementId }),
    ...(row.reason === null ? {} : { reason: row.reason }),
  };
}

/** The facts a ledger line needs that the package has no field for. */
export interface MovementPlacement {
  /** The business event the line belongs to. */
  readonly postingId: string;
  /** The site the stock physically moved at. Denormalised from the lot. */
  readonly facilityId: string;
  /** The line's position in its lot's ledger, from 1. */
  readonly lotSeq: number;
}

/**
 * The reverse direction: a package movement as the columns of a row.
 *
 * `undefined` goes back to `null` here, which is the mirror image of the
 * conversion at the top of this file and just as load-bearing: a spec returns
 * the whole row so that the in-memory store and Postgres cannot disagree about
 * a default, and an absent key would leave the in-memory row without the
 * column at all while Postgres wrote a null.
 */
export function movementColumns(
  movement: PackageMovement,
  placement: MovementPlacement
): Writable<'StockMovement'> {
  return {
    postingId: placement.postingId,
    lotId: movement.lotId,
    itemId: movement.itemId,
    facilityId: placement.facilityId,
    kind: movement.kind,
    quantity: movement.quantity,
    occurredOn: fromIsoDate(movement.occurredOn),
    actorId: movement.actorId,
    reason: movement.reason ?? null,
    correctsMovementId: movement.correctsMovementId ?? null,
    lotSeq: placement.lotSeq,
  };
}

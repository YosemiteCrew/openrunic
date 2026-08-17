import { fefo, type IsoDate, type Lot } from './lots.js';
import { balancesByLot, type StockMovement } from './ledger.js';

/**
 * DISPENSING: TAKING STOCK OFF THE SHELF, AND FROM WHICH LOT.
 *
 * ## The bug this file is shaped around
 *
 * A prescription reads "one tablet twice daily for ten days". Three numbers are
 * visible - 1, 2, 10 - and the quantity that leaves the shelf is none of them.
 * It is 20. The failure is to deduct the dose: the pharmacy hands over a bottle
 * of twenty and the system records that one tablet left, and the count is wrong
 * by nineteen with nothing anywhere reading as an error. It is quiet, it is
 * cumulative, and it is found weeks later at a physical count with no way to
 * tell which of four hundred dispenses was the bad one.
 *
 * That is a units bug wearing the costume of a plain number, so the fix is to
 * stop it being a plain number. {@link DispensedQuantity} is branded, and the
 * only ways to make one are {@link courseTotal}, which does the multiplication,
 * and {@link exactlyThisManyStockUnits}, whose name is the whole point: passing
 * a per-dose figure now requires typing a phrase that says it is not one.
 *
 * The brand costs a compile error at each call site and buys the guarantee that
 * nobody reaches this code holding a dose and believing it is a total.
 *
 * ## Divisibility
 *
 * Thirty tablets may come from two lots; a single 0.5 mL injection may not. The
 * caller says which it is, because the package cannot tell from the unit alone -
 * `mL` is divisible when filling a bottle and indivisible within one injection.
 * There is no default: a wrong guess here draws half a dose from each of two
 * vials, and no test that only counts totals would notice.
 */

declare const DISPENSED: unique symbol;

/**
 * A quantity in an item's stock unit, known to be a total rather than a dose.
 *
 * The brand exists only at the type level and vanishes at runtime; what it buys
 * is that a bare `number` will not typecheck where one of these is wanted.
 */
export type DispensedQuantity = number & { readonly [DISPENSED]: true };

/** How a prescription's numbers turn into a quantity. */
export interface Course {
  /** Stock units per administration - the 1 in "one tablet". */
  readonly perDose: number;
  /** Administrations per day - the "twice". */
  readonly dosesPerDay: number;
  /** How many days it runs - the "ten". */
  readonly days: number;
}

/**
 * The whole course, which is what actually leaves the shelf.
 *
 * The multiplication lives here rather than at each call site so there is one
 * place to be right and one place to test. See the header for what happens when
 * it lives at four hundred call sites instead.
 */
export function courseTotal(course: Course): DispensedQuantity {
  return (course.perDose * course.dosesPerDay * course.days) as DispensedQuantity;
}

/**
 * A quantity that is already a total, for the cases with no course behind them.
 *
 * A single vaccination, a box handed over, a wastage figure. Deliberately
 * unpleasant to type: it is also the escape hatch somebody reaches for while
 * holding a per-dose number, and the name is there to be read at that moment.
 */
export function exactlyThisManyStockUnits(quantity: number): DispensedQuantity {
  return quantity as DispensedQuantity;
}

/** One lot's share of a dispense. */
export interface AllocationLine {
  readonly lotId: string;
  readonly lotNumber: string;
  readonly quantity: number;
}

/**
 * What the shelf can actually supply against a request.
 *
 * `shortfall` is a field rather than an exception because a partial fill is a
 * real transaction, not an error: twenty now and ten owed is a thing pharmacies
 * do every day. Making it a returned value means the caller has to look at it.
 * Throwing would have meant the successful-looking path silently supplied less
 * than was asked for.
 */
export interface Allocation {
  readonly lines: readonly AllocationLine[];
  readonly allocated: number;
  readonly requested: number;
  readonly shortfall: number;
  /**
   * Set when enough stock exists but no single lot holds enough, and the
   * request could not be split.
   *
   * Named separately because it is the state that makes people distrust the
   * system: the screen says there is no stock, the fridge visibly has some, and
   * both are true. Without this the caller can only say "insufficient", which
   * is the wrong answer to what the person is actually looking at.
   */
  readonly blockedByIndivisibility?: true;
}

export interface AllocationOptions {
  /**
   * Whether the quantity may be drawn from more than one lot.
   *
   * No default. See the header: the answer differs between two dispenses of the
   * same item in the same unit, so a default would be wrong half the time and
   * silent every time.
   */
  readonly divisible: boolean;
}

/**
 * Picks the lots to draw from, soonest-expiring first.
 *
 * Never allocates more than a lot holds and never more than was asked for, so
 * the ledger cannot be driven negative through this path. Lots at or below zero
 * are skipped rather than allocated zero from: a line for nothing is noise in
 * every downstream record.
 */
export function allocate(
  lots: readonly Lot[],
  movements: readonly StockMovement[],
  itemId: string,
  requested: DispensedQuantity,
  asOf: IsoDate,
  options: AllocationOptions
): Allocation {
  const balances = balancesByLot(movements, itemId, asOf);
  // Each candidate carries the balance that qualified it, rather than being
  // looked up again in three places below. Re-reading the map would mean three
  // more `?? 0` fallbacks for a key the filter already proved present - dead
  // branches that read as though a missing balance were a case somebody had
  // thought about.
  const candidates = fefo(
    lots.filter((lot) => lot.itemId === itemId),
    asOf
  )
    .map((lot) => ({ lot, onHand: balances.get(lot.id) ?? 0 }))
    .filter((entry) => entry.onHand > 0);

  if (requested <= 0) {
    return { lines: [], allocated: 0, requested, shortfall: 0 };
  }

  if (!options.divisible) {
    const whole = candidates.find((entry) => entry.onHand >= requested);
    if (whole === undefined) {
      const available = candidates.reduce((total, entry) => total + entry.onHand, 0);
      return {
        lines: [],
        allocated: 0,
        requested,
        shortfall: requested,
        // Only when the stock is genuinely there and merely scattered. A plain
        // shortage is a plain shortage, and labelling it as an indivisibility
        // problem would send somebody looking for a lot that does not exist.
        ...(available >= requested ? { blockedByIndivisibility: true as const } : {}),
      };
    }
    return {
      lines: [{ lotId: whole.lot.id, lotNumber: whole.lot.lotNumber, quantity: requested }],
      allocated: requested,
      requested,
      shortfall: 0,
    };
  }

  const lines: AllocationLine[] = [];
  let remaining: number = requested;
  for (const { lot, onHand } of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, onHand);
    lines.push({ lotId: lot.id, lotNumber: lot.lotNumber, quantity: take });
    remaining -= take;
  }

  const allocated = requested - remaining;
  return { lines, allocated, requested, shortfall: remaining };
}

/**
 * Turns an allocation into the movements that record it.
 *
 * Split from `allocate` on purpose. Deciding what to take and writing down that
 * it was taken are different acts, and a system that fused them would post the
 * ledger for a dispense that then failed at the counter - the tablets back on
 * the shelf and the record saying they left. The caller allocates, does the
 * physical thing, and posts.
 *
 * `id` is supplied per line by the caller rather than generated here, because
 * this package has no opinion about identifiers and generating them would make
 * it unable to reproduce a run.
 */
export function movementsFor(
  allocation: Allocation,
  detail: {
    readonly itemId: string;
    readonly kind: 'DISPENSE' | 'ADMINISTER' | 'WASTE' | 'TRANSFER_OUT';
    readonly occurredOn: IsoDate;
    readonly actorId: string;
    readonly reason?: string;
    readonly idFor: (line: AllocationLine, index: number) => string;
  }
): readonly StockMovement[] {
  return allocation.lines.map((line, index) => ({
    id: detail.idFor(line, index),
    lotId: line.lotId,
    itemId: detail.itemId,
    kind: detail.kind,
    quantity: line.quantity,
    occurredOn: detail.occurredOn,
    actorId: detail.actorId,
    ...(detail.reason === undefined ? {} : { reason: detail.reason }),
  }));
}

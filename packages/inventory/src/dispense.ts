import { assertIsoDate, fefo, type IsoDate, type Lot } from './lots.js';
import { balancesByLot, toStockPrecision, type StockMovement } from './ledger.js';

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
  // Each dimension checked before the multiplication, not after it. Validating
  // only the product lets two malformed fields cancel: `perDose: -1` with
  // `dosesPerDay: -2` multiplies out to a finite positive 20, which passes
  // every check downstream and dispenses twenty units against a prescription
  // that says nothing coherent. A sign error is a data-entry mistake and a
  // plausible total is exactly what it must not produce.
  //
  // The three fields named, rather than `Object.entries`. TypeScript is
  // structural, so a prescription record carrying an `id` alongside these three
  // is a valid `Course` at the call site - and walking its keys rejected the
  // `id` for not being a number, refusing a course whose every declared field
  // was fine. A validator has to check the contract it was given, not whatever
  // else the object happens to carry.
  for (const name of ['perDose', 'dosesPerDay', 'days'] as const) {
    const value = course[name];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`A course's ${name} must be zero or more, not ${String(value)}.`);
    }
  }
  return exactlyThisManyStockUnits(course.perDose * course.dosesPerDay * course.days);
}

/**
 * A quantity that is already a total, for the cases with no course behind them.
 *
 * A single vaccination, a box handed over, a wastage figure. Deliberately
 * unpleasant to type: it is also the escape hatch somebody reaches for while
 * holding a per-dose number, and the name is there to be read at that moment.
 */
export function exactlyThisManyStockUnits(quantity: number): DispensedQuantity {
  // Checked, not merely cast. The brand's promise is "this is a total", and a
  // cast that accepts anything makes that a promise about where the number was
  // typed rather than about the number. A negative brands as a valid total and
  // allocates as `requested: -5, allocated: 0, shortfall: 0` - a request that
  // reports itself completely filled having moved nothing. `NaN` is worse: it
  // survives `Math.min`, so allocation lines and posted movements carry it, and
  // every balance downstream becomes `NaN` with no row identifiable as the one
  // that did it.
  if (!Number.isFinite(quantity)) {
    throw new RangeError(`A dispensed quantity must be a number, not ${String(quantity)}.`);
  }
  if (quantity < 0) {
    throw new RangeError(`A dispensed quantity cannot be negative: ${String(quantity)}.`);
  }
  // Normalised to the same six places the ledger carries, because a course of
  // 0.1 three times a day multiplies out to 0.30000000000000004. Against a lot
  // holding exactly 0.3 that allocated the whole 0.3 and reported a shortfall
  // of 5.55e-17 - a complete fill that reads as partial, so the counter is told
  // to owe the patient a quantity too small to measure. The ledger rounds its
  // sums and the quantity going in has to be on the same grid, or the two
  // disagree at the seventeenth decimal place and the disagreement is what the
  // caller sees.
  return toStockPrecision(quantity) as DispensedQuantity;
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
  /**
   * The item this was allocated against.
   *
   * Carried so `movementsFor` can take it from here rather than from a second
   * argument. Without it a caller could allocate item A and post the movements
   * under item B, and nothing could detect the mismatch: the lot ids and
   * quantities are all valid, they simply debit the wrong ledger. The rejected
   * alternative was to keep taking `itemId` and compare - which catches it, and
   * only for a caller who supplied the right one somewhere.
   */
  readonly itemId: string;
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
  assertIsoDate(asOf, 'asOf');
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
    return { itemId, lines: [], allocated: 0, requested, shortfall: 0 };
  }

  // Compared to `false` rather than tested for truthiness. The option is
  // documented as having no default because a wrong guess splits a single
  // injection across two vials, and truthiness handed that decision to
  // JavaScript: the string `'false'` from an unchecked form is truthy and chose
  // divisible, while an omitted value chose indivisible - both silently, and
  // both being the answer nobody gave.
  // The object before the property. Guarding `options.divisible` and not
  // `options` meant an omitted sixth argument - which is the most natural form
  // of the omitted answer this check is about - threw a TypeError before the
  // refusal it exists to produce could be reached.
  if (typeof options !== 'object' || options === null) {
    throw new RangeError(
      'An allocation must say whether the quantity may be split across lots; no options were given.'
    );
  }
  if (typeof options.divisible !== 'boolean') {
    throw new RangeError(
      `An allocation must say whether the quantity may be split across lots; divisible was ${String(options.divisible)}.`
    );
  }
  if (!options.divisible) {
    const whole = candidates.find((entry) => entry.onHand >= requested);
    if (whole === undefined) {
      // Normalised before the comparison, because the request already is. A
      // request for 0.8 against lots of 0.7 and 0.1 summed to
      // 0.7999999999999999, so the comparison was false and the caller was told
      // there was a shortage - in front of a fridge holding exactly enough,
      // which is precisely the state `blockedByIndivisibility` exists to name.
      const available = toStockPrecision(
        candidates.reduce((total, entry) => total + entry.onHand, 0)
      );
      return {
        itemId,
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
      itemId,
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
    const take = toStockPrecision(Math.min(remaining, onHand));
    lines.push({ lotId: lot.id, lotNumber: lot.lotNumber, quantity: take });
    // Normalised, not just subtracted. Repeated subtraction left a residue -
    // filling one unit from lots of 0.7, 0.1 and 0.2 leaves about 2.78e-17 -
    // so `remaining` stayed above zero, the next candidate's take rounded to
    // nothing, and a zero-quantity line was appended. That produced an
    // allocation the package's own consistency check then refused, which meant
    // `movementsFor(allocate(...))` threw on a request that was completely
    // filled: the package rejecting its own output.
    //
    // Keeping `remaining` on the grid closes it at the source. A guard on the
    // take itself was the alternative and is now unreachable - both figures
    // being on the grid, their minimum cannot round to zero while `remaining`
    // is positive - so it is not carried, because an unreachable guard reads as
    // though the case it names can happen.
    remaining = toStockPrecision(remaining - take);
  }

  const allocated = toStockPrecision(requested - remaining);
  return { itemId, lines, allocated, requested, shortfall: toStockPrecision(remaining) };
}

/**
 * Refuses an allocation whose own numbers do not add up.
 *
 * `Allocation` is a plain interface, so a caller can build one - and the tests
 * themselves do. `movementsFor` copied every line and checked none of them
 * against the totals beside them, so an allocation reporting one unit requested
 * and allocated while carrying a hundred-unit line emitted a hundred-unit
 * movement that `movementProblems` accepted and the ledger debited.
 *
 * The alternative was to make `Allocation` unforgeable with a brand. That would
 * be stronger, and it would also stop a caller reconstructing one from a stored
 * request - which is exactly what a retry after a failed post has to do. So the
 * shape stays open and its arithmetic is checked here, at the only door that
 * turns it into ledger rows.
 */
/**
 * The stock grid, as an integer.
 *
 * Six decimal places is what the ledger carries and what the column stores, so
 * a quantity that is not a whole number of these is not a quantity this system
 * can hold - it rounds to something else on the way into `DECIMAL(18,6)`.
 */
const GRID = 1e6;

function onGrid(quantity: number): boolean {
  return Number.isInteger(Math.round(quantity * GRID)) && toStockPrecision(quantity) === quantity;
}

/** A figure as a whole number of grid steps, for an exact comparison. */
function steps(quantity: number): number {
  return Math.round(quantity * GRID);
}

function assertConsistent(allocation: Allocation): void {
  // The three totals bounded before they are compared. Comparing them alone let
  // a negative shortfall satisfy the arithmetic: 100 allocated against 1
  // requested balances if the shortfall is -99, and a hundred-unit outbound
  // movement went out for a one-unit request. An equation that holds is not the
  // same as numbers that mean anything, and a shortfall below zero is stock
  // owed back by the patient.
  for (const [name, value] of [
    ['requested', allocation.requested],
    ['allocated', allocation.allocated],
    ['shortfall', allocation.shortfall],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`An allocation's ${name} must be zero or more, not ${String(value)}.`);
    }
    // On the grid, like the lines. `steps` rounds, so an off-grid total was
    // silently normalised before both comparisons - an allocation with no lines
    // claiming 0.0000004 allocated passed and posted nothing, while the comment
    // beside the comparison called it exact and lossless. It is lossless only
    // for figures already on the grid, so that has to be checked rather than
    // assumed.
    if (!onGrid(value)) {
      throw new RangeError(
        `An allocation's ${name} is ${String(value)}, which is finer than the six decimal places stock is carried to.`
      );
    }
  }

  for (const line of allocation.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new RangeError(
        `Allocation line for lot ${line.lotNumber} has quantity ${String(line.quantity)}, which is not a positive number.`
      );
    }
    // On the grid, not merely positive. A line finer than six decimal places is
    // not a quantity this system can hold - it becomes something else in the
    // column - and it was the way through every totals check so far: round both
    // sides and a sub-grid line matches an allocation claiming nothing; compare
    // within a tolerance and the hole moves below the tolerance. There is no
    // threshold that closes it, because any threshold has a below.
    if (!onGrid(line.quantity)) {
      throw new RangeError(
        `Allocation line for lot ${line.lotNumber} has quantity ${String(line.quantity)}, which is finer than the six decimal places stock is carried to.`
      );
    }
  }

  // Summed as whole grid steps and compared exactly. Integers, so there is no
  // float noise to tolerate - `0.1 + 0.2` is not `0.3` but 100000 + 200000 is
  // 300000 - and no tolerance, so there is no value small enough to slip under
  // one. Every line is already known to be on the grid by the loop above, which
  // is what makes the conversion lossless rather than another rounding.
  const summed = allocation.lines.reduce((total, line) => total + steps(line.quantity), 0);
  if (summed !== steps(allocation.allocated)) {
    throw new RangeError(
      `Allocation lines sum to ${String(summed / GRID)} but the allocation says ${String(allocation.allocated)} was allocated.`
    );
  }

  if (steps(allocation.allocated) + steps(allocation.shortfall) !== steps(allocation.requested)) {
    throw new RangeError(
      `Allocation accounts for ${String(allocation.allocated + allocation.shortfall)} of a requested ${String(allocation.requested)}.`
    );
  }
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
 *
 * The item is not supplied. It comes from the allocation, so a caller cannot
 * allocate one item and post the movements under another - a mismatch nothing
 * downstream could detect, because every lot id and quantity in the result is
 * valid and merely debits the wrong ledger.
 */
export function movementsFor(
  allocation: Allocation,
  detail: {
    readonly kind: 'DISPENSE' | 'ADMINISTER' | 'WASTE' | 'TRANSFER_OUT';
    readonly occurredOn: IsoDate;
    readonly actorId: string;
    readonly reason?: string;
    readonly idFor: (line: AllocationLine, index: number) => string;
  }
): readonly StockMovement[] {
  assertConsistent(allocation);
  return allocation.lines.map((line, index) => ({
    id: detail.idFor(line, index),
    lotId: line.lotId,
    itemId: allocation.itemId,
    kind: detail.kind,
    quantity: line.quantity,
    occurredOn: detail.occurredOn,
    actorId: detail.actorId,
    ...(detail.reason === undefined ? {} : { reason: detail.reason }),
  }));
}

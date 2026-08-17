import { assertIsoDate, fefo, type IsoDate, type Lot } from './lots.js';

/**
 * THE MOVEMENT LEDGER: HOW MUCH IS THERE, AND HOW IT GOT THAT WAY.
 *
 * Stock on hand is not stored. It is derived, every time, by summing the
 * movements that produced it. That is slower than a column holding the number,
 * and it is the design anyway, for a reason that has nothing to do with
 * performance:
 *
 * A quantity column can be set. Once it can be set, it will be, by a well-meant
 * repair of a number that looked wrong - and the repair leaves no trace of what
 * was wrong or who decided it. For most data that is a bad day. For a controlled
 * substance it is the thing a DEA audit exists to detect, and a system that
 * cannot distinguish "somebody corrected a typo" from "somebody removed a
 * hundred tablets and adjusted the count" is not one a practice can defend.
 *
 * So the ledger is append-only. A mistake is not edited; it is corrected by a
 * compensating movement that points at the one it corrects, and both are in the
 * record forever. The balance moves, the history does not.
 *
 * ## Why kind carries the sign
 *
 * A movement's quantity is always positive, and its direction comes from its
 * kind. A signed quantity would permit `{ kind: 'RECEIPT', quantity: -40 }`,
 * which is a removal wearing the word "receipt" - readable as an arrival in
 * every report that groups by kind, and invisible to a reviewer scanning for
 * removals. Direction belonging to the kind makes that unrepresentable rather
 * than merely discouraged.
 *
 * It is why a count variance is two kinds rather than one signed one. Stock
 * found and stock missing are not one event with a sign: one is a bookkeeping
 * correction, and the other, on a controlled substance, is a reportable loss.
 */

/**
 * The stock unit for an item. Every quantity in this package is in this unit.
 *
 * Not a free string. The unit problem is the one that produces a wrong number
 * rather than an error: deduct 30 from a shelf counted in vials when the 30 was
 * tablets and nothing throws, nothing logs, and the count is wrong until
 * somebody stands in front of the shelf. Naming the units the system knows how
 * to count is what keeps that to a compile error.
 */
export type StockUnit =
  'each' | 'tablet' | 'capsule' | 'mL' | 'mg' | 'dose' | 'vial' | 'gram' | 'patch';

export interface StockItem {
  readonly id: string;
  readonly name: string;
  /**
   * The unit stock is counted in, which is also the unit it leaves in.
   *
   * One unit per item, deliberately. A practice that buys boxes and dispenses
   * tablets converts once, at receipt, where somebody is looking at the carton -
   * rather than on every movement, where a missing conversion is a silently
   * wrong number instead of a visible one. `packSize` is what makes that one
   * conversion explicit.
   */
  readonly unit: StockUnit;
  /**
   * How many stock units come in one purchasable pack, when they differ.
   *
   * Recorded so a receipt can say "four boxes" and post 400 tablets, with the
   * arithmetic in one place that a test can hold. Absent when the pack is the
   * unit.
   */
  readonly packSize?: number;
  /**
   * At or below this, the item is due to be reordered.
   *
   * Inclusive, which is the convention a reorder point follows: the level is
   * the quantity at which somebody should already be ordering, not the last one
   * before it. Said here because the boundary was documented as exclusive and
   * implemented as inclusive, leaving a caller to work out which was
   * authoritative from a test.
   */
  readonly reorderLevel?: number;
  /** True for anything on a controlled-substance schedule. */
  readonly controlled?: boolean;
}

/** Movements that add to stock. */
const INBOUND = ['RECEIPT', 'RETURN', 'TRANSFER_IN', 'COUNT_SURPLUS'] as const;
/** Movements that take from it. */
const OUTBOUND = ['DISPENSE', 'ADMINISTER', 'WASTE', 'TRANSFER_OUT', 'COUNT_SHORTFALL'] as const;

export type InboundKind = (typeof INBOUND)[number];
export type OutboundKind = (typeof OUTBOUND)[number];
export type MovementKind = InboundKind | OutboundKind;

const INBOUND_KINDS: ReadonlySet<string> = new Set(INBOUND);

/**
 * Every kind, for checking one that arrived at runtime.
 *
 * The type stops a bad kind being written in this repository. It stops nothing
 * arriving from a database column or a request body, and the failure mode there
 * is quiet: `isInbound` answers false for anything it does not recognise, so an
 * unknown kind would subtract. A misspelled `RECIEPT` would have removed stock
 * on the way in and balanced to a plausible-looking number.
 */
const ALL_KINDS: ReadonlySet<string> = new Set<string>([...INBOUND, ...OUTBOUND]);

export function isKnownKind(kind: string): kind is MovementKind {
  return ALL_KINDS.has(kind);
}

export function isInbound(kind: MovementKind): boolean {
  return INBOUND_KINDS.has(kind);
}

export interface StockMovement {
  readonly id: string;
  readonly lotId: string;
  readonly itemId: string;
  readonly kind: MovementKind;
  /** Always positive. Direction is the kind's job; see the header. */
  readonly quantity: number;
  readonly occurredOn: IsoDate;
  /** Who posted it. Required, including for corrections. */
  readonly actorId: string;
  /**
   * The movement this one corrects, when it is a correction.
   *
   * Set rather than editing the original. The pair reads as "this happened, and
   * then it was found to be wrong", which is what occurred; editing would read
   * as "this happened", which is not.
   */
  readonly correctsMovementId?: string;
  /**
   * Why, in the words of whoever posted it.
   *
   * Required on the kinds where the number alone does not say - waste, the two
   * count variances, and any correction. A quantity that changed for a reason
   * nobody wrote down is the entry an auditor asks about and nobody can answer.
   */
  readonly reason?: string;
}

/** Kinds that mean nothing without a reason attached. */
const REASON_REQUIRED: ReadonlySet<MovementKind> = new Set<MovementKind>([
  'WASTE',
  'COUNT_SURPLUS',
  'COUNT_SHORTFALL',
]);

/**
 * What is wrong with a movement, or nothing.
 *
 * Checked before posting rather than on read. A ledger is append-only, so an
 * invalid entry cannot be taken back out - it can only be compensated, which
 * leaves two confusing rows where there should be none. The validation has to
 * happen at the door.
 */
export function movementProblems(movement: StockMovement): readonly string[] {
  const problems: string[] = [];

  // The date belongs at the door with everything else. Without it a malformed
  // `occurredOn` passed validation, entered an append-only ledger, and then
  // threw on every subsequent balance read for that lot - blocking allocation
  // and reconciliation until somebody worked out that an immutable row had to
  // be compensated. Failing closed on read is right; failing closed only on
  // read turns one bad keystroke into a lot nobody can count.
  try {
    assertIsoDate(movement.occurredOn, 'occurredOn');
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  // Checked at runtime as well as in the type, because a kind read from a
  // column is not compile-checked and an unrecognised one subtracts silently.
  if (!isKnownKind(movement.kind)) {
    problems.push(`${movement.kind} is not a movement kind this system knows.`);
  }

  if (!Number.isFinite(movement.quantity)) {
    problems.push('A movement quantity must be a number.');
  } else if (movement.quantity <= 0) {
    // Zero as well as negative. A zero movement asserts that something happened
    // and changes nothing, which is the shape of a bug rather than an event.
    problems.push('A movement quantity must be greater than zero.');
  }

  // Trimmed, because a reason of three spaces satisfied an exact-empty check
  // and told an auditor nothing about why controlled stock moved. The rule is
  // that the movement carries a reason, not that the field is non-empty.
  const reason = (movement.reason ?? '').trim();
  if (REASON_REQUIRED.has(movement.kind) && reason === '') {
    problems.push(`A ${movement.kind} movement must say why.`);
  }
  if (movement.correctsMovementId !== undefined && reason === '') {
    problems.push('A correction must say why.');
  }
  if (movement.correctsMovementId === movement.id) {
    problems.push('A movement cannot correct itself.');
  }
  // Trimmed and required, like the reason and the actor beside it. A row
  // carrying `correctsMovementId: '   '` claims to correct something and names
  // nothing, so the audit link the field exists to make points nowhere - and
  // the ledger is append-only, so the claim stays.
  if (movement.correctsMovementId !== undefined && movement.correctsMovementId.trim() === '') {
    problems.push('A correction must name the movement it corrects.');
  }
  // Trimmed like the reason, and for the same reason: an audit entry naming
  // "   " as the actor names nobody, with more confidence than a blank field.
  if (movement.actorId.trim() === '') {
    problems.push('A movement must name who posted it.');
  }

  return problems;
}

/**
 * A movement's effect on the balance: positive in, negative out.
 *
 * Throws on a kind it does not recognise rather than falling through to
 * outbound. The first version of this checked the kind in `movementProblems`
 * and nowhere else, which read as protection and was not: `lotBalance` and
 * `balancesByLot` call this directly, so a movement deserialised with a
 * misspelled `RECIEPT` produced a quiet, plausible, wrong balance without any
 * validation error - the exact failure the check was written to prevent, left
 * open on the only path that matters.
 *
 * Failing closed here is the right trade. A thrown error on a corrupt row is a
 * bad afternoon; a balance that is confidently wrong is stock ordered against a
 * number nobody can reproduce.
 */
export function signedQuantity(movement: StockMovement): number {
  // The quantity as well as the kind, because the README claimed
  // `{ kind: 'RECEIPT', quantity: -40 }` was unrepresentable and only half of
  // that was true: the kind cannot carry a sign, and a negative quantity under
  // an inbound kind still subtracted. `NaN` was worse, poisoning every balance
  // downstream with no row identifiable as the cause. `movementProblems` caught
  // both and nothing on this path called it.
  if (!Number.isFinite(movement.quantity) || movement.quantity <= 0) {
    throw new RangeError(
      `Movement ${movement.id} has quantity ${String(movement.quantity)}, which is not a positive number, so its effect on the balance cannot be determined.`
    );
  }
  if (!isKnownKind(movement.kind)) {
    throw new RangeError(
      `Movement ${movement.id} has kind ${JSON.stringify(movement.kind)}, which is not one this system knows, so its effect on the balance cannot be determined.`
    );
  }
  return isInbound(movement.kind) ? movement.quantity : -movement.quantity;
}

/**
 * Stock quantities are carried to six decimal places, and sums are rounded back
 * to it.
 *
 * Because some units are fractional. Receive 0.3 mL and remove 0.1 and 0.2 and
 * binary floating point leaves -2.78e-17 rather than zero - which
 * `negativeBalances` reports as a loss, `countVariance` turns into a variance
 * against a shelf that is correct, and a reorder decision acts on. A stockroom
 * chasing a discrepancy of minus two hundred and seventy-eight quintillionths
 * of a millilitre is a stockroom that stops believing the reports.
 *
 * Six places is far below any real dispensing precision - the smallest thing
 * anyone measures here is a hundredth of a millilitre - and far above the noise,
 * so it removes the artefact without rounding away anything a practice meant.
 */
const PLACES = 1e6;

export function toStockPrecision(quantity: number): number {
  const rounded = Math.round(quantity * PLACES) / PLACES;
  // `+ 0` collapses negative zero, which is what rounding a tiny negative
  // residue produces. It compares equal to zero and prints as "-0", so a
  // balance report would show a lot holding minus nothing - the same
  // credibility problem as the residue itself, one layer further out.
  return rounded + 0;
}

/**
 * The movements, with each ledger row counted once.
 *
 * A join that returns a movement twice added its quantity twice, so a single
 * ten-unit receipt passed twice gave allocation twenty units to hand out - and
 * posting that against the real ledger drove the lot to -10, past the
 * guarantee that allocation never takes more than a lot holds. The same
 * duplicate-row problem as the lots, one table over, and fixing it there and
 * not here left the guarantee just as broken.
 *
 * Two rows sharing an id with different contents are not a duplicate; they are
 * two answers to what one movement was, and picking either would decide a
 * balance by array order.
 */
function distinct(movements: readonly StockMovement[]): readonly StockMovement[] {
  const unique = new Map<string, StockMovement>();
  for (const movement of movements) {
    const seen = unique.get(movement.id);
    if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(movement)) {
      throw new RangeError(
        `Movement ${movement.id} was supplied twice with different contents, so there is no one answer for its effect on the balance.`
      );
    }
    unique.set(movement.id, movement);
  }
  return [...unique.values()];
}

/**
 * Whether a movement falls on or before the cutoff.
 *
 * Validating `occurredOn` first, because the comparison is lexicographic like
 * every other date comparison here. A receipt dated `'2026-8-01'` sorted after
 * `'2026-09-01'` and dropped out of the balance, so allocation and
 * reconciliation reported a shortage that did not exist - the opposite
 * direction to the expiry bug, and just as quiet.
 *
 * Only movements that got past the lot or item filter are checked, so a ledger
 * carrying other items' rows does not pay for them.
 */
function onOrBefore(movement: StockMovement, asOf: IsoDate): boolean {
  assertIsoDate(movement.occurredOn, `movement ${movement.id} occurredOn`);
  return movement.occurredOn <= asOf;
}

/**
 * What is on hand in one lot as of a date.
 *
 * Bounded by date rather than summing everything, because the question a count
 * asks is "what should have been here on the day we counted", and movements
 * entered later for earlier days have to land in that answer while movements
 * for later days must not. A ledger that could only report "now" would make
 * every back-dated entry look like a discrepancy.
 */
export function lotBalance(
  movements: readonly StockMovement[],
  lotId: string,
  asOf: IsoDate
): number {
  assertIsoDate(asOf, 'asOf');
  return toStockPrecision(
    distinct(movements)
      .filter((movement) => movement.lotId === lotId && onOrBefore(movement, asOf))
      .reduce((total, movement) => total + signedQuantity(movement), 0)
  );
}

/** On-hand per lot for one item, keyed by lot id. Lots at zero are included. */
export function balancesByLot(
  movements: readonly StockMovement[],
  itemId: string,
  asOf: IsoDate
): ReadonlyMap<string, number> {
  assertIsoDate(asOf, 'asOf');
  const balances = new Map<string, number>();
  for (const movement of distinct(movements)) {
    if (movement.itemId !== itemId || !onOrBefore(movement, asOf)) continue;
    balances.set(
      movement.lotId,
      toStockPrecision((balances.get(movement.lotId) ?? 0) + signedQuantity(movement))
    );
  }
  return balances;
}

/** Everything on hand for one item across its lots. */
export function itemBalance(
  movements: readonly StockMovement[],
  itemId: string,
  asOf: IsoDate
): number {
  return toStockPrecision(
    [...balancesByLot(movements, itemId, asOf).values()].reduce(
      (total, quantity) => total + quantity,
      0
    )
  );
}

/**
 * A lot whose ledger says it holds less than nothing.
 *
 * Should be impossible: allocation refuses to take more than is there. It is
 * reported rather than asserted because the ledger accepts back-dated entries,
 * and a movement entered on Friday for Tuesday can drive Wednesday negative
 * without any single posting having been invalid. That is a real reconciliation
 * finding - stock left before it arrived - and the stockroom needs it surfaced
 * rather than swallowed.
 */
export interface NegativeBalance {
  readonly lotId: string;
  readonly balance: number;
}

export function negativeBalances(
  movements: readonly StockMovement[],
  itemId: string,
  asOf: IsoDate
): readonly NegativeBalance[] {
  return [...balancesByLot(movements, itemId, asOf).entries()]
    .filter(([, balance]) => balance < 0)
    .map(([lotId, balance]) => ({ lotId, balance }));
}

/**
 * The variance between a physical count and what the ledger expected.
 *
 * `undefined` when they agree, which is the common case and deserves no entry:
 * posting a zero movement for every count that came out right buries the ones
 * that did not.
 */
export interface CountVariance {
  readonly kind: 'COUNT_SURPLUS' | 'COUNT_SHORTFALL';
  readonly quantity: number;
  readonly counted: number;
  readonly expected: number;
}

/**
 * Compares a physical count to the ledger and says what movement would close
 * the gap.
 *
 * Returns the movement to post rather than posting it. The caller has to attach
 * a reason and an actor, and on a controlled substance a shortfall is a
 * reportable event rather than a keystroke - so this function stops one step
 * short of the thing that should require a person.
 *
 * Note which way round it is: the physical count wins. The shelf is the
 * territory and the ledger is the map, so a disagreement is the ledger's to
 * explain. The variance records what the ledger thought, which is what makes it
 * investigable later.
 */
export function countVariance(counted: number, expected: number): CountVariance | undefined {
  // Both operands checked, because a variance is the input to a movement and a
  // movement that cannot be posted is a variance nobody can close.
  // `countVariance(-5, 10)` returned a perfectly plausible 15-unit shortfall
  // that passed quantity validation and would have driven the ledger to -5, and
  // `NaN` produced a variance carrying `NaN` into whatever was posted from it.
  // A count of minus five is a typo at the shelf, not a finding.
  if (!Number.isFinite(counted) || counted < 0) {
    throw new RangeError(`A physical count must be zero or more, not ${String(counted)}.`);
  }
  if (!Number.isFinite(expected)) {
    throw new RangeError(`An expected balance must be a number, not ${String(expected)}.`);
  }
  // Both operands onto the ledger's grid before comparing, and the quantity
  // derived on that grid too. Without it `countVariance(0.1 + 0.2, 0.3)`
  // reported a surplus of 5.55e-17 - a variance that passes quantity validation
  // and posts as a permanent correction to an append-only ledger, for a
  // discrepancy of five hundredths of a femtolitre. Rounding the balances and
  // not the comparison against them left exactly the artefact the rounding was
  // introduced to remove.
  const shelf = toStockPrecision(counted);
  const book = toStockPrecision(expected);
  if (shelf === book) return undefined;
  return shelf > book
    ? { kind: 'COUNT_SURPLUS', quantity: toStockPrecision(shelf - book), counted, expected }
    : { kind: 'COUNT_SHORTFALL', quantity: toStockPrecision(book - shelf), counted, expected };
}

/**
 * Converts a purchased pack count into stock units.
 *
 * The one place the conversion happens, so the rest of the package works in a
 * single unit. An item with no `packSize` is bought in the unit it is counted
 * in, so the number passes through - which is right, and is also why this must
 * never be called twice on the same figure.
 */
export function packsToUnits(item: StockItem, packs: number): number {
  return packs * (item.packSize ?? 1);
}

/**
 * True when the item's *usable* stock has fallen to or below its reorder level.
 *
 * Usable, not physical, and the difference is the whole point. An item with a
 * reorder level of fifty and a hundred units sitting in an expired lot has a
 * physical balance of a hundred and can supply nobody: `allocate` skips the lot
 * and hands out zero. A reorder decision made on the physical figure suppresses
 * the replenishment precisely when the shelf is empty in every sense that
 * matters - the failure being invisible on a stock report that says 100.
 *
 * So this counts what `fefo` would actually hand out, which is the same
 * definition allocation uses. Requiring the lots as an argument is deliberate:
 * an overload that let a caller ask without them would be the physical figure
 * again, wearing this function's name.
 */
export function needsReorder(
  item: StockItem,
  lots: readonly Lot[],
  movements: readonly StockMovement[],
  asOf: IsoDate
): boolean {
  if (item.reorderLevel === undefined) return false;
  return usableBalance(lots, movements, item.id, asOf) <= item.reorderLevel;
}

/**
 * What could actually be dispensed today, across the lots that may be drawn
 * from.
 *
 * The number a stockroom means by "how much have we got". `itemBalance` answers
 * the different question of what is physically present, which includes what is
 * expired, recalled or quarantined - a figure a disposal report needs and an
 * ordering decision must not use.
 *
 * A lot below zero contributes nothing rather than a negative, because that is
 * what allocation does: it skips a balance at or below zero and takes from the
 * others. Summing the negative made lots of -10 and 20 report 10 while
 * `allocate` would hand out 20, so the figure disagreed with the only thing it
 * is supposed to predict. A negative lot is a reconciliation finding and
 * `negativeBalances` is where it is reported; it is not stock owed back.
 */
export function usableBalance(
  lots: readonly Lot[],
  movements: readonly StockMovement[],
  itemId: string,
  asOf: IsoDate
): number {
  const balances = balancesByLot(movements, itemId, asOf);
  return toStockPrecision(
    fefo(
      lots.filter((lot) => lot.itemId === itemId),
      asOf
    ).reduce((total, lot) => total + Math.max(balances.get(lot.id) ?? 0, 0), 0)
  );
}

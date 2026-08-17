import type { IsoDate } from './lots.js';

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
  /** Below this, the item is due to be reordered. */
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

  if (REASON_REQUIRED.has(movement.kind) && (movement.reason ?? '') === '') {
    problems.push(`A ${movement.kind} movement must say why.`);
  }
  if (movement.correctsMovementId !== undefined && (movement.reason ?? '') === '') {
    problems.push('A correction must say why.');
  }
  if (movement.correctsMovementId === movement.id) {
    problems.push('A movement cannot correct itself.');
  }
  if (movement.actorId === '') {
    problems.push('A movement must name who posted it.');
  }

  return problems;
}

/** A movement's effect on the balance: positive in, negative out. */
export function signedQuantity(movement: StockMovement): number {
  return isInbound(movement.kind) ? movement.quantity : -movement.quantity;
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
  return movements
    .filter((movement) => movement.lotId === lotId && movement.occurredOn <= asOf)
    .reduce((total, movement) => total + signedQuantity(movement), 0);
}

/** On-hand per lot for one item, keyed by lot id. Lots at zero are included. */
export function balancesByLot(
  movements: readonly StockMovement[],
  itemId: string,
  asOf: IsoDate
): ReadonlyMap<string, number> {
  const balances = new Map<string, number>();
  for (const movement of movements) {
    if (movement.itemId !== itemId || movement.occurredOn > asOf) continue;
    balances.set(movement.lotId, (balances.get(movement.lotId) ?? 0) + signedQuantity(movement));
  }
  return balances;
}

/** Everything on hand for one item across its lots. */
export function itemBalance(
  movements: readonly StockMovement[],
  itemId: string,
  asOf: IsoDate
): number {
  return [...balancesByLot(movements, itemId, asOf).values()].reduce(
    (total, quantity) => total + quantity,
    0
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
  if (counted === expected) return undefined;
  return counted > expected
    ? { kind: 'COUNT_SURPLUS', quantity: counted - expected, counted, expected }
    : { kind: 'COUNT_SHORTFALL', quantity: expected - counted, counted, expected };
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

/** True when the item's on-hand has fallen to or below its reorder level. */
export function needsReorder(
  item: StockItem,
  movements: readonly StockMovement[],
  asOf: IsoDate
): boolean {
  return (
    item.reorderLevel !== undefined && itemBalance(movements, item.id, asOf) <= item.reorderLevel
  );
}

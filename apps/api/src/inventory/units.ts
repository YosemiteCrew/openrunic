import type { LotStatus, MovementKind, StockUnit } from '@openrunic/inventory';

import type { Row } from '../repositories/rows.js';

/**
 * THE VALUE SETS THIS API SHARES WITH `@openrunic/inventory`, PROVED RATHER
 * THAN PROMISED.
 *
 * Three value sets cross the seam between the stock package and the database,
 * and each one fails differently when the two sides drift apart.
 *
 * `StockUnit` is the loud one and the reason this file exists at all. The
 * package's own header explains it: deduct 30 from a shelf counted in vials
 * when the 30 was tablets and nothing throws, nothing logs, and the count is
 * wrong until somebody stands in front of the shelf. `StockItem.unit` is a
 * `String` column rather than an enum, because three of the nine values are
 * UCUM codes and `schema.prisma` never bakes a terminology in - so the value
 * set has to be closed somewhere, and this is the somewhere.
 *
 * `LotStatus` and `MovementKind` are the quiet ones. Both are Prisma enums, so
 * the column already refuses a value the schema does not list - but a value the
 * *schema* has and the *package* does not is the dangerous direction, and no
 * column type catches it. `unusableReason` refuses a lot whose status it does
 * not recognise, and `signedQuantity` throws on a kind it does not recognise:
 * so a Prisma enum that grew a member the package has never heard of turns
 * every balance read for the affected rows into a 500, on a ledger that cannot
 * be edited to remove them.
 *
 * The proofs below therefore run in both directions and erase at compile time.
 * They are the same `Mirrors`/`AssertOk` machinery as `EnumParityProof` in
 * `packages/database/src/enums.ts`, restated here because that file proves a
 * tuple against a Prisma enum while these compare two string unions.
 */

/**
 * Every unit an item may be counted in, in the package's own spellings.
 *
 * `satisfies readonly StockUnit[]` is one half of the proof: a value added here
 * that the package does not know fails to compile. The other half is
 * {@link StockValueSetProof} below, which fails to compile when the package
 * gains a unit this tuple has not picked up - and names the missing one in the
 * error.
 */
export const STOCK_UNITS = [
  'each',
  'tablet',
  'capsule',
  'mL',
  'mg',
  'dose',
  'vial',
  'gram',
  'patch',
] as const satisfies readonly StockUnit[];

/** The units, as a union, for the columns and schemas that carry one. */
export type ClosedStockUnit = (typeof STOCK_UNITS)[number];

const STOCK_UNIT_SET: ReadonlySet<string> = new Set<string>(STOCK_UNITS);

/**
 * Whether a string is a unit this system can count in.
 *
 * Needed at runtime as well as in the type, because `StockItem.unit` is a
 * `String` column: a row written by a seed, a migration or an import arrives
 * here as a plain string that no compiler has looked at.
 */
export function isStockUnit(value: string): value is ClosedStockUnit {
  return STOCK_UNIT_SET.has(value);
}

/**
 * Resolves to `'ok'` when `Subset` covers every member of `Superset`, and
 * otherwise to the missing members - whose literal names then appear in the
 * compile error, which is the whole point of returning them rather than
 * `false`.
 */
type Missing<Superset extends string, Subset extends string> = [Exclude<Superset, Subset>] extends [
  never,
]
  ? 'ok'
  : Exclude<Superset, Subset>;

type AssertOk<T extends 'ok'> = T;

/**
 * The three mirrors, checked in both directions.
 *
 * Exported so it is not dead code: referencing the type is all it takes to
 * check it, and an unexported type alias would be removed by the first person
 * tidying unused declarations - taking the guarantee with it.
 */
export type StockValueSetProof = [
  AssertOk<Missing<StockUnit, ClosedStockUnit>>,
  AssertOk<Missing<ColumnLotStatus, LotStatus>>,
  AssertOk<Missing<LotStatus, ColumnLotStatus>>,
  AssertOk<Missing<ColumnMovementKind, MovementKind>>,
  AssertOk<Missing<MovementKind, ColumnMovementKind>>,
];

/**
 * The two Prisma enums, read off the generated row types rather than off the
 * `Prisma` namespace, which does not re-export enum members through this
 * package's built entry point. The row type is the same generated union and is
 * what the rest of the API already reads columns as, so proving against it
 * proves the thing that actually reaches these functions.
 */
type ColumnLotStatus = Row<'StockLot'>['status'];
type ColumnMovementKind = Row<'StockMovement'>['kind'];

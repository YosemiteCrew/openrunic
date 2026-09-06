import type { Prisma } from '@openrunic/database';

/**
 * Row types, derived from the generated Prisma types rather than restated.
 *
 * Forty-odd models mean forty-odd row shapes, and a hand-written copy of a
 * column list is a copy that drifts on the first migration: the schema grows a
 * column, the interface does not, and the API silently stops carrying it. So a
 * row is computed from the model's own scalar payload, and a column added to
 * `schema.prisma` appears here the moment `prisma generate` runs.
 *
 * Exactly one transformation is applied on the way through. Prisma renders a
 * `Decimal` column as an arbitrary-precision object, which is the right choice
 * inside the database driver and the wrong shape for an API row: it does not
 * serialize recognisably, and the in-memory repository would have to construct
 * one to stay interchangeable with the Prisma one. Decimal columns therefore
 * become `number` at this boundary, and {@link toPlainRow} performs the
 * conversion in the single place a record crosses it. Every decimal column in
 * this schema is a lab value, a dispensed quantity or a billed unit count, all
 * well inside the exactly-representable range; money is integer cents and is
 * never a Decimal.
 */

/** Every model the generated client knows, as a string union. */
export type PrismaModelName = keyof Prisma.TypeMap['model'];

type Operations<M extends PrismaModelName> = Prisma.TypeMap['model'][M]['operations'];

/** The stored record for `M`, exactly as Postgres holds it. */
export type ModelRecord<M extends PrismaModelName> =
  Prisma.TypeMap['model'][M]['payload']['scalars'];

export type FindManyArgs<M extends PrismaModelName> = Operations<M>['findMany']['args'];
export type CountArgs<M extends PrismaModelName> = Operations<M>['count']['args'];
export type FindFirstArgs<M extends PrismaModelName> = Operations<M>['findFirst']['args'];
export type CreateArgs<M extends PrismaModelName> = Operations<M>['create']['args'];
export type UpdateManyArgs<M extends PrismaModelName> = Operations<M>['updateMany']['args'];

/**
 * A Prisma `orderBy` for `M`, named so a spec can annotate its own with one.
 *
 * The name exists for the annotation, not for the type: `OrderByFor<'Observation'>`
 * is exactly `FindManyArgs<'Observation'>['orderBy']`. What the annotation buys
 * is excess-property checking, and nothing else here does. Every property of a
 * generated ordering argument is optional, so `[{ effectiveAtTYPO: 'desc' }]` is
 * structurally assignable and the compiler has nothing to say about it - and a
 * misspelled sort column is not a wrong page, it is an unordered one, which no
 * HTTP test sees because the memory port sorts with `sortValue` instead.
 *
 * Freshness only survives to a property written directly into a literal, so this
 * works for `orderBy`, whose fifty-four bodies contain no spread, and would not
 * work for `where`, whose bodies are almost entirely
 * `...(query.x === undefined ? {} : { x: query.x })`. That half is checked
 * against `schema.prisma` at run time instead, in
 * `repositories.port-agreement.test.ts`, and that check covers this one too.
 */
export type OrderByFor<M extends PrismaModelName> = FindManyArgs<M>['orderBy'];

/** A value that carries a `toNumber`, which is how a Decimal presents itself. */
interface DecimalLike {
  toNumber(): number;
}

type Plain<T> = T extends DecimalLike ? number : T;

/** The API's view of a stored row: the Prisma record with Decimals flattened. */
export type Row<M extends PrismaModelName> = {
  [K in keyof ModelRecord<M>]: Plain<ModelRecord<M>[K]>;
};

/**
 * The four columns every tenant-scoped model carries.
 *
 * Intersected into {@link ScopedRow} so generic code can read `row.tenantId`
 * without the compiler having to prove, for an unresolved model parameter,
 * that the column exists. Every model this API touches really does carry all
 * four, per the conventions at the top of `schema.prisma`, so the intersection
 * narrows nothing at runtime and only restores a fact the generics lost.
 */
export interface StorageRow {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A stored row as generic code sees it. */
export type ScopedRow<M extends PrismaModelName> = Row<M> & StorageRow;

/**
 * Duck-types a Decimal rather than importing the class.
 *
 * Importing `Prisma` as a value would pull the generated client into every
 * module that touches a row, including the test suite, which is meant to run
 * with no database driver anywhere in its graph. A `toNumber` method on a
 * non-Date object is a precise enough signal, and the alternative - trusting a
 * hand-maintained list of decimal columns per model - is exactly the drift this
 * file exists to avoid.
 */
function isDecimalLike(value: unknown): value is DecimalLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  );
}

/** Projects a stored record onto its row type, flattening Decimal columns. */
export function toPlainRow<M extends PrismaModelName>(record: ModelRecord<M>): Row<M> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    result[key] = isDecimalLike(value) ? value.toNumber() : value;
  }
  return result as Row<M>;
}

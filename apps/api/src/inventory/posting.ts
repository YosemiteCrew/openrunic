import {
  courseTotal,
  exactlyThisManyStockUnits,
  movementProblems,
  type Course,
  type DispensedQuantity,
  type StockMovement as PackageMovement,
} from '@openrunic/inventory';

import { ApiError } from '../errors.js';

/**
 * THE DOOR EVERY LEDGER LINE GOES THROUGH.
 *
 * `movementProblems` explains what is wrong with a movement in a sentence a
 * person can act on, and it is the package's own instruction that it be called
 * before posting rather than on read: the ledger is append-only, so an invalid
 * row cannot be taken back out. It can only be compensated, which leaves two
 * confusing rows where there should have been none.
 *
 * What this file adds is that forgetting to call it is a compile error rather
 * than a review comment. {@link PostableMovement} is a branded type, the brand
 * is unforgeable outside this module, and the repository spec that writes the
 * rows will not accept anything else.
 */

declare const POSTABLE: unique symbol;

/**
 * A movement that has been checked, and the only thing the ledger accepts.
 *
 * The brand exists at the type level and erases at runtime, exactly like the
 * package's own `DispensedQuantity`. It is not the enforcement - the append-only
 * grant on the table is - and it is not a claim that the row will be accepted by
 * Postgres. It is the narrower and more useful claim that no code path in this
 * repository reaches the movement table holding something nobody validated.
 */
export type PostableMovement = PackageMovement & { readonly [POSTABLE]: true };

/**
 * Checks a movement, or refuses it with one field issue per problem.
 *
 * A 422 naming `lines.<n>` is a better answer than a driver error naming a
 * constraint, because the person who has to fix it is looking at a line on a
 * screen rather than at a table. The index is the caller's, since only the
 * caller knows which of its lines this was.
 */
export function assertPostable(movement: PackageMovement, line: number): PostableMovement {
  const problems = movementProblems(movement);
  if (problems.length > 0) {
    throw ApiError.validation(
      'One of the stock movements in this posting is not valid.',
      problems.map((message) => ({ path: `lines.${String(line)}`, message }))
    );
  }
  return movement as PostableMovement;
}

/**
 * The only two ways a dispensed quantity comes into existence here.
 *
 * Both package functions throw a `RangeError` on a figure they will not brand -
 * a negative course, a `NaN`, a magnitude too large to carry at six decimal
 * places - and the generic error boundary would render that as a bare 500 whose
 * body says nothing. The fault is in the request, so it is reported as one,
 * naming the field the client sent.
 *
 * Exactly one of `course` and `quantity` is present; the route's schema is what
 * proves that, because "twenty tablets" and "one tablet twice daily for ten
 * days" are the same twenty and a body carrying both is a client that does not
 * know which it means.
 */
export function dispensedQuantity(
  input:
    | { readonly course: Course; readonly quantity?: undefined }
    | { readonly course?: undefined; readonly quantity: number }
): DispensedQuantity {
  try {
    return input.course === undefined
      ? exactlyThisManyStockUnits(input.quantity)
      : courseTotal(input.course);
  } catch (error) {
    throw ApiError.validation('The dispensed quantity is not usable.', [
      { path: input.course === undefined ? 'quantity' : 'course', message: causeText(error) },
    ]);
  }
}

/**
 * What a caught throw says, for a field issue.
 *
 * `catch` binds `unknown` because JavaScript permits throwing anything, and the
 * two inventory call sites both turn a package `RangeError` into a 422 that
 * quotes it. Written once so the non-Error arm - which nothing in the package
 * produces today and which a future dependency might - reads the same in both
 * places rather than being reinvented as an empty message.
 */
export function causeText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

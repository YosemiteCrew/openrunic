/**
 * Reading a number out of a text field, safely.
 *
 * `Number('')` is `0` and `Number('1e')` is `NaN`, and coercing an input's
 * value straight into state ships both of those as if they were amounts a
 * person typed. On a billing screen that is money: a `NaN` allocation makes the
 * remaining balance unreadable, and it reaches the request body looking like a
 * figure somebody chose.
 *
 * An emptied box means nothing is entered, which for a quantity or an
 * allocation is a real, useful answer: zero. A half-typed value is not an
 * answer at all, so it is reported as `null` and the caller keeps the last
 * value the field was known to hold.
 */
export function numericFieldValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

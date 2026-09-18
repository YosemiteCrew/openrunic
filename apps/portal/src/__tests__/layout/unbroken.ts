/**
 * The input this suite is about, and the walk that puts it everywhere it can go.
 *
 * Not a test file: the unit suite collects `__tests__/**\/*.test.{ts,tsx}` and this is a
 * helper beside the layout tests that use it.
 */

/**
 * One run with no break opportunity in it - no space, no hyphen, no punctuation a browser
 * may break after.
 *
 * 256 characters because that is the longest the product accepts: `appointments.ts` bounds
 * `reasonText` and `cancelReason` at `max(256)`, and bounds neither's word breaks. So this
 * is the worst case a valid write can produce rather than an invented one. A single repeated
 * letter keeps it obviously synthetic.
 */
export const UNBROKEN_RUN = 'M'.repeat(256);

/**
 * Enough of the run to identify it in the DOM. A test asserts on this rather than on the
 * whole string so a match survives the text being wrapped, split across lines or truncated
 * by an assertion helper's normaliser.
 */
export const UNBROKEN_MARK = 'M'.repeat(32);

export interface Stuffed<T> {
  /** The graph with every printable string replaced. */
  readonly value: T;
  /** How many strings were replaced. */
  readonly mutated: number;
  /** The strings that were left alone, so a test can assert on what it is skipping. */
  readonly exempt: readonly string[];
}

/**
 * The one shape in this graph that is parsed rather than printed.
 *
 * `Money.currency` reaches `new Intl.NumberFormat(locale, { style: 'currency', currency })`
 * in `lib/format.ts`, which throws RangeError unless the code is three ASCII letters. A run
 * there ends the render before any layout happens, so the screen under test would report an
 * error boundary rather than a width.
 *
 * Nothing else needs skipping, and that is a property of the code rather than an assumption:
 * a mutated ISO instant does not throw, because `formatted()` returns its input unchanged
 * when `new Date(...)` is invalid, and a mutated enum selects the other branch of a
 * comparison. Both then render as text, which is what this suite wants of them.
 *
 * Keyed on the shape of the value, never on a field name, so a currency added anywhere in
 * the graph is skipped without an edit here. `unbroken.layout.test.tsx` asserts both halves:
 * that the throw is real, and that nothing but a currency code is being skipped.
 */
function isParsedStrictly(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/**
 * Replaces every printable string in a graph with {@link UNBROKEN_RUN}.
 *
 * The population is the graph itself, not a list of fields: a new free-text field on a portal
 * DTO is stuffed the day it is added, without anyone remembering to add it here. That is the
 * whole point of walking rather than naming - #501 was found twice, at two sites, and a
 * hand-maintained list is what let the second one through.
 */
export function stuffEveryString<T>(input: T): Stuffed<T> {
  let mutated = 0;
  const exempt: string[] = [];

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (isParsedStrictly(value)) {
        exempt.push(value);
        return value;
      }
      mutated += 1;
      return UNBROKEN_RUN;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    }
    return value;
  };

  return { value: walk(input) as T, mutated, exempt };
}

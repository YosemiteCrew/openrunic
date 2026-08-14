/**
 * Trailing-slash normalisation for base URLs.
 *
 * Deliberately not a regular expression. The obvious spelling, `value.replace(/\/+$/, '')`,
 * is anchored at the end but not at the start, so the engine retries the `\/+` run from every
 * position in the string: an input of n slashes costs O(n^2). Base URLs arrive from
 * configuration and from callers of this package, so the input is not ours to trust, and
 * CodeQL flags the pattern (`js/polynomial-redos`) for exactly that reason.
 *
 * A backwards scan is linear, allocation-free until the final slice, and easier to read than
 * the regex it replaces.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

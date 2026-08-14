/**
 * Reading a capture group out of a regex match.
 *
 * `noUncheckedIndexedAccess` types every `match[n]` as possibly undefined, so
 * each read needs a fallback. Written inline that is twenty `?? ''` fragments
 * across the linter, every one of them a branch that can never be taken when
 * the pattern matched - which quietly drags branch coverage down and hides the
 * branches that DO matter behind noise.
 *
 * One helper instead, tested once, on purpose.
 */
export function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}

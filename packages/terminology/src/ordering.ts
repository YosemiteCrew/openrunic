import { MAX_PAGE_SIZE } from './service.js';
import type { TerminologyConcept } from './service.js';

/**
 * Ordering and paging, defined once because two implementations have to agree.
 *
 * A picker that reshuffles its rows between a cached run and a database-backed
 * run is a bug a clinician notices and nobody can reproduce, and an expansion
 * whose order is incidental cannot be paged at all: page two would overlap page
 * one. So both sort keys are written down here, both are total (they end in
 * `version`, which completes the identity `(system, code, version)` the schema's
 * unique key uses), and both implementations run these comparators over the rows
 * they fetched rather than trusting whatever order they arrived in.
 *
 * One honest caveat, which the README repeats: JavaScript compares strings by
 * UTF-16 code unit, Postgres compares them under the database collation. For
 * the ASCII alphanumeric displays that code systems actually publish the two
 * agree; for mixed case and punctuation under a locale-aware collation they can
 * differ at the margins. A deployment that needs byte-identical ordering
 * between the two implementations should give the `display` column the `C`
 * collation.
 */

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Expansion order: system, then display, then code, then version.
 *
 * System leads because an expansion that spans systems reads as grouped
 * sections rather than an interleaved list, and because the single-rule fast
 * path in the store implementation has a constant system, which makes this key
 * a straight range scan on the `[tenantId, system, display]` index.
 */
export function compareExpansionOrder(a: TerminologyConcept, b: TerminologyConcept): number {
  return (
    compareStrings(a.system, b.system) ||
    compareStrings(a.display, b.display) ||
    compareStrings(a.code, b.code) ||
    compareStrings(a.version, b.version)
  );
}

/**
 * Search order within a match bucket: display, then system, then code, then
 * version. Display leads because a picker is read alphabetically, and a search
 * that spans systems should not bury the best match under a system heading.
 */
export function compareSearchOrder(a: TerminologyConcept, b: TerminologyConcept): number {
  return (
    compareStrings(a.display, b.display) ||
    compareStrings(a.system, b.system) ||
    compareStrings(a.code, b.code) ||
    compareStrings(a.version, b.version)
  );
}

/** The separator {@link conceptKey} joins on. See that function for why it is not printable. */
export const CONCEPT_KEY_SEPARATOR = '\u0000';

/**
 * Identity of a concept for de-duplication, matching the schema's
 * `@@unique([tenantId, system, code, version])`.
 *
 * The three parts are joined on NUL rather than a printable separator because
 * all three are publisher-controlled: any visible character could turn up
 * inside a system URI, a code or a version label, and would then let two
 * different identities collide on one key. NUL cannot appear in any of them.
 */
export function conceptKey(concept: TerminologyConcept): string {
  return [concept.system, concept.code, concept.version].join(CONCEPT_KEY_SEPARATOR);
}

/**
 * Clamps a caller's page size into `[1, MAX_PAGE_SIZE]`.
 *
 * Clamping rather than rejecting: a picker asking for zero rows or for a
 * million is a UI mistake, and answering with a sensible page is more useful
 * than an error the screen has no way to render. Non-integers and non-finite
 * values fall back to the caller's default for the same reason.
 */
export function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE_SIZE);
}

/** Clamps a caller's offset to a non-negative integer, for the same reason as {@link clampLimit}. */
export function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(offset));
}

/** Case-insensitive substring test, the matching rule both `filter` and `search` use. */
export function displayContains(display: string, query: string): boolean {
  return display.toLowerCase().includes(query.toLowerCase());
}

/** Case-insensitive prefix test. Prefix matches are what rank a search result to the top. */
export function displayStartsWith(display: string, query: string): boolean {
  return display.toLowerCase().startsWith(query.toLowerCase());
}

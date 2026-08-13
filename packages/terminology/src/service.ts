import type { Result } from '@openrunic/types';

/**
 * The terminology contract: the four questions the rest of Openrunic asks about
 * a coded value, stated once so that every implementation of them is
 * interchangeable.
 *
 * The contract exists because coded data is stored as opaque strings. A
 * `Condition` row carries `code` and `codeSystem` and nothing else, which is
 * what keeps the schema free of licensed content and lets a deployment load
 * only the systems it is licensed for. The cost of that decision is that a
 * string alone cannot render a problem list, populate a picker, or refuse a
 * typo. This package is where that cost is paid, in one place, behind an
 * interface narrow enough that a chart screen, an API handler and a test can
 * all use the same four operations.
 *
 * Three properties hold for every implementation, and the shared contract suite
 * in `test-support/contract.ts` enforces them:
 *
 *   1. **Expected failure is data, not an exception.** A missing code, an
 *      unconfigured value set and an oversized expansion are all ordinary
 *      outcomes of a clinician typing something; they come back as a typed
 *      `TerminologyError` in the failure arm of a `Result`.
 *   2. **A refusal carries its reason.** `validate` never answers a bare
 *      `false`. The caller has to render "that code is retired" differently
 *      from "that code is not on this order form", so the verdict names which
 *      one happened and carries a sentence a clinician can read.
 *   3. **Order is defined, never incidental.** Both expansion and search state
 *      their sort key, so a picker does not reshuffle between a cached in-memory
 *      run and a database-backed one, and paging is stable.
 *
 * Every operation is asynchronous, including the in-memory one. A caller that
 * can only await the database-backed implementation must be able to swap in the
 * in-memory one without changing a line.
 */

/**
 * One resolved code, the shape every operation returns.
 *
 * This mirrors the columns of the `TerminologyCode` table that carry meaning,
 * and deliberately omits `id`, `tenantId` and the timestamps: a caller
 * rendering a problem list has no use for a surrogate key, and leaving the
 * tenant out means a concept can never be logged into the wrong place.
 *
 * `version` is `''` for a system loaded without a release label, matching the
 * column default, so `(system, code, version)` is always a complete identity.
 */
export interface TerminologyConcept {
  readonly system: string;
  readonly code: string;
  readonly display: string;
  readonly version: string;
  /** The code one level up in the publisher's hierarchy, when it has one. */
  readonly parentCode: string | null;
  /** False once a publisher retires a code. Retired codes stay loaded: a note written in 2019 still cites them. */
  readonly isActive: boolean;
  /** Publisher-specific extras from the load file, passed through untouched. */
  readonly properties: Readonly<Record<string, unknown>> | null;
}

/** No code from this system has been loaded into this deployment at all. */
export interface SystemNotFoundError {
  readonly kind: 'system_not_found';
  readonly system: string;
  readonly message: string;
}

/** The system is loaded but does not contain this code, so `lookup` has nothing to return. */
export interface CodeNotFoundError {
  readonly kind: 'code_not_found';
  readonly system: string;
  readonly code: string;
  /** The version the caller asked for, or null when it asked for the newest. */
  readonly version: string | null;
  readonly message: string;
}

/** A value set was named that this deployment has no definition for: a configuration bug, not a clinician's mistake. */
export interface ValueSetNotFoundError {
  readonly kind: 'value_set_not_found';
  readonly valueSet: string;
  readonly message: string;
}

/**
 * The value set has more members than an expansion is allowed to materialize.
 * Refusing is kinder than serving a picker with fifty thousand rows in it or
 * holding an entire code system in memory to answer one keystroke.
 */
export interface ExpansionTooLargeError {
  readonly kind: 'expansion_too_large';
  readonly valueSet: string;
  readonly limit: number;
  readonly message: string;
}

/** The backing store refused or failed. Surfaced as data so a chart screen can degrade instead of crashing. */
export interface StoreUnavailableError {
  readonly kind: 'store_unavailable';
  readonly message: string;
}

/** Every way a terminology operation can fail, discriminated on `kind`. */
export type TerminologyError =
  | SystemNotFoundError
  | CodeNotFoundError
  | ValueSetNotFoundError
  | ExpansionTooLargeError
  | StoreUnavailableError;

/** Builds {@link SystemNotFoundError} so the wording is identical whichever implementation raised it. */
export function systemNotFound(system: string): SystemNotFoundError {
  return {
    kind: 'system_not_found',
    system,
    message: `Code system ${system} is not loaded in this deployment.`,
  };
}

/** Builds {@link CodeNotFoundError}, naming the requested version when the caller pinned one. */
export function codeNotFound(
  system: string,
  code: string,
  version: string | null
): CodeNotFoundError {
  const at = version === null ? '' : ` at version ${version}`;
  return {
    kind: 'code_not_found',
    system,
    code,
    version,
    message: `Code ${code} was not found in ${system}${at}.`,
  };
}

/** Builds {@link ValueSetNotFoundError}. */
export function valueSetNotFound(valueSet: string): ValueSetNotFoundError {
  return {
    kind: 'value_set_not_found',
    valueSet,
    message: `Value set ${valueSet} is not configured in this deployment.`,
  };
}

/** Builds {@link ExpansionTooLargeError}, naming the cap so the operator knows which knob to turn. */
export function expansionTooLarge(valueSet: string, limit: number): ExpansionTooLargeError {
  return {
    kind: 'expansion_too_large',
    valueSet,
    limit,
    message: `Value set ${valueSet} has more than ${limit} members; narrow its rules or raise maxExpansionSize.`,
  };
}

/** Wraps whatever the store threw. The cause is stringified because a rejected promise can carry anything. */
export function storeUnavailable(cause: unknown): StoreUnavailableError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    kind: 'store_unavailable',
    message: `The terminology store did not answer: ${detail}`,
  };
}

/** Why `validate` refused a code. Each value maps to a different sentence in the UI. */
export type ValidationReason =
  'system_not_known' | 'code_not_found' | 'code_inactive' | 'not_in_value_set';

/** The accepting arm of {@link ValidationVerdict}: the resolved concept comes back so the caller can store its display. */
export interface ValidCodeVerdict {
  readonly valid: true;
  readonly concept: TerminologyConcept;
}

/** The refusing arm of {@link ValidationVerdict}. */
export interface InvalidCodeVerdict {
  readonly valid: false;
  readonly reason: ValidationReason;
  /** A sentence written for a clinician, not a stack trace. */
  readonly message: string;
  /** Set when the code resolved but failed a later check, so the UI can still show what was typed. */
  readonly concept: TerminologyConcept | null;
}

/** The structured answer to "may I record this code here?", narrowed on `valid`. */
export type ValidationVerdict = ValidCodeVerdict | InvalidCodeVerdict;

/** Arguments for {@link TerminologyService.lookup}. */
export interface LookupRequest {
  readonly system: string;
  readonly code: string;
  /** Omit to resolve the newest loaded release of the code. */
  readonly version?: string;
}

/** Arguments for {@link TerminologyService.validate}. */
export interface ValidateRequest {
  readonly system: string;
  readonly code: string;
  readonly version?: string;
  /** Canonical URL of the value set the code has to belong to, when the field is bound to one. */
  readonly valueSet?: string;
  /**
   * Accept a retired code. Set it when re-validating historical data: a note
   * written years ago legitimately cites a code the publisher has since pulled,
   * and rejecting it would make old records unopenable.
   */
  readonly allowInactive?: boolean;
}

/** Arguments for {@link TerminologyService.expandValueSet}. */
export interface ExpandValueSetRequest {
  readonly valueSet: string;
  /** Case-insensitive substring of the display, for a picker's type-ahead box. */
  readonly filter?: string;
  readonly offset?: number;
  readonly limit?: number;
}

/** One page of a value set's members, plus the total so a picker can render "showing 20 of 340". */
export interface ValueSetExpansion {
  readonly valueSet: string;
  readonly total: number;
  readonly offset: number;
  readonly concepts: readonly TerminologyConcept[];
}

/** Arguments for {@link TerminologyService.search}. */
export interface SearchRequest {
  /** Scope to one system whenever the caller knows it: it turns a tenant-wide scan into an index range scan. */
  readonly system?: string;
  readonly query: string;
  readonly limit?: number;
  /** Include retired codes. Off by default, because a picker should not offer a code that cannot be used. */
  readonly includeInactive?: boolean;
}

/** Page size a request gets when it does not ask for one. Sized for a drop-down, not a report. */
export const DEFAULT_SEARCH_LIMIT = 20;

/** Page size an expansion gets when it does not ask for one. */
export const DEFAULT_EXPANSION_LIMIT = 100;

/** Hard ceiling on any page. A caller that wants everything has to page for it, so one request can never pin the process. */
export const MAX_PAGE_SIZE = 1000;

/**
 * How many members an expansion will materialize before refusing.
 * Ten thousand is comfortably above every hand-built local value set and
 * comfortably below "somebody pointed this at an entire code system".
 */
export const DEFAULT_MAX_EXPANSION_SIZE = 10_000;

/**
 * The four operations, and the whole surface any consumer should depend on.
 *
 * Callers take this interface, never a concrete implementation, which is what
 * lets a test run against in-memory data and production run against Postgres
 * with the same code path.
 */
export interface TerminologyService {
  /**
   * Resolves one code to its display, status, parent and properties.
   *
   * A missing code is a typed failure rather than `undefined`, because the two
   * reasons a lookup comes back empty need different handling: an unknown
   * system means the deployment has not loaded the content, which is an
   * operator's problem, while an unknown code means somebody typed it wrong.
   */
  lookup(request: LookupRequest): Promise<Result<TerminologyConcept, TerminologyError>>;

  /**
   * Answers whether a code may be recorded, and when it may not, why.
   *
   * The failure arm is reserved for deployment faults (an unconfigured value
   * set, an unreachable store). Everything a clinician can cause comes back as
   * a refusing verdict, because the caller has to render it rather than log it.
   */
  validate(request: ValidateRequest): Promise<Result<ValidationVerdict, TerminologyError>>;

  /** Materializes a page of a value set's members in a defined order. */
  expandValueSet(
    request: ExpandValueSetRequest
  ): Promise<Result<ValueSetExpansion, TerminologyError>>;

  /**
   * Finds concepts by display text for a picker. Prefix matches rank ahead of
   * substring matches, because a clinician who has typed three characters is
   * almost always starting a word.
   */
  search(request: SearchRequest): Promise<Result<readonly TerminologyConcept[], TerminologyError>>;
}

import type { IssueCode } from '@openrunic/fhir';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * The R4 `issue-type` value set.
 *
 * Taken from `packages/fhir`'s union rather than from the `OperationOutcome`
 * type, where `@types/fhir` declares `issue.code` as a bare `string`. Reading it
 * off the resource type therefore bought no safety at all: a typo such as
 * `not-suported` compiled, and reached a client as a code no value set defines.
 */
export type FhirIssueCode = IssueCode;

/**
 * The one error type every layer of the API throws.
 *
 * A handler, a repository or a middleware raises an `ApiError`; the single
 * `onError` hook in `app.ts` renders it either as an RFC 9457 problem document
 * (internal routes) or as a FHIR `OperationOutcome` (the FHIR boundary). No
 * layer below the renderer knows which representation it will end up as, so the
 * two surfaces cannot drift into reporting different statuses for the same
 * failure.
 */

/**
 * Machine-readable failure kinds. These are the stable half of the contract:
 * clients branch on `type`, and the human-readable `title` and `detail` may be
 * reworded without breaking anyone.
 */
export const PROBLEM_KINDS = [
  'malformed-request',
  'unauthenticated',
  'forbidden',
  'not-found',
  'conflict',
  /**
   * A state machine refused the move. Separate from `conflict` because a
   * client can act on it: the body names the state the record is in and the
   * states it could go to, so a UI can re-render its buttons instead of
   * retrying a request that will never succeed.
   */
  'invalid-transition',
  'validation-failed',
  'not-implemented',
  'internal-error',
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** HTTP status per failure kind. The mapping lives here and nowhere else. */
const STATUS_BY_KIND: Record<ProblemKind, ContentfulStatusCode> = {
  'malformed-request': 400,
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  'invalid-transition': 409,
  'validation-failed': 422,
  'not-implemented': 501,
  'internal-error': 500,
};

/** Default title per failure kind, overridable per throw site. */
const TITLE_BY_KIND: Record<ProblemKind, string> = {
  'malformed-request': 'Malformed request',
  unauthenticated: 'Authentication required',
  forbidden: 'Not permitted',
  'not-found': 'Not found',
  conflict: 'Conflict',
  'invalid-transition': 'Invalid state transition',
  'validation-failed': 'Validation failed',
  'not-implemented': 'Not implemented',
  'internal-error': 'Internal error',
};

/** One field-level complaint, addressed by a dotted path into the payload. */
export interface FieldIssue {
  /** Dotted path, e.g. `birthDate` or `coverages.0.memberId`. Empty at the root. */
  path: string;
  message: string;
}

export interface ApiErrorOptions {
  title?: string;
  detail?: string;
  issues?: readonly FieldIssue[];
  /**
   * Overrides the FHIR issue code. Defaults are derived from the kind; the
   * override exists for cases FHIR distinguishes but HTTP does not, such as an
   * unsupported search parameter (400 + `not-supported` rather than 400 +
   * `invalid`).
   */
  fhirIssueCode?: FhirIssueCode;
}

export class ApiError extends Error {
  readonly kind: ProblemKind;
  readonly status: ContentfulStatusCode;
  readonly title: string;
  readonly detail: string;
  readonly issues: readonly FieldIssue[];
  readonly fhirIssueCode: FhirIssueCode;

  constructor(kind: ProblemKind, options: ApiErrorOptions = {}) {
    const title = options.title ?? TITLE_BY_KIND[kind];
    super(options.detail ?? title);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = STATUS_BY_KIND[kind];
    this.title = title;
    this.detail = options.detail ?? title;
    this.issues = options.issues ?? [];
    this.fhirIssueCode = options.fhirIssueCode ?? DEFAULT_FHIR_ISSUE_CODE[kind];
  }

  static malformed(detail: string, options: ApiErrorOptions = {}): ApiError {
    return new ApiError('malformed-request', { ...options, detail });
  }

  static unauthenticated(detail: string, options: ApiErrorOptions = {}): ApiError {
    return new ApiError('unauthenticated', { ...options, detail });
  }

  static forbidden(detail: string, options: ApiErrorOptions = {}): ApiError {
    return new ApiError('forbidden', { ...options, detail });
  }

  static notFound(detail: string, options: ApiErrorOptions = {}): ApiError {
    return new ApiError('not-found', { ...options, detail });
  }

  static conflict(detail: string, options: ApiErrorOptions = {}): ApiError {
    return new ApiError('conflict', { ...options, detail });
  }

  static validation(
    detail: string,
    issues: readonly FieldIssue[],
    options: ApiErrorOptions = {}
  ): ApiError {
    return new ApiError('validation-failed', { ...options, detail, issues });
  }

  static notImplemented(detail: string, options: ApiErrorOptions = {}): ApiError {
    return new ApiError('not-implemented', { ...options, detail });
  }

  /**
   * A refused state transition, reported with the states involved.
   *
   * The allowed set is part of the body rather than only the prose, because
   * the caller that gets this is a screen with buttons on it, and "which
   * buttons should have been there" is the actionable half of the answer.
   */
  static invalidTransition(options: {
    subject: string;
    from: string;
    to: string;
    allowed: readonly string[];
  }): ApiError {
    const allowed =
      options.allowed.length === 0
        ? 'nothing'
        : [...options.allowed].sort((a, b) => a.localeCompare(b)).join(', ');
    return new ApiError('invalid-transition', {
      detail: `A ${options.subject} in ${options.from} cannot move to ${options.to}. It can move to: ${allowed}.`,
      issues: [{ path: 'status', message: `expected one of ${allowed}` }],
    });
  }
}

/**
 * FHIR `issue.code` per failure kind, from the R4 `issue-type` value set.
 *
 * `unauthenticated` maps to `login` rather than `security` because that is what
 * the SMART/US Core test kits assert on; `validation-failed` maps to
 * `invariant` because a 422 here always means the payload parsed but broke a
 * rule.
 */
const DEFAULT_FHIR_ISSUE_CODE: Record<ProblemKind, FhirIssueCode> = {
  'malformed-request': 'invalid',
  unauthenticated: 'login',
  forbidden: 'forbidden',
  'not-found': 'not-found',
  conflict: 'duplicate',
  'invalid-transition': 'business-rule',
  'validation-failed': 'invariant',
  'not-implemented': 'not-supported',
  'internal-error': 'exception',
};

/** True when `value` is an {@link ApiError}, across realm boundaries. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

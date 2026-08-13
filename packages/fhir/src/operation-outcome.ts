/// <reference types="fhir" preserve="true" />

import { codeableConcept, compact, isPresentString, present } from './primitives.js';

/** FHIR R4 issue severity. */
export type IssueSeverity = 'fatal' | 'error' | 'warning' | 'information';

/**
 * The R4 `IssueType` value set. It is closed and frozen by the specification,
 * so it is spelled out here rather than left as a string: a typo in an error
 * path is exactly the kind of bug that ships unnoticed.
 */
export type IssueCode =
  | 'invalid'
  | 'structure'
  | 'required'
  | 'value'
  | 'invariant'
  | 'security'
  | 'login'
  | 'unknown'
  | 'expired'
  | 'forbidden'
  | 'suppressed'
  | 'processing'
  | 'not-supported'
  | 'duplicate'
  | 'multiple-matches'
  | 'not-found'
  | 'deleted'
  | 'too-long'
  | 'code-invalid'
  | 'extension'
  | 'too-costly'
  | 'business-rule'
  | 'conflict'
  | 'transient'
  | 'lock-error'
  | 'no-store'
  | 'exception'
  | 'timeout'
  | 'incomplete'
  | 'throttled'
  | 'informational';

/** One issue in an {@link OperationOutcome}. */
export interface OutcomeIssue {
  severity: IssueSeverity;
  code: IssueCode;
  /** Human-readable detail. Never put PHI here: outcomes are widely logged. */
  diagnostics?: string;
  /** FHIRPath expressions locating the problem, e.g. `Patient.birthDate`. */
  expression?: readonly string[];
  /** Additional coded detail. */
  detailsText?: string;
  detailsCode?: string;
  detailsSystem?: string;
}

const FALLBACK_ISSUE: OutcomeIssue = {
  severity: 'error',
  code: 'processing',
  diagnostics: 'Unspecified processing error.',
};

function toIssue(issue: OutcomeIssue): fhir4.OperationOutcomeIssue {
  return compact<fhir4.OperationOutcomeIssue>({
    severity: issue.severity,
    code: issue.code,
    details: codeableConcept({
      system: issue.detailsSystem,
      code: issue.detailsCode,
      text: issue.detailsText,
    }),
    diagnostics: issue.diagnostics,
    expression: issue.expression ? [...issue.expression].filter(isPresentString) : undefined,
  });
}

/**
 * Builds an `OperationOutcome`. `issue` is 1..* in FHIR, so an empty list
 * yields one generic processing issue rather than an invalid resource.
 */
export function operationOutcome(issues: readonly OutcomeIssue[]): fhir4.OperationOutcome {
  const list = issues.length > 0 ? issues : [FALLBACK_ISSUE];
  return {
    resourceType: 'OperationOutcome',
    issue: list.map(toIssue),
  };
}

/** 404: the resource type is served but the instance does not exist. */
export function notFound(resourceType: string, id?: string): fhir4.OperationOutcome {
  const target = isPresentString(id) ? `${resourceType}/${id}` : resourceType;
  return operationOutcome([
    { severity: 'error', code: 'not-found', diagnostics: `${target} was not found.` },
  ]);
}

/** 400: the request is syntactically or structurally wrong. */
export function invalid(
  diagnostics: string,
  expression?: readonly string[]
): fhir4.OperationOutcome {
  const issue: OutcomeIssue = { severity: 'error', code: 'invalid', diagnostics };
  if (expression !== undefined) {
    issue.expression = expression;
  }
  return operationOutcome([issue]);
}

/** 400: a required element or parameter is missing. */
export function required(element: string): fhir4.OperationOutcome {
  return operationOutcome([
    {
      severity: 'error',
      code: 'required',
      diagnostics: `${element} is required.`,
      expression: [element],
    },
  ]);
}

/** 403: authenticated, but the policy layer refused. */
export function forbidden(diagnostics: string): fhir4.OperationOutcome {
  return operationOutcome([{ severity: 'error', code: 'forbidden', diagnostics }]);
}

/** 401: no usable credential was presented. */
export function loginRequired(diagnostics = 'Authentication is required.'): fhir4.OperationOutcome {
  return operationOutcome([{ severity: 'error', code: 'login', diagnostics }]);
}

/** 404 or 400: the interaction itself is not implemented. */
export function notSupported(diagnostics: string): fhir4.OperationOutcome {
  return operationOutcome([{ severity: 'error', code: 'not-supported', diagnostics }]);
}

/**
 * 400 for a search parameter the server does not implement. Openrunic
 * implements the US Core must-support parameters against relational columns and
 * rejects everything else rather than silently ignoring it, which is the
 * failure mode that makes FHIR search untrustworthy.
 */
export function unsupportedSearchParameter(
  resourceType: string,
  name: string
): fhir4.OperationOutcome {
  return operationOutcome([
    {
      severity: 'error',
      code: 'not-supported',
      diagnostics: `Search parameter '${name}' is not supported for ${resourceType}.`,
    },
  ]);
}

/** 409: the write lost an optimistic-locking race. */
export function conflict(diagnostics: string): fhir4.OperationOutcome {
  return operationOutcome([{ severity: 'error', code: 'conflict', diagnostics }]);
}

/** 500: an unexpected failure, with no internal detail leaked. */
export function exception(
  diagnostics = 'The server encountered an unexpected condition.'
): fhir4.OperationOutcome {
  return operationOutcome([{ severity: 'fatal', code: 'exception', diagnostics }]);
}

/** True when a resource is an `OperationOutcome` carrying an error or worse. */
export function hasError(outcome: fhir4.OperationOutcome): boolean {
  return present(outcome.issue ?? []).some(
    (issue) => issue.severity === 'error' || issue.severity === 'fatal'
  );
}

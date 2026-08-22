import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError, isApiError, PROBLEM_KINDS } from '../errors.js';
import { toOperationOutcome } from '../http/fhir.js';
import { problemDocumentSchema, toProblemDocument } from '../http/problem.js';
import { toFieldIssues } from '../http/validate.js';

describe('ApiError', () => {
  it('maps every kind to exactly one status', () => {
    const statuses = PROBLEM_KINDS.map((kind) => new ApiError(kind).status);

    expect(statuses).toEqual([400, 401, 403, 404, 409, 409, 422, 501, 502, 500]);
  });

  it('maps every kind to a FHIR issue code', () => {
    expect(PROBLEM_KINDS.map((kind) => new ApiError(kind).fhirIssueCode)).toEqual([
      'invalid',
      'login',
      'forbidden',
      'not-found',
      'duplicate',
      'business-rule',
      'invariant',
      'not-supported',
      'transient',
      'exception',
    ]);
  });

  it('defaults detail to the title and carries an explicit detail through', () => {
    expect(new ApiError('not-found').detail).toBe('Not found');
    expect(ApiError.notFound('No such patient.').detail).toBe('No such patient.');
    expect(ApiError.notFound('No such patient.').message).toBe('No such patient.');
  });

  it('accepts a FHIR issue code override for cases HTTP cannot distinguish', () => {
    const error = ApiError.malformed('nope', { fhirIssueCode: 'not-supported' });

    expect(error.status).toBe(400);
    expect(error.fhirIssueCode).toBe('not-supported');
  });

  it('exposes every constructor helper', () => {
    expect(ApiError.unauthenticated('a').status).toBe(401);
    expect(ApiError.forbidden('a').status).toBe(403);
    expect(ApiError.conflict('a').status).toBe(409);
    expect(ApiError.notImplemented('a').status).toBe(501);
    expect(ApiError.validation('a', [{ path: 'x', message: 'y' }]).issues).toHaveLength(1);
  });

  it('recognises its own instances and nothing else', () => {
    expect(isApiError(ApiError.notFound('a'))).toBe(true);
    expect(isApiError(new Error('a'))).toBe(false);
    expect(isApiError('a')).toBe(false);
  });
});

describe('problem documents', () => {
  it('renders a document that satisfies its own published schema', () => {
    const document = toProblemDocument(
      ApiError.validation('bad', [{ path: 'mrn', message: 'required' }]),
      { instance: '/bff/v0/patients', requestId: 'req-1' }
    );

    expect(problemDocumentSchema.safeParse(document).success).toBe(true);
    expect(document).toEqual({
      type: 'https://openrunic.org/problems/validation-failed',
      title: 'Validation failed',
      status: 422,
      detail: 'bad',
      instance: '/bff/v0/patients',
      requestId: 'req-1',
      errors: [{ path: 'mrn', message: 'required' }],
    });
  });

  it('omits `errors` when there are no field issues', () => {
    const document = toProblemDocument(ApiError.notFound('gone'), {
      instance: '/x',
      requestId: 'req-2',
    });

    expect(document.errors).toBeUndefined();
  });
});

describe('OperationOutcome rendering', () => {
  it('emits one issue per field complaint plus the request id', () => {
    const outcome = toOperationOutcome(
      ApiError.validation('bad', [
        { path: 'identifier', message: 'an MRN is required' },
        { path: 'birthDate', message: 'expected a date' },
      ]),
      'req-3'
    );

    expect(outcome.issue).toHaveLength(3);
    expect(outcome.issue[0]).toEqual({
      severity: 'error',
      code: 'invariant',
      diagnostics: 'an MRN is required',
      expression: ['identifier'],
    });
    expect(outcome.issue[2]).toMatchObject({ severity: 'information', code: 'informational' });
  });

  it('omits `expression` for a root-level complaint', () => {
    const outcome = toOperationOutcome(
      ApiError.validation('bad', [{ path: '', message: 'x' }]),
      'r'
    );

    expect(outcome.issue[0]).not.toHaveProperty('expression');
  });

  it('emits a single issue when there are no field complaints', () => {
    const outcome = toOperationOutcome(ApiError.forbidden('nope'), 'req-4');

    expect(outcome.issue).toHaveLength(2);
    expect(outcome.issue[0]).toEqual({
      severity: 'error',
      code: 'forbidden',
      diagnostics: 'nope',
    });
  });
});

describe('toFieldIssues', () => {
  it('flattens a nested zod path into a dotted string', () => {
    const schema = z.object({ coverages: z.array(z.object({ memberId: z.string() })) });
    const result = schema.safeParse({ coverages: [{ memberId: 1 }] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toFieldIssues(result.error)[0]?.path).toBe('coverages.0.memberId');
  });
});

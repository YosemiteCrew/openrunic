import { ApiError } from '../client';
import type { ProblemDocument } from '../types';

/**
 * How every fixture-backed client answers.
 *
 * The four mock clients (core, chart, admin, billing) each had their own copy
 * of this, which meant the latency a demo sees and the shape of a 404 were
 * decided four times. They are decided once here, so a screen cannot learn a
 * different failure shape depending on which aggregate it reads.
 */

/** Latency, so loading states are visible in the browser but instant in tests. */
export const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 140;

export function settle<T>(value: T): Promise<T> {
  if (LATENCY_MS === 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/**
 * Runs a write and settles it the way the transport would.
 *
 * The refusals in a mock write - a 404 for an unknown id, a 409 for a move the
 * state machine forbids - are thrown, because that is how the rules read at the
 * point they are checked. Over HTTP a caller meets those as a rejected promise,
 * never as a synchronous throw, so this converts them once rather than asking
 * every method to remember.
 */
export function attempt<T>(run: () => T): Promise<T> {
  try {
    return settle(run());
  } catch (cause) {
    return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
  }
}

export function problem(
  status: number,
  title: string,
  detail: string,
  kind: string
): ProblemDocument {
  return {
    type: `https://openrunic.org/problems/${kind}`,
    title,
    status,
    detail,
    instance: '/bff/v0',
    requestId: 'mock-request',
  };
}

export function notFound(detail: string): ApiError {
  return new ApiError(detail, {
    kind: 'http',
    status: 404,
    problem: problem(404, 'Not found', detail, 'not-found'),
  });
}

export function conflict(detail: string): ApiError {
  return new ApiError(detail, {
    kind: 'http',
    status: 409,
    problem: problem(409, 'Conflict', detail, 'conflict'),
  });
}

export function validationFailed(detail: string, errors: readonly FieldIssue[]): ApiError {
  return new ApiError(detail, {
    kind: 'http',
    status: 422,
    problem: {
      ...problem(422, 'Validation failed', detail, 'validation-failed'),
      errors: [...errors],
    },
  });
}

/** One field-level complaint, addressed by a dotted path into the payload. */
export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * A refused state transition, worded exactly as the API words it.
 *
 * The allowed set is in the detail rather than only in the prose because the
 * caller is a screen with buttons on it, and "which buttons should have been
 * there" is the actionable half of the answer. Mirroring the sentence matters:
 * a screen that renders `problem.detail` must read the same in mock mode and
 * against Postgres, or mock mode stops being a rehearsal.
 */
export function invalidTransition(options: {
  subject: string;
  from: string;
  to: string;
  allowed: readonly string[];
}): ApiError {
  const allowed =
    options.allowed.length === 0
      ? 'nothing'
      : [...options.allowed].sort((a, b) => a.localeCompare(b)).join(', ');
  const detail = `A ${options.subject} in ${options.from} cannot move to ${options.to}. It can move to: ${allowed}.`;
  return new ApiError(detail, {
    kind: 'http',
    status: 409,
    problem: {
      ...problem(409, 'Invalid state transition', detail, 'invalid-transition'),
      errors: [{ path: 'status', message: `expected one of ${allowed}` }],
    },
  });
}

/**
 * Refuses a move the state machine does not allow, from the same table shape
 * the API keeps beside each aggregate.
 */
export function assertTransition<TState extends string>(
  table: Readonly<Record<TState, readonly TState[]>>,
  subject: string,
  from: TState,
  to: TState
): void {
  const allowed = table[from];
  if (!allowed.includes(to)) {
    throw invalidTransition({ subject, from, to, allowed });
  }
}

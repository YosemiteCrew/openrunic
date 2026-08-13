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

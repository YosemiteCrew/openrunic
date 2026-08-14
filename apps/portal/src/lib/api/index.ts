/**
 * Picks the data source. Mock is the default, so the portal renders, builds and tests with
 * no database and no API running.
 *
 * Set `NEXT_PUBLIC_API_MODE=live` and `NEXT_PUBLIC_API_URL` to talk to the real API.
 */

import { createHttpApi } from './http';
import { createMockApi } from './mock';
import type { PortalApi } from './types';

export type ApiMode = 'mock' | 'live';

/** Anything other than the exact string 'live' means mock; a typo must never leak data. */
export function resolveApiMode(value: string | undefined): ApiMode {
  return value === 'live' ? 'live' : 'mock';
}

export interface ApiEnv {
  mode?: string;
  baseUrl?: string;
}

/**
 * The build-time settings, read once as literal property accesses.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` only where it appears literally in
 * the source, so this cannot be a function that takes an environment object:
 * in the browser bundle there would be nothing left to read from.
 */
export const API_ENV: ApiEnv = {
  mode: process.env.NEXT_PUBLIC_API_MODE,
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
};

export function createPortalApi(env: ApiEnv = {}): PortalApi {
  if (resolveApiMode(env.mode) === 'live') {
    return createHttpApi({ baseUrl: env.baseUrl ?? '' });
  }
  return createMockApi();
}

let shared: PortalApi | undefined;

/**
 * The app's own instance. One per browser session so mock mutations persist across
 * navigations; screens accept an injected api in tests instead of reaching for this.
 */
export function getPortalApi(): PortalApi {
  shared ??= createPortalApi(API_ENV);
  return shared;
}

export { createHttpApi, HttpApiError } from './http';
export { createMockApi, MockDataError } from './mock';
export { buildEmptyFixtures, buildFixtures } from './fixtures';
export type * from './types';

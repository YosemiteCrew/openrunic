/**
 * Picks the data source. Mock is the default, so the portal renders, builds and tests with
 * no database and no API running.
 *
 * Set `NEXT_PUBLIC_API_MODE=live` to use the same-origin authenticated proxy.
 */

import { createHttpApi } from './http';
import { createMockApi } from './mock';
import type { PortalApi } from './types';
import { API_MODE, resolveApiMode } from './config';
import { returnToSignIn } from '@/lib/auth/client';

export interface ApiEnv {
  mode?: string;
}

/**
 * The build-time settings, read once as literal property accesses.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` only where it appears literally in
 * the source, so this cannot be a function that takes an environment object:
 * in the browser bundle there would be nothing left to read from.
 */
export const API_ENV: ApiEnv = {
  mode: API_MODE,
};

export function createPortalApi(env: ApiEnv = {}): PortalApi {
  if (resolveApiMode(env.mode) === 'live') {
    return createHttpApi({
      baseUrl: '/api',
      onUnauthorized: () => returnToSignIn('expired'),
    });
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
export { API_MODE, isLiveMode, resolveApiMode } from './config';
export type { ApiMode } from './config';
export type * from './types';

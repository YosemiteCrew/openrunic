import { createHttpClient } from './client';
import { API_CONFIG, API_MODE } from './config';
import { createMockClient } from './mock/client';
import type { ApiClient } from './types';

/**
 * The single client every screen reads through.
 *
 * Mode is resolved once, at module load, from `NEXT_PUBLIC_API_MODE`. Screens
 * never branch on it: both clients satisfy the same contract, so a screen that
 * renders against fixtures renders against Postgres unchanged.
 *
 * It lives in its own module rather than in `index.ts` so the hooks can import
 * it without a cycle through the barrel.
 */
export const api: ApiClient =
  API_MODE === 'mock' ? createMockClient() : createHttpClient(API_CONFIG);

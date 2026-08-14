import { createSessionAwareFetch } from '@/lib/auth/client';
import { currentAccessToken } from '@/lib/auth/store';

import type { ApiClientConfig } from './client';

/**
 * Runtime configuration for the data layer.
 *
 * `process.env.NEXT_PUBLIC_*` is read as a literal member expression on
 * purpose: Next inlines those at build time only when it can see the whole
 * expression, so `process.env[name]` would silently become undefined in the
 * browser bundle.
 */

export type ApiMode = 'live' | 'mock';

/**
 * Mock is the default because the live API needs Postgres, and every screen has
 * to be demoable and testable without one. Set `NEXT_PUBLIC_API_MODE=live` in
 * `.env.local` to talk to a running `apps/api`.
 */
export function resolveApiMode(value: string | undefined): ApiMode {
  return value === 'live' ? 'live' : 'mock';
}

export const API_MODE: ApiMode = resolveApiMode(process.env.NEXT_PUBLIC_API_MODE);

export const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/** True while the screen is reading fixtures. Surface it: mock data is never silent. */
export const IS_MOCK_MODE: boolean = API_MODE === 'mock';

/**
 * The one live-transport configuration, so the token source lands in a single
 * place. Both `api.ts` and the assistant transport read it; a second copy is
 * how one of them ends up still sending a token the other stopped issuing.
 *
 * `getToken` is read fresh on every request rather than captured, because the
 * session it reads from is per-tab, expires on a clock and can be taken away
 * mid-shift: a token held in a closure here would keep being sent after the
 * clinician signed out. It returns null while signed out, which is what a
 * server component sees as well - the store deliberately holds nothing outside
 * the browser (`lib/auth/store.ts`).
 *
 * `fetchImpl` is the other half of the same wiring. A 401 from the API is that
 * server's verdict on the token this app is holding, and the honest response is
 * to stop holding it and send the clinician back to sign in, rather than to
 * paint a retry button on sixty screens that a retry cannot fix.
 */
export const API_CONFIG: ApiClientConfig = {
  baseUrl: API_BASE_URL,
  getToken: currentAccessToken,
  fetchImpl: createSessionAwareFetch(),
};

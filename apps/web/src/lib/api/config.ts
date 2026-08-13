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
 * Auth is not wired yet, so `getToken` returns null and the API answers 401.
 * That is the honest state of the world rather than a fake success.
 */
export const API_CONFIG: ApiClientConfig = {
  baseUrl: API_BASE_URL,
  getToken: () => null,
};

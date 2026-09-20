/**
 * Shared test helpers. Not a test file: vitest collects `__tests__/**\/*.test.*` only, and
 * coverage excludes this directory.
 *
 * `stubApi` starts from the real mock adapter and lets a test replace just the one method
 * it cares about, so a screen test never has to hand-write eleven stubs to change one.
 */

import { buildEmptyFixtures, buildFixtures, createMockApi } from '@/lib/api';
import type { PortalApi } from '@/lib/api/types';

export function stubApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return { ...createMockApi(buildFixtures()), ...overrides };
}

/** An api whose every read comes back with nothing, for the empty states. */
export function emptyApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return { ...createMockApi(buildEmptyFixtures()), ...overrides };
}

/** A read that never settles, for the loading state. */
export function never(): Promise<never> {
  return new Promise<never>(() => {});
}

/** A read or write that fails, for the error state. */
export function fails(): Promise<never> {
  return Promise.reject(new Error('The network is unavailable.'));
}

/**
 * The page going out of sight, and coming back, as jsdom can produce them.
 *
 * `visibilityState` is a read-only getter on the prototype, so it is shadowed
 * on the document for as long as the page is meant to be hidden and the shadow
 * is deleted rather than set back - which leaves the real getter answering, so
 * a test that forgets to show the page again cannot leave a stale 'visible'
 * standing in for one.
 */
export function hidePage(): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

export function showPage(): void {
  Reflect.deleteProperty(document, 'visibilityState');
  document.dispatchEvent(new Event('visibilitychange'));
}

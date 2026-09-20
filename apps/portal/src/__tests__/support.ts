/**
 * Shared test helpers. Not a test file: vitest collects `__tests__/**\/*.test.*` only, and
 * coverage excludes this directory.
 *
 * `stubApi` starts from the real mock adapter and lets a test replace just the one method
 * it cares about, so a screen test never has to hand-write eleven stubs to change one.
 */

import { onTestFinished } from 'vitest';
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
 *
 * Hiding registers its own restore, because the shadow is on a document every
 * test in the file shares. A case that hides the page and then fails an
 * assertion never reaches its own `showPage()`, so without this the page stays
 * hidden for every later test in that file and one broken assertion arrives as
 * a cascade - with the one that actually broke the hardest to pick out.
 * `onTestFinished` runs on the way out of a failing test as well as a passing
 * one, which an inline call at the end of the case cannot do.
 */
export function hidePage(): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  onTestFinished(showPage);
  document.dispatchEvent(new Event('visibilitychange'));
}

export function showPage(): void {
  Reflect.deleteProperty(document, 'visibilityState');
  document.dispatchEvent(new Event('visibilitychange'));
}

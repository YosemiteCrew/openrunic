/**
 * The page going out of sight, and coming back, as jsdom can produce them.
 *
 * Its own module rather than part of `support.ts`, because `vitest.setup.ts`
 * imports `showPage` and so would pull `@/lib/api` - `createMockApi`,
 * `buildFixtures` and the fixture data behind them - into the setup graph of
 * every portal test file, including the ones that never touch the API.
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

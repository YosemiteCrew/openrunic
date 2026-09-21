import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

import { showPage } from './src/__tests__/visibility';

/**
 * A page a case hid is shown again here, not on the case's own last line.
 *
 * `hidePage` shadows `document.visibilityState`, and an inline restore only runs
 * when every assertion before it passed, so one failing assertion leaves the
 * shadow standing for the rest of the file (#517).
 *
 * Nothing is broken by that today, and the reason is structural rather than
 * luck: `usePageHidden` reads `document.visibilityState` only from inside its
 * `visibilitychange` listener and never at mount, so a leftover shadow is inert
 * for every consumer there is. This makes the invariant one a test file cannot
 * get wrong, for the next file and for the first consumer that does read
 * visibility at mount - not a repair of an observed cascade.
 *
 * Only when a shadow is actually there: `showPage` dispatches `visibilitychange`,
 * and firing one after every test in the suite would hand components an event no
 * test asked for.
 */
afterEach(() => {
  if (Object.getOwnPropertyDescriptor(document, 'visibilityState')) {
    showPage();
  }
});

/**
 * Every rendered component gets a translator.
 *
 * `useTranslator` throws without a provider, on purpose: a component rendering
 * outside it is a wiring mistake, and quietly falling back to English would hide
 * it until somebody who reads Spanish opened that screen - which on this
 * application is a patient looking at their own record. Wrapping here rather
 * than relaxing the hook keeps that guarantee in production while letting a test
 * render a component the way the application does.
 *
 * A test that cares about another language cannot get one by rendering its own
 * `MessagesProvider`. This replaces the hook rather than the context, so a
 * nested provider sets a value nothing reads and the component renders English
 * while the test looks like it asked for Spanish - which is the worst shape a
 * test double can take, because it fails open and silently. Reach the other
 * language the way `lib/__tests__/format.test.ts` does: build a translator with
 * `createTranslator(appCatalogue, 'es')` and pass it to the thing under test.
 *
 * ## One translator, not one per call
 *
 * `MessagesProvider` memoises its translator on the locale, so in the running
 * application `useTranslator` returns the same function for as long as the
 * language does not change. A stub that built a fresh one per call would break
 * that invariant rather than any assertion, so nothing would fail - and a
 * component that memoises on the translator would recompute for ever.
 */
vi.mock('@/lib/i18n/messages', async () => {
  const actual =
    await vi.importActual<typeof import('./src/lib/i18n/messages')>('@/lib/i18n/messages');
  const { appCatalogue, createTranslator } = await import('@openrunic/i18n');
  // Built here rather than inside the hook: the factory runs once per test
  // file's module registry, so every component in one test sees one translator.
  const translator = createTranslator(appCatalogue, 'en');
  return { ...actual, useTranslator: () => translator };
});

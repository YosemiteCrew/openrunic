import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom does no layout, so it ships no `scrollIntoView`. The combobox surfaces
// call it to keep the active option visible while the arrow keys move, and
// without a stub every one of those key presses would throw.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

/**
 * Every rendered component gets a translator.
 *
 * `useTranslator` throws without a provider, on purpose: a component rendering
 * outside it is a wiring mistake, and quietly falling back to English would
 * hide it until somebody who reads Spanish opened that screen. Wrapping here
 * rather than relaxing the hook keeps that guarantee in production while
 * letting a test render a component the way the application does.
 *
 * The source locale, so assertions read in the language the tests are written
 * in.
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
 * language does not change. Components rely on that: a screen memoises its
 * palette entries on the translator, and `useRegisterCommands` re-registers
 * whenever that array changes.
 *
 * A stub that built a fresh translator per call broke the invariant rather than
 * the assertion, so nothing failed - a component that re-registers on a context
 * change would translate again, get a new array, register again, and go round
 * until the worker ran out of memory. Built once here, the double behaves the
 * way the thing it stands in for does.
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

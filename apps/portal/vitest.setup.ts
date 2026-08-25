import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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

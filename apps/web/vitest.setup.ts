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
 * in. A test that cares about translation asks for a locale explicitly by
 * rendering its own provider, which nests and wins.
 */
vi.mock('@/lib/i18n/messages', async () => {
  const actual =
    await vi.importActual<typeof import('./src/lib/i18n/messages')>('@/lib/i18n/messages');
  const { appCatalogue, createTranslator } = await import('@openrunic/i18n');
  return { ...actual, useTranslator: () => createTranslator(appCatalogue, 'en') };
});

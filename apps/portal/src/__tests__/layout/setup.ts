import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/*
 * The application's own stylesheets, in the order layout.tsx imports them. Without these the
 * browser renders unstyled markup, which cannot overflow the way the app does and would make
 * every assertion in this suite pass for a reason that has nothing to do with the app.
 * `styles.css` is the built artifact from @openrunic/ui, so this suite needs that package
 * built - the turbo task declares `dependsOn: ["^build"]` for that reason.
 */
import '@openrunic/ui/styles.css';
import '@/app/globals.css';

/**
 * Every rendered component gets a translator, for the reason vitest.setup.ts gives at length:
 * `useTranslator` throws without a provider on purpose, and this replaces the hook rather
 * than the context so a nested provider cannot quietly fail open.
 */
vi.mock('@/lib/i18n/messages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n/messages')>('@/lib/i18n/messages');
  const { appCatalogue, createTranslator } = await import('@openrunic/i18n');
  const translator = createTranslator(appCatalogue, 'en');
  return { ...actual, useTranslator: () => translator };
});

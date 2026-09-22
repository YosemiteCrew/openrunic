import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/*
 * The layout guard, in its own config for the reason packages/ui keeps its story tests in
 * one: vitest.config.mts is the jsdom unit suite carrying this app's coverage floors, and a
 * second environment folded into it would move the denominator those floors are set against.
 *
 * Two environments, one component tree. jsdom reports `scrollWidth` and `clientWidth` as 0
 * for every element, so an overflow assertion written against the unit suite cannot fail -
 * it is not a weaker version of this check, it is no check at all. A real browser is the
 * only place the question is answerable, which is what this config exists to provide.
 *
 * The unit config excludes `*.layout.test.tsx` so the same files are never collected there.
 */
export default defineConfig({
  // Vite 8 transforms with oxc and ignores `esbuild` options, exactly as vitest.config.mts
  // says at more length. Every JSX file fails without this.
  oxc: {
    jsx: {
      runtime: 'automatic',
      development: false,
    },
  },
  define: {
    /*
     * Next inlines `process.env.NEXT_PUBLIC_*` wherever it appears literally in the source,
     * and `lib/api/config.ts` reads one at module scope. A browser test bundle has no
     * `process` at all, so without the same substitution here every import of the api module
     * throws before a screen renders. `mock` is the value the application itself defaults to.
     */
    'process.env.NEXT_PUBLIC_API_MODE': JSON.stringify('mock'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'layout',
    globals: true,
    include: ['src/__tests__/layout/*.layout.test.tsx'],
    setupFiles: ['./src/__tests__/layout/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      // One pinned browser so a width means the same thing on every run. The viewport here
      // is only the starting size: each test sets the widths it is about through
      // `page.viewport()`, because the defect this guards appears at some widths and not
      // others and a single size would be a choice about which half to watch.
      instances: [{ browser: 'chromium', viewport: { width: 1440, height: 900 } }],
    },
  },
});

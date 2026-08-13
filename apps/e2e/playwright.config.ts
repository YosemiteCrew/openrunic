import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

/**
 * The full-day clinical drill.
 *
 * Runs against the web application in MOCK mode, so it needs no database, no
 * API and no seed - which is what lets it be the per-pull-request acceptance
 * gate rather than a nightly job. `NEXT_PUBLIC_API_MODE=mock` is inlined by
 * Next at build time, so the build below is part of the contract, not a
 * convenience.
 */

const PORT = Number.parseInt(process.env.OPENRUNIC_E2E_PORT ?? '3100', 10);
const BASE_URL = process.env.OPENRUNIC_E2E_BASE_URL ?? `http://127.0.0.1:${String(PORT)}`;

/**
 * Typed explicitly rather than inlined.
 *
 * A conditionally spread array literal widens to `string[][]`, which does not
 * match `ReporterDescription` - and because `defineConfig` is overloaded, the
 * resulting error is reported against an unrelated property further down the
 * object. Naming the type keeps the failure where the mistake is.
 *
 * The GitHub reporter turns a failure into an annotation on the diff, which is
 * where a reviewer already is; locally it is only noise.
 */
const reporter: ReporterDescription[] = [
  ['list'],
  ['html', { open: 'never', outputFolder: 'playwright-report' }],
];
if (process.env.CI === 'true') reporter.push(['github']);

export default defineConfig({
  testDir: './tests',
  // The drill is one long story per viewport. Running its files in parallel
  // would interleave their output and make a failure much harder to read,
  // which defeats the point of an acceptance test.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter,

  use: {
    baseURL: BASE_URL,
    // Traces and screenshots only for failures: this suite is read when it
    // breaks, and an artefact for every passing run buries the one that matters.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    contextOptions: {
      // The design system collapses every animation and transition to 0.01ms
      // under this preference, which removes a whole category of timing flake
      // rather than papering over it with waits.
      //
      // It belongs under contextOptions, not directly under `use`: Playwright
      // moved it, and because defineConfig is overloaded, putting it in the
      // wrong place produces an error that points at the whole `use` block.
      reducedMotion: 'reduce',
    },
  },

  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Below 1024 the navigation rail collapses behind a Menu button, so this
      // project exercises a genuinely different shell, not just a narrower one.
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'phone-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],

  webServer: {
    command: `pnpm --filter web run start --port ${String(PORT)}`,
    url: BASE_URL,
    reuseExistingServer: process.env.CI !== 'true',
    timeout: 120_000,
    cwd: '../..',
    env: { NEXT_PUBLIC_API_MODE: 'mock' },
  },
});

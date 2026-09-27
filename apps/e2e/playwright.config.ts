import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

import {
  DRILL_COOKIE_SECRET,
  PORTAL_COOKIE_SECRET,
  PORTAL_STORAGE_STATE,
  STORAGE_STATE,
} from './global-setup.js';

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
const PORTAL_PORT = Number.parseInt(process.env.OPENRUNIC_PORTAL_E2E_PORT ?? '3300', 10);
const PORTAL_BASE_URL =
  process.env.OPENRUNIC_PORTAL_E2E_BASE_URL ?? `http://127.0.0.1:${String(PORTAL_PORT)}`;

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
  // The HTML report carries its data as a base64 zip inside index.html, so the
  // downloaded artifact answers no plain-text search: a full run and an empty
  // one grep the same (#575). This writes the same run in a form a reviewer -
  // or the check at the end of scripts/run-drill.mjs - can just read. It lands
  // in test-results rather than in playwright-report because the HTML reporter
  // owns that folder and clears it.
  ['json', { outputFile: 'test-results/drill-report.json' }],
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

  // Mints the session cookie the proxy insists on, once, before any scenario.
  // global-setup.ts explains why the drill carries a real credential rather than
  // the proxy learning to make an exception for tests.
  globalSetup: './global-setup.ts',

  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
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
      testIgnore: /portal\.spec\.ts/,
      // Stock Chrome for the same reason as the portal project below: Find
      // available carries a microphone, and bundled headless Chromium crashes
      // when it asks whether the on-device recogniser is available.
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // Below 1024 the navigation rail collapses behind a Menu button, so this
      // project exercises a genuinely different shell, not just a narrower one.
      name: 'tablet-768',
      testIgnore: /portal\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'phone-375',
      testIgnore: /portal\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'portal-chrome',
      testMatch: /portal\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PORTAL_BASE_URL,
        storageState: PORTAL_STORAGE_STATE,
        // Bundled headless Chromium crashes when the portal asks whether its
        // on-device recogniser is available. Stock Chrome answers normally;
        // the drill workflow installs this system package on every run because
        // it cannot be restored from the Playwright browser cache.
        channel: 'chrome',
        // Without this Chrome on Linux never asks the system speech service for
        // voices, and the read-aloud scenario finds none. Other platforms
        // ignore it.
        launchOptions: { args: ['--enable-speech-dispatcher'] },
      },
    },
  ],

  webServer: [
    {
      command: `pnpm --filter web run start --port ${String(PORT)}`,
      url: BASE_URL,
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 120_000,
      cwd: '../..',
      env: {
        NEXT_PUBLIC_API_MODE: 'mock',
        SESSION_COOKIE_SECRET: DRILL_COOKIE_SECRET,
      },
    },
    {
      command: `pnpm --filter portal run start --port ${String(PORTAL_PORT)}`,
      url: PORTAL_BASE_URL,
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 120_000,
      cwd: '../..',
      env: {
        NEXT_PUBLIC_API_MODE: 'live',
        SESSION_COOKIE_SECRET: PORTAL_COOKIE_SECRET,
      },
    },
  ],
});

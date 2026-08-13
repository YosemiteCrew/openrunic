import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No @vitejs/plugin-react here on purpose: its second transform pass
  // double-instruments files under istanbul coverage (halving reported
  // coverage). Tests only need the automatic JSX runtime, which esbuild
  // provides directly; the plugin's fast-refresh is a dev-server concern.
  esbuild: {
    jsx: 'automatic',
    jsxDev: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      // Barrels only re-export; istanbul emits no entry for a file with no
      // runtime statements, so listing them keeps the intent explicit rather
      // than relying on that.
      exclude: ['src/**/index.ts'],
      // Coverage floors are enforced by CI on the merged coverage map
      // (COVERAGE_FLOORS in _test.yaml), never per shard - a per-shard
      // threshold here would evaluate against a slice of the suite and misfire
      // the moment the shard count rises above 1. Keep the two in step: the
      // numbers there are statements 95, branches 90, functions 95, lines 95.
    },
  },
});

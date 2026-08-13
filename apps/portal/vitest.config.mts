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
      // Test files and their helpers are not the subject of the measurement.
      exclude: ['src/**/__tests__/**', '**/*.d.ts'],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});

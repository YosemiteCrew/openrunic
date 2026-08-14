import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8 transforms with oxc, not esbuild, and ignores `esbuild` options
  // entirely - it announces that on startup and then fails every TSX file with
  // "Unexpected JSX expression". The setting has to be spelled for the
  // transformer actually in use.
  //
  // Still no @vitejs/plugin-react: its second transform pass double-instruments
  // files under istanbul coverage and halves the reported figure. Tests need the
  // automatic JSX runtime and nothing else, which oxc provides directly; the
  // plugin's fast refresh is a dev-server concern.
  oxc: {
    jsx: {
      runtime: 'automatic',
      development: false,
    },
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

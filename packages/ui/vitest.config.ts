import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8 transforms with oxc, not esbuild, and ignores `esbuild` options
  // entirely - it says so on startup and then fails every TSX file with
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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.tsx',
        // Barrels are re-export only, and types.ts carries no runtime code at all.
        'src/**/index.ts',
        'src/types.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});

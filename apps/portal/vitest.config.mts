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
    // Bounded so a whole-repo run does not oversubscribe the machine.
    //
    // turbo runs several workspaces at once and each vitest sizes its pool from
    // the core count, so `pnpm run test` on an 8-core laptop asks for something
    // like 8 x 7 workers. Measured: the three heaviest files in this suite take
    // 5.3s together when this workspace runs alone, and 27s, 34s and 41s each
    // under a full run - past the 5s default timeout, which is what the random
    // local failures were. Different victims each run, because which file loses
    // the race is chance.
    //
    // CI is unaffected: it runs one workspace per shard and already passes
    // --maxWorkers=2 on the command line, which overrides this. The number is
    // the same on purpose, so a local run is bounded the way CI is rather than
    // in some third way.
    //
    // This is the cause and not the symptom. Raising testTimeout would hide it
    // and would slow every real failure down by the same amount.
    maxWorkers: 2,
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

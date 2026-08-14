import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      // index.ts is entry wiring (binds a port); everything else must be
      // covered. `__tests__` holds the harness, which is exercised by
      // definition and would only inflate the numbers.
      //
      // Coverage floors are enforced by CI on the merged coverage map
      // (COVERAGE_FLOORS in _test.yaml), never per shard - a per-shard
      // threshold here would evaluate against a slice of the suite and misfire
      // the moment the shard count rises above 1. Keep the two in step: the
      // numbers there are statements 95, branches 95, functions 95, lines 95.
      exclude: ['src/index.ts', 'src/__tests__/**'],
      /**
       * The floors the suite must clear on a full run.
       *
       * They are set here as well as in CI because a threshold that only exists
       * in CI is a threshold nobody sees until their branch is red. That only
       * works if the two agree, so these are exactly the numbers in
       * COVERAGE_FLOORS for `api` in `.github/workflows/_test.yaml`. Move them
       * together or the local run stops meaning anything: branches sat at 90
       * here while CI required 95, which made a green local run consistent with
       * a red CI one - the failure this block exists to prevent.
       *
       * Branches once sat lower than the rest on the argument that much of the
       * branching in this package is the `x === undefined ? {} : { x }` spread
       * that keeps an absent value out of a payload. The suite has since gone
       * past that: it measures 97.9% branches, so the allowance was buying
       * nothing except the disagreement above.
       *
       * The agent surface (ADR-0005) carries its own entry as well as the
       * global one. A per-glob entry REPLACES the global for the files it
       * matches, so it has to be restated at the same numbers rather than left
       * behind - otherwise the entry that exists to hold that surface to the
       * bar would be the one thing exempting it.
       */
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 95,
        'src/agent/**': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});

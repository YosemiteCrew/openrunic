import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      // index.ts is entry wiring (binds a port); everything else must be covered.
      // Coverage floors are enforced by CI on the merged coverage map
      // (COVERAGE_FLOORS in _test.yaml), never per shard - a per-shard
      // threshold here would evaluate against a slice of the suite and misfire
      // the moment the shard count rises above 1.
      exclude: ['src/index.ts', 'src/__tests__/**'],
      // Per-glob floors, not a global one. The agent surface (ADR-0005) is new
      // code held to the bar its own packages are held to; a global threshold
      // here would collide with the merged-coverage gate CI already runs and
      // would change the bar for every other workstream in this app.
      thresholds: {
        'src/agent/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});

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
      exclude: ['src/index.ts', 'src/__tests__/**'],
      thresholds: { lines: 90 },
    },
  },
});

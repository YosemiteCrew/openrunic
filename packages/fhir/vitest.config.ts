import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-support/**'],
      // Branches sit below the other three because the mappers are full of
      // `?? undefined` arms guarding optional FHIR elements that no fixture can
      // make both sides of at once. The other three admit no such excuse.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});

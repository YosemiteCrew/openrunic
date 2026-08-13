import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // The one uncovered branch is `DAYS_IN_MONTH[month - 1] ?? 0`, whose
      // fallback sits behind a 1-12 bounds check and so cannot be reached from
      // any input. It exists for `noUncheckedIndexedAccess`, not for a caller.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});

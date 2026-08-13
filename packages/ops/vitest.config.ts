import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      // The pure modules only. `db/`, `process/` and the CLI shell out to
      // Docker and Postgres; they are covered by the ops drills in CI, which
      // run the real commands against a real stack rather than a mock of one.
      include: ['src/migration-lint/**/*.ts', 'src/env/**/*.ts', 'src/commands/upgrade-plan.ts'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});

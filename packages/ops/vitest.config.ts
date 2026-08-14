import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      // The modules that decide something, rather than the ones that shell out.
      // `db/`, `process/` and the CLI talk to Docker and Postgres; they are
      // covered by the ops drills in CI, which run the real commands against a
      // real stack rather than a mock of one.
      //
      // `commands/upgrade.ts` is here because it is the upgrade safety gate, and
      // a gate with no test is a claim rather than a gate. Its decision function
      // is pure; the two database reads its pre-flight makes are the only part
      // the test has to stand in for.
      include: [
        'src/migration-lint/**/*.ts',
        'src/env/**/*.ts',
        'src/commands/upgrade-plan.ts',
        'src/commands/upgrade.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});

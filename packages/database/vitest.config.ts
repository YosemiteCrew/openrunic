import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      // The pure modules only. `client.ts`, `tenant.ts`'s extension factory and
      // `seed/` all need a generated Prisma client and a real database; they
      // are covered by the API package's integration tests. `enums.ts` is a
      // data table checked at compile time, and `generated/` is not ours.
      include: ['src/audit.ts', 'src/uuid.ts', 'src/forms.ts', 'src/schemas/**/*.ts'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});

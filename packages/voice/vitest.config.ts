import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /* jsdom rather than node: two of the five modules here are React hooks, and
       one of them exists to read `document.visibilityState`. The adapter and the
       reducer never touch a global - both take what they need as arguments - so
       they run identically either way. */
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/index.ts'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});

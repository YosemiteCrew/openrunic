import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No @vitejs/plugin-react here on purpose: its transform runs a second pass over every
  // file, which double-instruments them under coverage and roughly halves the reported
  // numbers. Tests only need the automatic JSX runtime, and esbuild provides that
  // directly. The plugin belongs in vite.config.ts and .storybook, nowhere else.
  esbuild: {
    jsx: 'automatic',
    jsxDev: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.tsx',
        // Barrels are re-export only, and types.ts carries no runtime code at all.
        'src/**/index.ts',
        'src/types.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});

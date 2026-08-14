// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'playwright-report/', 'test-results/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    // The drill runner is plain ESM JavaScript, not TypeScript, so nothing
    // tells ESLint that Node's globals exist and `no-undef` flags every use of
    // `process`. Declaring them here is the whole fix; the .ts files get the
    // same knowledge from @types/node.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  }
);

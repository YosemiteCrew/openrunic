// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'storybook-static/', 'coverage/', 'node_modules/'] },
  // ESLint 9 lints only .js/.mjs/.cjs unless a config widens the set.
  { files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'] },
  eslint.configs.recommended,
  tseslint.configs.recommended
);

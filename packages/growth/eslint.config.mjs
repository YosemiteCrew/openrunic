// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    /**
     * `scripts/` is the reference-data generator: a Node program that fetches,
     * verifies and writes, run by hand rather than by the build. It needs the three
     * globals the library deliberately does not have.
     *
     * Named here rather than pulled from the `globals` package, because three
     * identifiers is not worth a dependency - and the repository's minimum
     * release age would have to be waived to install a current one, which is a
     * supply-chain guard worth more than the convenience.
     */
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  }
);

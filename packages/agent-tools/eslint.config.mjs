// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The Prisma ban is a lint rule, not a review convention.
 *
 * ADR-0005: tools call the existing HTTP API with the end user's own
 * credentials, so tenant scoping, consent evaluation, policy checks and the
 * hash-chained audit are enforced by middleware that already exists and is
 * already tested. A tool holding a database client would be a second door with
 * different locks, and the way that arrives is one innocent import in one pull
 * request. `registry.no-database-import.test.ts` asserts the same property over
 * the source and the built output, because a lint rule can be skipped and a
 * test in CI cannot.
 */
const BANNED_DATA_ACCESS = [
  {
    name: '@prisma/client',
    message:
      'ADR-0005: agent tools must never touch the database. Call the HTTP API with the credentials of the end user.',
  },
  {
    name: '@openrunic/database',
    message:
      'ADR-0005: agent tools must never touch the database. Call the HTTP API with the credentials of the end user.',
  },
];

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: BANNED_DATA_ACCESS, patterns: ['@prisma/*', '@openrunic/database/*'] },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  }
);

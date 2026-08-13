// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Two bans, and the second one is the important one.
 *
 * **No database access.** Same rule as `packages/agent-tools`: the agent is an
 * ordinary API client holding the caller's credentials.
 *
 * **No bare model string.** `ai` resolves an unqualified model name through a
 * hosted gateway by default. In a self-hosted, privacy-first EMR that is a
 * silent health-data egress path nobody configured, and it would arrive as one
 * innocuous line: `model: 'some-model'`. So a literal in a `model` position is
 * a lint error, importing the gateway package is a lint error, and
 * `provider.test.ts` additionally asserts that the URL actually contacted is
 * the configured base URL. Rules catch the mistake; the test catches the
 * dependency changing its mind.
 */
const BANNED_DATA_ACCESS = [
  {
    name: '@prisma/client',
    message: 'ADR-0005: the agent reaches data through the HTTP API, never through the database.',
  },
  {
    name: '@openrunic/database',
    message: 'ADR-0005: the agent reaches data through the HTTP API, never through the database.',
  },
  {
    name: '@ai-sdk/gateway',
    message:
      'ADR-0005: a hosted routing gateway is health-data egress nobody configured. Construct an explicit provider with an explicit base URL.',
  },
  {
    name: '@vercel/oidc',
    message:
      'ADR-0005: reachable only through the hosted gateway path, which this package refuses.',
  },
];

const BARE_MODEL_STRING =
  'ADR-0005: never a bare model string. Build an explicit provider instance with an explicit base URL through resolveProvider().';

/** The call sites where a bare string actually becomes a request to somewhere. */
const SDK_ENTRY_POINTS = 'streamText|generateText|streamObject|generateObject|embed|embedMany';

const SDK_CALL_SITE_RULES = [
  {
    selector: `CallExpression[callee.name=/^(${SDK_ENTRY_POINTS})$/] > ObjectExpression > Property[key.name='model'][value.type!='MemberExpression']`,
    message: BARE_MODEL_STRING,
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
      // Fires wherever a model is named, in every source file.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='model'][value.type='Literal']",
          message: BARE_MODEL_STRING,
        },
        {
          selector: "Property[key.name='model'][value.type='TemplateLiteral']",
          message: BARE_MODEL_STRING,
        },
        {
          selector: "Property[key.name='model'][value.type='Identifier'][value.name=/Id$/]",
          message: BARE_MODEL_STRING,
        },
        ...SDK_CALL_SITE_RULES,
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    /**
     * Fixtures legitimately carry a model **id** string, because that is what
     * the audit chain records: `viaAgent.model` is the exact model id, and a
     * test that asserts on it has to write one down. The broad rule would flag
     * those, so test files keep only the call-site rules, which are the ones
     * that describe an actual request going somewhere.
     */
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...SDK_CALL_SITE_RULES],
    },
  }
);

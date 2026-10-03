import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeDeferredEntries,
  DEFERRED,
  ignoredDependencyNames,
} from '../../.github/scripts/retry-deferred.mjs';

const activeHolds = `
ignore:
  - dependency-name: 'typescript'
    update-types: ['version-update:semver-major']
  - dependency-name: '@types/node'
    update-types: ['version-update:semver-major']
  - dependency-name: 'eslint'
    update-types: ['version-update:semver-major']
  - dependency-name: '@eslint/js'
    update-types: ['version-update:semver-major']
  - dependency-name: 'jsdom'
    update-types: ['version-update:semver-major']
`;

test('reads quoted dependency names from Dependabot ignores', () => {
  assert.deepEqual(
    [...ignoredDependencyNames(activeHolds)],
    ['typescript', '@types/node', 'eslint', '@eslint/js', 'jsdom']
  );
});

test('tests only dependencies that Dependabot still holds', () => {
  assert.deepEqual(
    activeDeferredEntries(DEFERRED, activeHolds).map((entry) => entry.name),
    ['eslint', 'jsdom', '@types/node', 'typescript']
  );
});

test('refuses an ignored dependency without a revisit gate', () => {
  assert.throws(
    () =>
      activeDeferredEntries(DEFERRED, `${activeHolds}\n  - dependency-name: 'unmapped-package'\n`),
    /Deferred dependency has no revisit gate: unmapped-package/
  );
});

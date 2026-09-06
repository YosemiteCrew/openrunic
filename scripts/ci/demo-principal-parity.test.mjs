#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  compare,
  NOT_OFFERED,
  OFFERED,
  readApiPrincipals,
  readOfferedCredentials,
} from './demo-principal-parity.mjs';

/**
 * The guard's own tests.
 *
 * The fixtures are real modules written to disk, not objects: the guard IMPORTS
 * its two inputs, and one of them is a FUNCTION whose arguments decide whether
 * it returns anything at all. A test that handed `compare` two Maps would never
 * exercise the reader, and the reader is where the interesting failure is - a
 * `developmentCredentials` called with production arguments returns an empty
 * list, and an empty list disagrees with nothing.
 */

const dir = mkdtempSync(join(tmpdir(), 'principal-parity-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
function writeModule(source) {
  const path = join(dir, `fixture-${(counter += 1)}.ts`);
  writeFileSync(path, source);
  return path;
}

function apiModule(rows) {
  const entries = rows
    .map(
      (row) =>
        `  ['${row.token}', { subject: '${row.subject}', displayName: '${row.displayName}', roles: ${JSON.stringify(row.roles)} }],`
    )
    .join('\n');
  return writeModule(`export const DEMO_PRINCIPALS = new Map([\n${entries}\n]);\n`);
}

function webModule(rows, { emptyInProduction = false } = {}) {
  const entries = rows
    .map(
      (row) =>
        `  { token: '${row.token}', identity: { subject: '${row.subject}', displayName: '${row.displayName}', roles: ${JSON.stringify(row.roles)} } },`
    )
    .join('\n');
  const body = emptyInProduction
    ? `  return nodeEnv === 'production' ? [] : STAFF;`
    : `  return STAFF;`;
  return writeModule(
    `const STAFF = [\n${entries}\n];\nexport function developmentCredentials(nodeEnv: string) {\n${body}\n}\n`
  );
}

const ALICE = { token: 'dev-a', subject: 'sub-a', displayName: 'Ada', roles: ['clinician'] };
const BOB = { token: 'dev-b', subject: 'sub-b', displayName: 'Bo', roles: ['biller'] };
const WITHHELD = {
  token: 'dev-portal',
  subject: 'sub-p',
  displayName: 'Pat',
  roles: ['patient-portal'],
};

async function problemsFor(apiRows, webRows, expected = {}) {
  const api = await readApiPrincipals(apiModule(apiRows));
  const offered = await readOfferedCredentials(webModule(webRows));
  return compare({
    api,
    offered,
    expectedOffered: expected.offered ?? webRows.map((row) => row.token),
    expectedNotOffered: expected.notOffered ?? ['dev-portal'],
  }).problems;
}

test('agrees when the two tables say the same thing', async () => {
  assert.deepEqual(await problemsFor([ALICE, BOB, WITHHELD], [ALICE, BOB]), []);
});

test('names a drifted subject as the audit attribution key', async () => {
  const drifted = { ...ALICE, subject: 'sub-somebody-else' };
  const problems = await problemsFor([ALICE, BOB, WITHHELD], [drifted, BOB]);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /^dev-a: subject sub-somebody-else does not match the API's sub-a/u);
  assert.match(problems[0], /audit attribution key/u);
});

test('catches a display name and a role list that drift', async () => {
  const problems = await problemsFor(
    [ALICE, BOB, WITHHELD],
    [
      { ...ALICE, displayName: 'Someone Else' },
      { ...BOB, roles: ['clinician'] },
    ]
  );

  assert.equal(problems.length, 2);
  assert.match(problems[0], /displayName "Someone Else" does not match the API's "Ada"/u);
  assert.match(problems[1], /roles \[clinician\] do not match the API's \[biller\]/u);
});

test('catches a principal the API publishes and the sign-in never offers', async () => {
  // The #302 failure: a token added to the API, resolving there, and unusable
  // through the product because nobody edited the sixth file.
  const problems = await problemsFor([ALICE, BOB, WITHHELD], [ALICE], { offered: ['dev-a'] });

  assert.deepEqual(problems, [
    'dev-b: published by the API and offered by nothing - deliberate, or dropped?',
  ]);
});

test('catches a token the sign-in offers that the API would refuse', async () => {
  const ghost = {
    token: 'dev-ghost',
    subject: 'sub-g',
    displayName: 'Ghost',
    roles: ['clinician'],
  };
  const problems = await problemsFor([ALICE, WITHHELD], [ALICE, ghost]);

  assert.deepEqual(problems, [
    'dev-ghost: offered by the staff sign-in and unknown to the API - it would 401',
  ]);
});

test('catches a withheld principal that has quietly started being offered', async () => {
  // The shipped expectation does not name the portal token, so somebody adding
  // it to `directory.ts` is the case here - not somebody adding it to both.
  const problems = await problemsFor([ALICE, WITHHELD], [ALICE, WITHHELD], {
    offered: ['dev-a'],
  });

  assert.deepEqual(problems, [
    'dev-portal: offered by the staff sign-in and not in the expected list',
    'dev-portal: expected to be withheld from the staff sign-in and it is not',
  ]);
});

/**
 * THE CASE THE GUARD IS SHAPED AROUND.
 *
 * `developmentCredentials` is a function whose arguments decide whether it
 * returns anything, and returning nothing under production arguments is correct
 * behaviour rather than a defect. So "no disagreements" is a sentence an empty
 * list satisfies, and the reader has to be reading the populated mode.
 */
test('an empty offered list disagrees with nothing, which is why the guard names its tokens', async () => {
  const api = await readApiPrincipals(apiModule([ALICE, BOB, WITHHELD]));
  const empty = new Map();

  // Phrased as a set difference, this is clean. That is the trap.
  assert.deepEqual(
    compare({
      api,
      offered: empty,
      expectedOffered: [],
      expectedNotOffered: ['dev-a', 'dev-b', 'dev-portal'],
    }).problems,
    []
  );

  // Phrased against the tokens that are supposed to be there, it is not.
  const named = compare({
    api,
    offered: empty,
    expectedOffered: ['dev-a', 'dev-b'],
    expectedNotOffered: ['dev-portal'],
  }).problems;
  assert.deepEqual(named, [
    'dev-a: expected on the staff sign-in and it is not offered',
    'dev-b: expected on the staff sign-in and it is not offered',
    'dev-a: published by the API and offered by nothing - deliberate, or dropped?',
    'dev-b: published by the API and offered by nothing - deliberate, or dropped?',
  ]);
});

test('reads the populated mode of a table that empties under production arguments', async () => {
  const path = webModule([ALICE, BOB], { emptyInProduction: true });

  // The reader passes 'development' precisely so this is not empty. If that
  // argument ever stops meaning what it means, this is what fails.
  assert.deepEqual([...(await readOfferedCredentials(path)).keys()], ['dev-a', 'dev-b']);
});

test('the shipped expectations are lists of identifiers, not counts', () => {
  // A count reports the same number for a principal added and one dropped.
  assert.ok(OFFERED.length > 0);
  assert.ok(NOT_OFFERED.length > 0);
  assert.deepEqual([...new Set(OFFERED)], OFFERED, 'a token is named twice');
  assert.deepEqual(
    OFFERED.filter((token) => NOT_OFFERED.includes(token)),
    [],
    'a token is both offered and withheld'
  );
});

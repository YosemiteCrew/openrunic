#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { compare, readRoleTable, render } from './capability-parity.mjs';

/**
 * The guard's own tests. Every case is a disagreement someone could actually
 * introduce, and the fixtures are real modules on disk rather than objects: the
 * guard IMPORTS its inputs, so a test that handed it a Map would be testing
 * something else and would not have caught the failure that motivated this
 * file's rewrite.
 */
const scratch = mkdtempSync(join(tmpdir(), 'capability-parity-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
/** Writes `source` as an importable module and returns its path. */
function module_(source) {
  seq += 1;
  const path = join(scratch, `fixture-${seq}.ts`);
  writeFileSync(path, source);
  return path;
}

const table = (entries) => new Map(entries.map(([role, held]) => [role, new Set(held)]));

test('reads a role whose permissions are computed rather than listed', async () => {
  /* This is the case that was silently dropped: `read-only: READ_EVERYTHING`
     is neither an array literal nor the bare `PERMISSIONS` identifier, and the
     text parser this replaced recognised only those two forms. It emitted no
     entry for the role, so `capabilitiesForRoles(['read-only'])` returned
     nothing and the browser told the account it could do nothing at all. */
  const path = module_(`
    export const PERMISSIONS = ['order.read', 'order.write', 'patient.read'] as const;
    const READ_EVERYTHING = PERMISSIONS.filter((p) => p.endsWith('.read'));
    export const ROLE_PERMISSIONS = {
      clinician: ['order.read', 'order.write'],
      'read-only': READ_EVERYTHING,
    };
  `);

  const read = await readRoleTable(path, 'ROLE_PERMISSIONS');

  assert.deepEqual([...read.keys()], ['clinician', 'read-only']);
  assert.deepEqual([...read.get('read-only')], ['order.read', 'patient.read']);
});

test('reads the bare identifier form, which is not an empty set', async () => {
  /* `admin: PERMISSIONS` and an empty browser entry would AGREE if the reader
     turned the identifier into nothing, and two empty sets are the quietest
     possible false pass. */
  const path = module_(`
    export const PERMISSIONS = ['order.read', 'order.write'] as const;
    export const ROLE_PERMISSIONS = { admin: PERMISSIONS };
  `);

  const read = await readRoleTable(path, 'ROLE_PERMISSIONS');

  assert.deepEqual([...read.get('admin')], ['order.read', 'order.write']);
});

test('refuses a module that does not export the table, rather than reporting parity', async () => {
  const path = module_(`export const SOMETHING_ELSE = { admin: [] };\n`);

  await assert.rejects(
    () => readRoleTable(path, 'ROLE_PERMISSIONS'),
    /does not export ROLE_PERMISSIONS/
  );
});

test('refuses an empty table, because empty agrees with empty', async () => {
  const path = module_(`export const ROLE_PERMISSIONS = {};\n`);

  await assert.rejects(() => readRoleTable(path, 'ROLE_PERMISSIONS'), /empty ROLE_PERMISSIONS/);
});

test('names a role the API has and the browser does not', () => {
  const { problems } = compare(
    table([
      ['clinician', ['order.write']],
      ['read-only', ['order.read']],
    ]),
    table([['clinician', ['order.write']]])
  );

  assert.deepEqual(problems, ['read-only: the API knows a role the browser does not']);
});

test('names the identifiers a role differs by, in both directions', () => {
  const { problems } = compare(
    table([['clinician', ['order.read', 'order.write']]]),
    table([['clinician', ['order.read', 'patient.write']]])
  );

  assert.deepEqual(problems, [
    'clinician: the browser is missing order.write',
    'clinician: the browser claims patient.write',
  ]);
});

test('agrees only when the two tables agree', () => {
  const both = () => table([['clinician', ['order.read']]]);

  assert.deepEqual(compare(both(), both()).problems, []);
});

test('quotes a role name that is not a bare identifier', async () => {
  const emitted = await render(
    table([
      ['admin', ['order.read']],
      ['read-only', ['order.read']],
    ])
  );

  assert.match(emitted, /^ {2}admin: \['order\.read'\],$/m);
  assert.match(emitted, /^ {2}'read-only': \['order\.read'\],$/m);
});

test('the committed browser table names every role the API defines', async () => {
  /* The assertion regenerate-and-diff cannot make. Both sides of that
     comparison are produced by the same generator, so a generator that omits a
     role omits it from the expectation too and the two files agree - which is
     how a missing `read-only` shipped green.

     Deliberately not routed through `readRoleTable` on either side. The API is
     imported here, and the artefact is read as TEXT, so a fault in this file's
     own reader cannot silence both halves at once the way the parser it
     replaced did. */
  const { ROLE_PERMISSIONS } = await import(
    pathToFileURL('apps/api/src/policy/permissions.ts').href
  );
  const committed = readFileSync('apps/web/src/lib/api/capabilities.ts', 'utf8');

  const named = Object.keys(ROLE_PERMISSIONS).filter((role) =>
    new RegExp(`^ {2}'?${role}'?:`, 'm').test(committed)
  );

  assert.deepEqual(named.sort(), Object.keys(ROLE_PERMISSIONS).sort());
});

test('and agrees with it permission by permission', async () => {
  const api = await readRoleTable('apps/api/src/policy/permissions.ts', 'ROLE_PERMISSIONS');
  const web = await readRoleTable('apps/web/src/lib/api/capabilities.ts', 'ROLE_CAPABILITIES');

  assert.deepEqual(compare(api, web).problems, []);
});

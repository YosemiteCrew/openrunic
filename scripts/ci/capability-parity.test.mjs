#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare } from './capability-parity.mjs';

/**
 * The guard's own tests. Every case is a disagreement someone could actually
 * introduce, and the fixtures are the two file shapes rather than a mock: the
 * guard reads text, so a test that hands it objects would be testing something
 * else.
 */
const API = `
export const PERMISSIONS = ['order.read', 'order.write', 'patient.read'] as const;
export const ROLE_PERMISSIONS = {
  admin: PERMISSIONS,
  clinician: ['order.read', 'order.write'],
  biller: ['order.read'],
};
`;

function web(body) {
  return `export const ROLE_CAPABILITIES = {\n${body}\n};\n`;
}

const MATCHING = web(`
  admin: ['order.read', 'order.write', 'patient.read'],
  clinician: ['order.read', 'order.write'],
  biller: ['order.read'],
`);

test('agrees when the two tables say the same thing', () => {
  const { problems, roles } = compare(API, MATCHING);
  assert.deepEqual(problems, []);
  assert.equal(roles, 3);
});

test('names a permission the browser is missing', () => {
  const { problems } = compare(
    API,
    web(`
  admin: ['order.read', 'order.write', 'patient.read'],
  clinician: ['order.read'],
  biller: ['order.read'],
`)
  );
  assert.deepEqual(problems, ['clinician: the browser is missing order.write']);
});

test('names a permission the browser has invented', () => {
  const { problems } = compare(
    API,
    web(`
  admin: ['order.read', 'order.write', 'patient.read'],
  clinician: ['order.read', 'order.write'],
  biller: ['order.read', 'order.write'],
`)
  );
  assert.deepEqual(problems, ['biller: the browser claims order.write']);
});

test('catches a role that exists on only one side, in both directions', () => {
  const missingRole = compare(
    API,
    web(`
  admin: ['order.read', 'order.write', 'patient.read'],
  clinician: ['order.read', 'order.write'],
`)
  );
  assert.deepEqual(missingRole.problems, ['biller: the API knows a role the browser does not']);

  const extraRole = compare(
    API,
    web(`
  admin: ['order.read', 'order.write', 'patient.read'],
  clinician: ['order.read', 'order.write'],
  biller: ['order.read'],
  auditor: ['order.read'],
`)
  );
  assert.deepEqual(extraRole.problems, ['auditor: the browser knows a role the API does not']);
});

test('expands the role that is granted PERMISSIONS by reference', () => {
  /* `admin: PERMISSIONS` is not an array literal, so a parser that only reads
     brackets silently gives the admin no permissions - and then agrees with a
     browser table that gives it none either. */
  const { problems } = compare(
    API,
    web(`
  admin: ['order.read'],
  clinician: ['order.read', 'order.write'],
  biller: ['order.read'],
`)
  );
  assert.deepEqual(problems, ['admin: the browser is missing order.write, patient.read']);
});

import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Principal } from '../auth/principal.js';
import type { AppEnv, AppVariables } from '../context.js';
import { ApiError } from '../errors.js';
import type { PolicyContext } from '../policy/policy.js';
import type { Repositories } from '../repositories/types.js';
import {
  attributedTo,
  idParamSchema,
  policyOf,
  repositories,
  required,
} from '../routes/helpers.js';

import { testId } from './support.js';

/**
 * Direct unit tests for the CRUD route helpers.
 *
 * Every helper here carries a branch that the live middleware chain makes
 * unreachable: `requirePermission` has already refused a request that arrives
 * without a principal, and the tenant-scope middleware has already bound the
 * repositories, so a route reached through the real app never sees either one
 * absent. Those branches are wiring assertions - the thing that fires when a
 * route is mounted outside the chain - so the only way to exercise them is to
 * hand the helper a context the chain would never have produced. This is why a
 * hand-built stub `Context` exists rather than a request against the app.
 */

/**
 * A `Context` that answers `get` from a plain map and nothing else. The helpers
 * only ever read variables off the context, so a getter is the whole surface
 * they touch; casting through `unknown` keeps the stub to exactly that surface
 * instead of standing up a real Hono request.
 */
function contextWith(variables: Partial<AppVariables>): Context<AppEnv> {
  return {
    get: (key: keyof AppVariables) => variables[key],
  } as unknown as Context<AppEnv>;
}

/** A synthetic staff principal; only its `subject` is read here. */
const PRINCIPAL: Principal = {
  subject: testId(900),
  tenantId: testId(1),
  actorType: 'user',
  roles: [],
  facilityIds: [],
  scopes: [],
  purposeOfUse: 'TREAT',
};

describe('repositories', () => {
  it('returns the tenant-bound registry the middleware chain set', () => {
    const repos = {} as Repositories;

    expect(repositories(contextWith({ repositories: repos }))).toBe(repos);
  });

  it('throws a wiring error rather than falling back when none was bound', () => {
    expect(() => repositories(contextWith({}))).toThrow(
      'route reached without tenant-bound repositories'
    );
  });
});

describe('attributedTo', () => {
  it('stamps the acting user from the verified principal', () => {
    expect(attributedTo(contextWith({ principal: PRINCIPAL }))).toBe(PRINCIPAL.subject);
  });

  it('throws a wiring error when no principal was resolved', () => {
    expect(() => attributedTo(contextWith({}))).toThrow('ran without a principal');
  });
});

describe('policyOf', () => {
  it('returns the policy context the chain built, or undefined without one', () => {
    const policy = {} as PolicyContext;

    expect(policyOf(contextWith({ policy }))).toBe(policy);
    expect(policyOf(contextWith({}))).toBeUndefined();
  });
});

describe('required', () => {
  it('passes a present value straight through', () => {
    const row = { id: testId(1) };

    expect(required(row, 'No such widget.')).toBe(row);
  });

  it('turns a repository null into the 404 contract', () => {
    try {
      required(null, 'No such widget.');
      expect.unreachable('required(null) must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).kind).toBe('not-found');
      expect((error as ApiError).detail).toBe('No such widget.');
    }
  });
});

describe('idParamSchema', () => {
  it('accepts a UUID and rejects anything that is not one', () => {
    expect(idParamSchema.safeParse(testId(1)).success).toBe(true);
    expect(idParamSchema.safeParse('42').success).toBe(false);
  });
});

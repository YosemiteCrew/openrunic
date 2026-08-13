import { describe, expect, it } from 'vitest';

import type { ProblemDocument } from '../http/problem.js';
import { STUB_AGGREGATES, stubRouteContracts } from '../routes/not-implemented.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * The not-yet-implemented aggregates.
 *
 * The property under test is the ordering: the security envelope runs *before*
 * the 501. A stub that answered 501 to everyone would be a stub whose
 * authentication and authorisation were never exercised, and the workstream
 * that fills it in would be the one to find that out.
 */

const ALL_TOKENS = {
  encounters: TOKENS.clinicianA,
  orders: TOKENS.clinicianA,
  results: TOKENS.clinicianA,
  claims: TOKENS.billerA,
  payments: TOKENS.billerA,
  tasks: TOKENS.clinicianA,
  forms: TOKENS.clinicianA,
} as const;

describe('the stubbed aggregates', () => {
  it('covers every aggregate the plan names', () => {
    expect(STUB_AGGREGATES.map((aggregate) => aggregate.segment)).toEqual([
      'encounters',
      'orders',
      'results',
      'claims',
      'payments',
      'tasks',
      'forms',
    ]);
  });

  it.each(STUB_AGGREGATES.map((aggregate) => aggregate.segment))(
    '%s answers 501 to a caller who holds the permission',
    async (segment) => {
      const { app } = createTestApp();
      const token = ALL_TOKENS[segment as keyof typeof ALL_TOKENS];

      const res = await app.request(`/bff/v0/${segment}`, { headers: bearer(token) });

      expect(res.status).toBe(501);
      const body = (await res.json()) as ProblemDocument;
      expect(body.type).toBe('https://openrunic.org/problems/not-implemented');
      expect(body.detail).toMatch(/owned by WS\d/);
    }
  );

  it.each(STUB_AGGREGATES.map((aggregate) => aggregate.segment))(
    '%s answers 401 before it answers 501',
    async (segment) => {
      const { app } = createTestApp();

      expect((await app.request(`/bff/v0/${segment}`)).status).toBe(401);
    }
  );

  it.each(STUB_AGGREGATES.map((aggregate) => aggregate.segment))(
    '%s answers 403 before it answers 501',
    async (segment) => {
      const { app } = createTestApp();

      const res = await app.request(`/bff/v0/${segment}`, { headers: bearer(UNPRIVILEGED_TOKEN) });

      expect(res.status).toBe(403);
    }
  );

  it('audits a denial on a stubbed route exactly as on a real one', async () => {
    const { app, sink } = createTestApp();
    await app.request('/bff/v0/claims', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'authorisation.denied',
      targetId: '/bff/v0/claims',
      outcome: 'failure',
      metadata: { permission: 'claim.read' },
    });
  });

  it('applies the write permission to a write, not the read permission', async () => {
    const { app } = createTestApp();

    // A clinician holds task.write, so the stub is reached.
    expect(
      (
        await app.request('/bff/v0/tasks', {
          method: 'POST',
          headers: jsonBearer(TOKENS.clinicianA),
          body: '{}',
        })
      ).status
    ).toBe(501);
    // A clinician does not hold claim.write.
    expect(
      (
        await app.request('/bff/v0/claims', {
          method: 'POST',
          headers: jsonBearer(TOKENS.clinicianA),
          body: '{}',
        })
      ).status
    ).toBe(403);
  });

  it('stubs the instance routes as well as the collection routes', async () => {
    const { app } = createTestApp();

    expect(
      (await app.request(`/bff/v0/orders/${testId(1)}`, { headers: bearer(TOKENS.clinicianA) }))
        .status
    ).toBe(501);
    expect(
      (
        await app.request(`/bff/v0/orders/${testId(1)}`, {
          method: 'PATCH',
          headers: jsonBearer(TOKENS.clinicianA),
          body: '{}',
        })
      ).status
    ).toBe(501);
  });
});

describe('the stub contracts', () => {
  it('publish a list and a create per aggregate, marked not implemented', () => {
    const contracts = stubRouteContracts();

    expect(contracts).toHaveLength(STUB_AGGREGATES.length * 2);
    for (const contract of contracts) {
      expect(contract.summary).toMatch(/Not implemented\.$/);
      expect(contract.responses.map((response) => response.status)).toContain(501);
      expect(contract.permission).toBeDefined();
    }
  });
});

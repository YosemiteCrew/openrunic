import type { Bundle, OperationOutcome } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { decideScope } from '../fhir/scope-guard.js';

import {
  bearer,
  createTestApp,
  DEMO_PORTAL_PATIENT,
  jsonBearer,
  makePatientRow,
  seed,
  testId,
  TOKENS,
} from './support.js';

/**
 * SMART scopes, and the compartment they imply.
 *
 * The claim under test is the strong one: a patient-scoped token can only ever
 * read its own compartment. It is worth testing at the boundary rather than
 * only in the scope parser, because the enforcement is deliberately split - the
 * guard decides whether the interaction is granted at all, and the data layer
 * decides what "its own compartment" means by binding the repositories to the
 * launch context. A test that only exercised the parser would prove the half
 * that cannot leak anything.
 */

function portalHarness(): ReturnType<typeof createTestApp> {
  const harness = createTestApp();
  seed(
    harness.dataset,
    'Patient',
    makePatientRow({ id: DEMO_PORTAL_PATIENT, mrn: 'OR-100482' }),
    makePatientRow({ id: testId(2), mrn: 'OR-100999', familyName: 'Someone-Else' })
  );
  return harness;
}

describe('a patient-scoped token', () => {
  it('reads its own chart', async () => {
    const { app } = portalHarness();

    const res = await app.request(`/fhir/Patient/${DEMO_PORTAL_PATIENT}`, {
      headers: bearer(TOKENS.portalA),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(DEMO_PORTAL_PATIENT);
  });

  it('reads another chart as absent, not as forbidden', async () => {
    const { app } = portalHarness();

    const res = await app.request(`/fhir/Patient/${testId(2)}`, {
      headers: bearer(TOKENS.portalA),
    });

    // 403 would confirm the id exists, which is an enumeration oracle across
    // the compartment boundary just as it would be across the tenant one.
    expect(res.status).toBe(404);
    expect(((await res.json()) as OperationOutcome).issue?.[0]?.code).toBe('not-found');
  });

  it('searches only inside its own compartment', async () => {
    const { app } = portalHarness();

    const res = await app.request('/fhir/Patient', { headers: bearer(TOKENS.portalA) });

    const bundle = (await res.json()) as Bundle;
    expect(bundle.total).toBe(1);
    expect(bundle.entry?.map((entry) => (entry.resource as { id: string }).id)).toEqual([
      DEMO_PORTAL_PATIENT,
    ]);
  });

  it('cannot widen its search by naming another patient', async () => {
    const { app } = portalHarness();

    const res = await app.request(`/fhir/Observation?patient=${testId(2)}`, {
      headers: bearer(TOKENS.portalA),
    });

    // The filter the caller supplied is ANDed with the compartment rather than
    // replacing it, so naming somebody else's chart returns nothing at all.
    expect(res.status).toBe(200);
    expect(((await res.json()) as Bundle).total).toBe(0);
  });

  it('is confined on the internal API too, not only at the FHIR boundary', async () => {
    const { app } = portalHarness();

    const res = await app.request('/bff/v0/patients', { headers: bearer(TOKENS.portalA) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: { total: number } };
    expect(body.page.total).toBe(1);
  });

  it('is refused a resource its scope does not name', async () => {
    const { app } = portalHarness();

    // The portal token holds `patient/*.read` only, so a write is outside it
    // even where the role would have allowed one.
    const res = await app.request('/fhir/Patient', {
      method: 'POST',
      headers: jsonBearer(TOKENS.portalA),
      body: JSON.stringify({ resourceType: 'Patient' }),
    });

    expect(res.status).toBe(403);
  });
});

describe('a staff token', () => {
  it('reaches the whole organisation, because its scope is user-compartment', async () => {
    const { app } = portalHarness();

    const res = await app.request('/fhir/Patient', { headers: bearer(TOKENS.clinicianA) });

    expect(((await res.json()) as Bundle).total).toBe(2);
  });

  it('is refused when the token carries no scope at all', async () => {
    const { app } = portalHarness();

    const res = await app.request('/fhir/Patient', { headers: bearer(TOKENS.noScopeA) });

    expect(res.status).toBe(403);
    const outcome = (await res.json()) as OperationOutcome;
    expect(outcome.issue?.[0]?.code).toBe('forbidden');
    expect(outcome.issue?.[0]?.diagnostics).toContain('no scope');
  });

  it('is refused a patient scope it has no launch context for', async () => {
    const { app } = portalHarness();

    const res = await app.request('/fhir/Patient', {
      headers: bearer(TOKENS.danglingPatientScopeA),
    });

    // Serving this as if it were a user scope would silently widen the grant to
    // the whole organisation, which is exactly what the prefix asked against.
    expect(res.status).toBe(403);
    expect(((await res.json()) as OperationOutcome).issue?.[0]?.diagnostics).toContain(
      'launch context'
    );
  });

  it('still needs the role permission, whatever the scope says', async () => {
    const { app } = portalHarness();

    // The token holds `user/*.read`, and the role holds nothing at all.
    const res = await app.request('/fhir/Patient', { headers: bearer('test-unprivileged') });

    expect(res.status).toBe(403);
  });
});

describe('the scope decision', () => {
  it('resolves to the narrowest compartment that grants the request', () => {
    expect(
      decideScope(['user/Patient.read', 'patient/Patient.read'], testId(1), 'Patient', 'read')
    ).toMatchObject({ compartment: 'patient', compartmentPatientId: testId(1) });
  });

  it('resolves a system scope for a backend service', () => {
    expect(decideScope(['system/Patient.rs'], undefined, 'Patient', 'search')).toMatchObject({
      compartment: 'system',
    });
  });

  it('refuses a verb the scope does not carry', () => {
    expect(() => decideScope(['user/Patient.read'], undefined, 'Patient', 'create')).toThrow(
      /no scope permitting create/
    );
  });

  it('refuses a resource type the scope does not name', () => {
    expect(() => decideScope(['user/Patient.read'], undefined, 'Observation', 'read')).toThrow(
      /no scope permitting read on Observation/
    );
  });

  it('accepts a wildcard resource scope', () => {
    expect(decideScope(['user/*.read'], undefined, 'Observation', 'search')).toMatchObject({
      compartment: 'user',
    });
  });
});

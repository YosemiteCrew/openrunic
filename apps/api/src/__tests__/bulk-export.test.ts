import { describe, expect, it } from 'vitest';

import {
  assertNotCompartmentBound,
  isAfter,
  parseSince,
  parseTypeFilter,
} from '../fhir/bulk-export.js';

import {
  ADMIN_PRINCIPAL,
  bearer,
  createTestApp,
  makePatientRow,
  seed,
  testId,
  TOKENS,
} from './support.js';

/**
 * Bulk export is the operation a client writes code against once and then
 * trusts, so these assert the contract rather than the convenience: the async
 * handshake, the manifest shape, the ndjson body, and the refusals that stop a
 * client believing it received everything when it did not.
 */

const PATIENT = testId(1);

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  seed(created.dataset, 'Patient', makePatientRow({ id: testId(2), mrn: 'OR-2' }));
  return created;
}

const asyncHeaders = { ...bearer(TOKENS.adminA), prefer: 'respond-async' };

describe('bulk export', () => {
  it('answers the kick-off with 202 and somewhere to poll', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export', { headers: asyncHeaders });

    expect(res.status).toBe(202);
    expect(res.headers.get('content-location')).toContain('/fhir/$export-status/');
  });

  /**
   * The specification requires the header. Without it a client may be expecting
   * a synchronous body, and answering 202 to that client produces a silent
   * nothing rather than an error it can report.
   */
  it('refuses a kick-off that did not ask for an async response', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export', { headers: bearer(TOKENS.adminA) });

    expect(res.status).toBe(400);
  });

  it('produces a manifest naming every exported file and its count', async () => {
    const { app } = harness();
    const kickOff = await app.request('/fhir/Patient/$export', { headers: asyncHeaders });
    const status = kickOff.headers.get('content-location') ?? '';

    const res = await app.request(status, { headers: bearer(TOKENS.adminA) });
    const manifest = (await res.json()) as {
      transactionTime: string;
      request: string;
      requiresAccessToken: boolean;
      output: { type: string; url: string; count: number }[];
      error: unknown[];
    };

    expect(res.status).toBe(200);
    expect(manifest.requiresAccessToken).toBe(true);
    expect(manifest.error).toEqual([]);
    const patients = manifest.output.find((file) => file.type === 'Patient');
    expect(patients?.count).toBe(2);
  });

  it('serves each file as ndjson, one resource per line', async () => {
    const { app } = harness();
    const kickOff = await app.request('/fhir/$export', { headers: asyncHeaders });
    const manifest = (await (
      await app.request(kickOff.headers.get('content-location') ?? '', {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as { output: { type: string; url: string }[] };

    const url = manifest.output.find((file) => file.type === 'Patient')?.url ?? '';
    const res = await app.request(url, { headers: bearer(TOKENS.adminA) });
    const body = await res.text();

    expect(res.headers.get('content-type')).toContain('application/fhir+ndjson');
    const lines = body.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect((JSON.parse(line) as { resourceType: string }).resourceType).toBe('Patient');
    }
  });

  it('narrows to the requested types', async () => {
    const { app } = harness();
    const kickOff = await app.request('/fhir/$export?_type=Patient', { headers: asyncHeaders });
    const manifest = (await (
      await app.request(kickOff.headers.get('content-location') ?? '', {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as { output: { type: string }[] };

    expect(manifest.output.map((file) => file.type)).toEqual(['Patient']);
  });

  /**
   * A manifest lists what was produced, not what was asked for, so a silently
   * dropped type is invisible to the client: it receives a complete-looking
   * export missing a resource it named.
   */
  it('refuses a type it does not serve rather than dropping it', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export?_type=Patient,Nonsense', {
      headers: asyncHeaders,
    });

    expect(res.status).toBe(400);
  });

  /**
   * `_since` is the parameter an integration actually runs on: a nightly job
   * asks for what changed since last night. It filters on `meta.lastUpdated`,
   * which the boundary stamps from the row.
   */
  it('exports only what changed since the given instant', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: PATIENT, updatedAt: new Date('2026-01-01T00:00:00.000Z') })
    );
    seed(
      dataset,
      'Patient',
      makePatientRow({
        id: testId(2),
        mrn: 'OR-2',
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      })
    );

    const kickOff = await app.request('/fhir/$export?_since=2026-03-01T00:00:00Z', {
      headers: asyncHeaders,
    });
    const manifest = (await (
      await app.request(kickOff.headers.get('content-location') ?? '', {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as { output: { type: string; count: number }[] };

    expect(manifest.output.find((file) => file.type === 'Patient')?.count).toBe(1);
  });

  /** Every resource excluded is a manifest with nothing in it, not a broken one. */
  it('produces an empty manifest when nothing changed since the instant', async () => {
    const { app } = harness();

    const kickOff = await app.request('/fhir/$export?_since=2030-01-01T00:00:00Z', {
      headers: asyncHeaders,
    });
    const manifest = (await (
      await app.request(kickOff.headers.get('content-location') ?? '', {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as { output: unknown[] };

    expect(manifest.output).toEqual([]);
  });

  it('refuses a _since it cannot read', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export?_since=last-tuesday', { headers: asyncHeaders });

    expect(res.status).toBe(400);
  });

  it('answers 404 for a job it has forgotten', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/$export-status/${testId(999)}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });

  /**
   * The gate is `facility.all`, not `patient.read`. A clinician holds
   * `patient.read` and holds grants for the facilities they work in; every other
   * route honours those grants one facility at a time, and a whole-organisation
   * read is the one that never gets to.
   */
  it('refuses a clinician, who may read patients but not the whole organisation', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export', {
      headers: { ...bearer(TOKENS.clinicianA), prefer: 'respond-async' },
    });

    expect(res.status).toBe(403);
  });

  it('answers 404 for a file the job never produced', async () => {
    const { app } = harness();
    const kickOff = await app.request('/fhir/$export?_type=Patient', { headers: asyncHeaders });
    const id = (kickOff.headers.get('content-location') ?? '').split('/').pop() ?? '';

    const res = await app.request(`/fhir/$export-file/${id}/Encounter`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 when cancelling a job it never had', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/$export-status/${testId(999)}`, {
      method: 'DELETE',
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });

  it('cancels a job, and then does not know it', async () => {
    const { app } = harness();
    const kickOff = await app.request('/fhir/$export', { headers: asyncHeaders });
    const status = kickOff.headers.get('content-location') ?? '';

    const cancelled = await app.request(status, {
      method: 'DELETE',
      headers: bearer(TOKENS.adminA),
    });
    const after = await app.request(status, { headers: bearer(TOKENS.adminA) });

    expect(cancelled.status).toBe(202);
    expect(after.status).toBe(404);
  });

  it('refuses a patient-scoped token, which cannot mean the whole organisation', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export', {
      headers: { ...bearer(TOKENS.portalA), prefer: 'respond-async' },
    });

    expect(res.status).toBe(403);
  });

  /**
   * The compartment refusal is checked in code as well as by the permission,
   * because a tenant may fork the seeded roles: a portal-shaped role granted
   * `facility.all` would pass the route gate, and must still not be able to
   * export the practice from a token pinned to one chart.
   */
  it('refuses a compartment-bound principal outright', () => {
    expect(() =>
      assertNotCompartmentBound({ ...ADMIN_PRINCIPAL, compartmentPatientId: PATIENT })
    ).toThrow(/patient-scoped/);
    expect(() => assertNotCompartmentBound(undefined)).toThrow(/bearer token/);
    expect(() => assertNotCompartmentBound(ADMIN_PRINCIPAL)).not.toThrow();
  });
});

describe('the parsers, at their edges', () => {
  it('treats an absent or blank _type as everything', () => {
    expect(parseTypeFilter(undefined, ['Patient'])).toEqual(['Patient']);
    expect(parseTypeFilter('   ', ['Patient'])).toEqual(['Patient']);
  });

  it('ignores empty entries in a type list', () => {
    expect(parseTypeFilter('Patient,,', ['Patient', 'Encounter'])).toEqual(['Patient']);
  });

  it('reads an instant, and refuses one it cannot', () => {
    expect(parseSince('2026-01-01T00:00:00Z')?.getUTCFullYear()).toBe(2026);
    expect(parseSince(undefined)).toBeUndefined();
    expect(() => parseSince('nope')).toThrow();
  });
});

describe('what _since includes', () => {
  const since = new Date('2026-03-01T00:00:00.000Z');
  const patient = (lastUpdated?: string): Parameters<typeof isAfter>[0] => ({
    resourceType: 'Patient',
    ...(lastUpdated === undefined ? {} : { meta: { lastUpdated } }),
  });

  it('includes a resource updated after the instant, and excludes one before it', () => {
    expect(isAfter(patient('2026-06-01T00:00:00.000Z'), since)).toBe(true);
    expect(isAfter(patient('2026-01-01T00:00:00.000Z'), since)).toBe(false);
  });

  it('includes a resource stamped exactly at the instant', () => {
    expect(isAfter(patient(since.toISOString()), since)).toBe(true);
  });

  /**
   * Both of these mean "this resource cannot be dated", and both include it. An
   * incremental export that dropped what it could not date would let a record
   * vanish from a system that already had it, and nothing downstream would ever
   * report a resource it was never sent.
   */
  it('includes a resource carrying no timestamp at all', () => {
    expect(isAfter(patient(), since)).toBe(true);
  });

  it('includes a resource whose timestamp cannot be read', () => {
    expect(isAfter(patient('not-a-date'), since)).toBe(true);
  });
});

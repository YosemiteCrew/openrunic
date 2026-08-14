import { describe, expect, it } from 'vitest';

import type { PolicyContext } from '../policy/policy.js';
import {
  BULK_EXPORT_OPERATIONS,
  createExportStore,
  EXPORT_LIMIT,
  isAfter,
  jobFor,
  MAX_RETAINED_JOBS,
  NON_COMPARTMENT_TYPES,
  parseSince,
  parseTypeFilter,
  PATIENT_COMPARTMENT_TYPES,
  permittedModules,
  runExport,
  truncationOutcomes,
  type ExportJob,
} from '../fhir/bulk-export.js';
import { SERVED_MODULES } from '../fhir/resources.js';
import type { ScopedRow } from '../repositories/types.js';

import {
  ADMIN_PRINCIPAL,
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  FIXED_NOW,
  makePatientRow,
  seed,
  seedPatients,
  storageColumns,
  testId,
  TOKENS,
} from './support.js';

/**
 * Bulk export is the operation a client writes code against once and then
 * trusts, and it is the largest single disclosure this API can make. These
 * assert the contract rather than the convenience: the async handshake, the
 * manifest shape, the ndjson body, who is refused, and - most of all - that a
 * finished export is reachable only by the principal that ran it.
 */

const PATIENT = testId(1);
const OTHER = testId(2);

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, mrn: 'OR-100482' }));
  seed(created.dataset, 'Patient', makePatientRow({ id: OTHER, mrn: 'OR-100999' }));
  return created;
}

const asyncHeaders = { ...bearer(TOKENS.adminA), prefer: 'respond-async' };

function asyncFor(token: string): Record<string, string> {
  return { ...bearer(token), prefer: 'respond-async' };
}

interface Manifest {
  transactionTime: string;
  request: string;
  requiresAccessToken: boolean;
  output: { type: string; url: string; count: number }[];
  error: { type: string; url: string; count: number }[];
}

/** Kicks off, follows the Content-Location, and returns the manifest. */
async function exportAndPoll(
  app: ReturnType<typeof createTestApp>['app'],
  path = '/fhir/$export',
  token: string = TOKENS.adminA
): Promise<{ manifest: Manifest; statusUrl: string }> {
  const kickOff = await app.request(path, { headers: asyncFor(token) });
  expect(kickOff.status, path).toBe(202);
  const statusUrl = kickOff.headers.get('content-location') ?? '';
  const res = await app.request(statusUrl, { headers: bearer(token) });
  expect(res.status, statusUrl).toBe(200);
  return { manifest: (await res.json()) as Manifest, statusUrl };
}

describe('the async handshake', () => {
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

  it('answers 404 for a job it never had', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/$export-status/${testId(999)}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });

  it('cancels a job, and then does not know it', async () => {
    const { app } = harness();
    const { statusUrl } = await exportAndPoll(app);

    const cancelled = await app.request(statusUrl, {
      method: 'DELETE',
      headers: bearer(TOKENS.adminA),
    });
    const after = await app.request(statusUrl, { headers: bearer(TOKENS.adminA) });

    expect(cancelled.status).toBe(202);
    expect(after.status).toBe(404);
  });

  it('answers 404 when cancelling a job it never had', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/$export-status/${testId(999)}`, {
      method: 'DELETE',
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });
});

describe('the manifest and the files', () => {
  it('names every exported file, its count and its transaction time', async () => {
    const { app } = harness();

    const { manifest } = await exportAndPoll(app, '/fhir/Patient/$export');

    expect(manifest.requiresAccessToken).toBe(true);
    expect(manifest.error).toEqual([]);
    expect(manifest.request).toContain('/fhir/Patient/$export');
    // The value a client stores and sends back as the next `_since`, so it must
    // come from this server's clock during this request. A wrong or invented one
    // makes every subsequent incremental export wrong, and silently.
    expect(manifest.transactionTime).toBe(FIXED_NOW.toISOString());
    expect(manifest.output.find((file) => file.type === 'Patient')?.count).toBe(2);
  });

  it('serves each file as ndjson, containing the patients that were seeded', async () => {
    const { app } = harness();
    const { manifest } = await exportAndPoll(app);

    const url = manifest.output.find((file) => file.type === 'Patient')?.url ?? '';
    const res = await app.request(url, { headers: bearer(TOKENS.adminA) });
    const body = await res.text();

    expect(res.headers.get('content-type')).toContain('application/fhir+ndjson');
    const resources = body
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { resourceType: string; id: string });
    // By id, not by count: a count passes just as well when the file holds two
    // of somebody else's patients.
    expect(resources.map((resource) => resource.id).sort()).toEqual([PATIENT, OTHER].sort());
    expect(resources.every((resource) => resource.resourceType === 'Patient')).toBe(true);
  });

  it('refuses a file fetch carrying no token, which is what requiresAccessToken claims', async () => {
    const { app } = harness();
    const { manifest } = await exportAndPoll(app);
    const url = manifest.output[0]?.url ?? '';

    const res = await app.request(url);

    expect(res.status).toBe(401);
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
});

describe('who may reach a finished export', () => {
  /**
   * The job id is a uuid in a `Content-Location` header: it travels through
   * proxies, logs and browser history. It is an identifier, and this asserts it
   * is not also the credential.
   */
  it('does not serve one organisation an export another organisation ran', async () => {
    const { app } = harness();
    const { manifest, statusUrl } = await exportAndPoll(app);
    const fileUrl = manifest.output[0]?.url ?? '';

    const status = await app.request(statusUrl, { headers: bearer(TOKENS.adminB) });
    const file = await app.request(fileUrl, { headers: bearer(TOKENS.adminB) });

    expect(status.status).toBe(404);
    expect(file.status).toBe(404);
  });

  /**
   * Same organisation, same role, different person. The files are a snapshot
   * taken under one principal's scopes; handing them to a second one would
   * launder the first one's access.
   */
  it('does not serve one administrator an export a colleague ran', async () => {
    const { app } = harness();
    const { manifest, statusUrl } = await exportAndPoll(app);
    const fileUrl = manifest.output[0]?.url ?? '';

    const status = await app.request(statusUrl, { headers: bearer(TOKENS.secondAdminA) });
    const file = await app.request(fileUrl, { headers: bearer(TOKENS.secondAdminA) });
    const cancel = await app.request(statusUrl, {
      method: 'DELETE',
      headers: bearer(TOKENS.secondAdminA),
    });

    expect(status.status).toBe(404);
    expect(file.status).toBe(404);
    expect(cancel.status).toBe(404);
  });
});

describe('who may run one', () => {
  /**
   * The gate is `facility.all`, not `patient.read`. A clinician holds
   * `patient.read` and grants for the facilities they work in; every other route
   * honours those grants one facility at a time, and a whole-organisation read
   * is the one that never gets to.
   */
  it('refuses a clinician, who may read patients but not the whole organisation', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export', { headers: asyncFor(TOKENS.clinicianA) });

    expect(res.status).toBe(403);
  });

  it('refuses a portal login', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export', { headers: asyncFor(TOKENS.portalA) });

    expect(res.status).toBe(403);
  });

  /**
   * The one that matters, because the portal refusal above comes from the
   * permission rather than from the compartment. This principal holds every
   * permission there is and is still pinned to one chart, which is what a tenant
   * that forks the seeded roles could produce.
   */
  it('refuses a token pinned to one chart even when it holds every permission', async () => {
    const { app } = harness();

    const kickOff = await app.request('/fhir/$export', {
      headers: asyncFor(TOKENS.compartmentAdminA),
    });

    expect(kickOff.status).toBe(403);
    expect(await kickOff.text()).toContain('patient-scoped');
  });

  it('refuses that same token on the poll, the file and the cancel', async () => {
    const { app } = harness();
    const { manifest, statusUrl } = await exportAndPoll(app);
    const fileUrl = manifest.output[0]?.url ?? '';

    for (const [path, method] of [
      [statusUrl, 'GET'],
      [fileUrl, 'GET'],
      [statusUrl, 'DELETE'],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: bearer(TOKENS.compartmentAdminA),
      });

      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('audits the compartment refusal, the way the permission gate audits its own', async () => {
    const { app, auditStore } = harness();

    await app.request('/fhir/$export', { headers: asyncFor(TOKENS.compartmentAdminA) });

    const denials = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'authorisation.denied' && event.outcome === 'failure');
    expect(denials).toHaveLength(1);
    expect(String(denials[0]?.metadata?.reason)).toContain('patient-scoped');
  });
});

describe('what a token is allowed to take', () => {
  /**
   * `runExport` calls `module.search` directly, and that method enforces
   * nothing: the per-type scope and permission live on the routes the export
   * does not go through. Without the narrowing this asserts, a token authorised
   * for Patients alone would walk out with Claims, Observations and the audit
   * log served as Provenance.
   */
  it('exports only the types the token was authorised to ask for', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Encounter', makeEncounterSeed());

    const { manifest } = await exportAndPoll(app, '/fhir/$export', TOKENS.patientScopeAdminA);

    expect(manifest.output.map((file) => file.type)).toEqual(['Patient']);
  });

  it('refuses by name a type the caller asked for and may not have', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export?_type=Provenance', {
      headers: asyncFor(TOKENS.patientScopeAdminA),
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Provenance');
  });

  /** A resource served for read only is not exportable; an export is a search. */
  it('leaves out a resource that cannot be searched', () => {
    const entry = BULK_EXPORT_OPERATIONS[0];
    expect(entry).toBeDefined();
    const readOnly = {
      ...SERVED_MODULES[0],
      interactions: ['read'],
    } as unknown as (typeof SERVED_MODULES)[number];

    expect(permittedModules([readOnly], ADMIN_PRINCIPAL, adminPolicy(), entry!)).toEqual([]);
  });

  it('narrows the permitted list by permission as well as by scope', () => {
    const entry = BULK_EXPORT_OPERATIONS[0];
    const readsNothing: PolicyContext = {
      roles: [],
      permissions: new Set(),
      facilityIds: [],
      can: () => false,
      canAccessFacility: () => true,
    };

    expect(entry).toBeDefined();
    expect(permittedModules(SERVED_MODULES, ADMIN_PRINCIPAL, readsNothing, entry!)).toEqual([]);
    // Absent policy denies too: a route mounted outside the chain must refuse
    // rather than expose.
    expect(permittedModules(SERVED_MODULES, ADMIN_PRINCIPAL, undefined, entry!)).toEqual([]);
  });
});

describe('the two entry points are not aliases', () => {
  it('classifies every served type as in or out of the Patient compartment', () => {
    for (const module of SERVED_MODULES) {
      const inside = PATIENT_COMPARTMENT_TYPES.has(module.type);
      const outside = NON_COMPARTMENT_TYPES.has(module.type);

      expect(inside || outside, `${module.type} is classified`).toBe(true);
      expect(inside && outside, `${module.type} is classified once`).toBe(false);
    }
  });

  it('leaves the practice directory out of the patient-level export', () => {
    const system = BULK_EXPORT_OPERATIONS.find((entry) => entry.scope === 'system');
    const patient = BULK_EXPORT_OPERATIONS.find((entry) => entry.scope === 'Patient');
    expect(system).toBeDefined();
    expect(patient).toBeDefined();

    const wide = permittedModules(SERVED_MODULES, ADMIN_PRINCIPAL, adminPolicy(), system!);
    const narrow = permittedModules(SERVED_MODULES, ADMIN_PRINCIPAL, adminPolicy(), patient!);

    expect(wide.map((module) => module.type)).toContain('Practitioner');
    expect(narrow.map((module) => module.type)).not.toContain('Practitioner');
    expect(narrow.map((module) => module.type)).not.toContain('Location');
    expect(narrow.map((module) => module.type)).toContain('Patient');
  });
});

describe('_type', () => {
  it('narrows to the requested types, leaving out one that has rows', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Encounter', makeEncounterSeed());

    const everything = await exportAndPoll(app);
    const narrowed = await exportAndPoll(app, '/fhir/$export?_type=Patient');

    // The comparison is what makes this test able to fail: Encounter is present
    // when nothing narrows it and absent when something does.
    expect(everything.manifest.output.map((file) => file.type)).toContain('Encounter');
    expect(narrowed.manifest.output.map((file) => file.type)).toEqual(['Patient']);
  });

  it('reads every value of a repeated parameter, not only the first', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Encounter', makeEncounterSeed());

    const { manifest } = await exportAndPoll(app, '/fhir/$export?_type=Patient&_type=Encounter');

    expect(manifest.output.map((file) => file.type).sort()).toEqual(['Encounter', 'Patient']);
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

  it('refuses an unimplemented parameter rather than ignoring it', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export?_typeFilter=Patient%3Factive%3Dtrue', {
      headers: asyncHeaders,
    });

    expect(res.status).toBe(400);
  });
});

describe('_since', () => {
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
        id: OTHER,
        mrn: 'OR-100999',
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      })
    );

    const { manifest } = await exportAndPoll(app, '/fhir/$export?_since=2026-03-01T00:00:00Z');

    expect(manifest.output.find((file) => file.type === 'Patient')?.count).toBe(1);
  });

  it('produces an empty manifest when nothing changed since the instant', async () => {
    const { app } = harness();

    const { manifest } = await exportAndPoll(app, '/fhir/$export?_since=2030-01-01T00:00:00Z');

    expect(manifest.output).toEqual([]);
  });

  it('refuses a _since it cannot read', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export?_since=last-tuesday', { headers: asyncHeaders });

    expect(res.status).toBe(400);
  });

  /**
   * The dangerous one. `new Date` accepts this and reads it in the server's
   * local timezone, so a client in another zone would receive an export missing
   * up to a day of changes with nothing to indicate it.
   */
  it('refuses an instant with no timezone offset', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/$export?_since=2026-03-01T00:00:00', {
      headers: asyncHeaders,
    });

    expect(res.status).toBe(400);
  });
});

describe('the audit trail', () => {
  it('records what left, by type and count', async () => {
    const { app, auditStore } = harness();

    await exportAndPoll(app);

    const created = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'export.created');
    expect(created).toHaveLength(1);
    expect(created[0]?.metadata).toMatchObject({ exported: { Patient: 2 } });
  });

  /**
   * The download touches no repository, so it emits none of the read events that
   * make auditing structural everywhere else - and it is the request where the
   * data actually leaves the building.
   */
  it('records the download, which no repository read would have caught', async () => {
    const { app, auditStore } = harness();
    const { manifest } = await exportAndPoll(app);

    await app.request(manifest.output[0]?.url ?? '', { headers: bearer(TOKENS.adminA) });

    const downloads = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'export.downloaded');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.metadata).toMatchObject({ type: 'Patient', count: 2 });
  });
});

describe('the bounds, which are reported rather than silent', () => {
  it('pages past one repository page rather than stopping at it', async () => {
    const { app, dataset } = createTestApp();
    seedPatients(dataset, 600);

    const { manifest } = await exportAndPoll(app);

    expect(manifest.output.find((file) => file.type === 'Patient')?.count).toBe(600);
  });

  it('keeps only the most recent jobs, and forgets the oldest', () => {
    const store = createExportStore(2);
    const job = (id: string): ExportJob => ({
      id,
      tenantId: 't',
      subject: 's',
      requestUrl: 'http://localhost/fhir/$export',
      transactionTime: '2026-08-14T00:00:00.000Z',
      files: [],
      errors: [],
    });

    store.create(job('a'));
    store.create(job('b'));
    store.create(job('c'));

    expect(store.size).toBe(2);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('c')).toBeDefined();
    expect(MAX_RETAINED_JOBS).toBeGreaterThan(0);
  });

  /**
   * The bound is real, so the report has to be real too: a manifest that says
   * `error: []` over a short file is a client that believes it has the whole
   * record and will never ask again.
   */
  it('stops at the ceiling and says so, rather than returning a short file quietly', async () => {
    const { app, dataset } = createTestApp();
    seedPatients(dataset, 600);

    let captured: Awaited<ReturnType<typeof runExport>> | undefined;
    app.get('/probe', async (c) => {
      captured = await runExport(c, SERVED_MODULES, ['Patient'], undefined, 5);
      return c.body(null, 204);
    });
    const res = await app.request('/probe', { headers: bearer(TOKENS.adminA) });

    expect(res.status).toBe(204);
    expect(captured?.truncations).toEqual([{ type: 'Patient', exported: 5, total: 600 }]);
    expect(captured?.files[0]?.count).toBe(5);
  });

  it('reports a truncated type as an OperationOutcome rather than a short file', () => {
    const files = truncationOutcomes([{ type: 'Observation', exported: 50_000, total: 61_000 }]);

    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe('OperationOutcome');
    const outcome = JSON.parse(files[0]?.ndjson ?? '{}') as {
      resourceType: string;
      issue: { code: string; diagnostics: string }[];
    };
    expect(outcome.resourceType).toBe('OperationOutcome');
    expect(outcome.issue[0]?.code).toBe('too-costly');
    expect(outcome.issue[0]?.diagnostics).toContain('61000');
    expect(outcome.issue[0]?.diagnostics).toContain(String(EXPORT_LIMIT));
  });

  it('says nothing at all when nothing was truncated', () => {
    expect(truncationOutcomes([])).toEqual([]);
  });
});

describe('jobFor, at its edges', () => {
  const store = createExportStore();
  const job: ExportJob = {
    id: 'job-1',
    tenantId: ADMIN_PRINCIPAL.tenantId,
    subject: ADMIN_PRINCIPAL.subject,
    requestUrl: 'http://localhost/fhir/$export',
    transactionTime: '2026-08-14T00:00:00.000Z',
    files: [],
    errors: [],
  };
  store.create(job);

  it('returns the job to the principal that ran it', () => {
    expect(jobFor(store, 'job-1', ADMIN_PRINCIPAL)).toBe(job);
  });

  it('refuses another tenant, another subject and an unknown id alike', () => {
    expect(() => jobFor(store, 'job-1', { ...ADMIN_PRINCIPAL, tenantId: 'other' })).toThrow();
    expect(() => jobFor(store, 'job-1', { ...ADMIN_PRINCIPAL, subject: 'other' })).toThrow();
    expect(() => jobFor(store, 'nope', ADMIN_PRINCIPAL)).toThrow();
  });
});

describe('the parsers, at their edges', () => {
  const served = ['Patient', 'Encounter'];

  it('treats an absent or blank _type as everything permitted', () => {
    expect(parseTypeFilter([], served, ['Patient'])).toEqual(['Patient']);
    expect(parseTypeFilter(['   '], served, ['Patient'])).toEqual(['Patient']);
  });

  it('ignores empty entries in a type list', () => {
    expect(parseTypeFilter(['Patient,,'], served, served)).toEqual(['Patient']);
  });

  it('reads an instant, and refuses what is not one', () => {
    expect(parseSince('2026-01-01T00:00:00Z')?.getUTCFullYear()).toBe(2026);
    expect(parseSince('2026-01-01T00:00:00.123+05:30')?.getUTCFullYear()).toBe(2025);
    expect(parseSince(undefined)).toBeUndefined();
    expect(parseSince('  ')).toBeUndefined();
    for (const bad of ['nope', '2026', '2026-01-01', 'March 5, 2026', '2026-13-01T00:00:00Z']) {
      expect(() => parseSince(bad), bad).toThrow();
    }
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

/** Every permission and every facility, matching ADMIN_PRINCIPAL's roles. */
function adminPolicy(): PolicyContext {
  return {
    roles: ['admin'],
    permissions: new Set(),
    facilityIds: [],
    can: () => true,
    canAccessFacility: () => true,
  };
}

/** One encounter, so an export has a second resource type to contain. */
function makeEncounterSeed(): ScopedRow<'Encounter'> {
  return {
    ...storageColumns(testId(300)),
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT,
    providerId: testId(900),
    appointmentId: null,
    class: 'AMBULATORY',
    status: 'COMPLETED',
    reasonCode: null,
    reasonText: null,
    startedAt: FIXED_NOW,
    endedAt: null,
    signedAt: null,
    signedById: null,
  };
}

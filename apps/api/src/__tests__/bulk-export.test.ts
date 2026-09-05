import { describe, expect, it } from 'vitest';

import type { Principal } from '../auth/principal.js';
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
  type ExportStore,
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

  /**
   * A count that lands exactly on a page boundary is the case where "the page
   * was short, so it was the last one" says nothing. The repository's own total
   * is what ends the loop instead, and without it this would cost an extra round
   * trip on every export whose count divides evenly.
   */
  it('stops on a count that lands exactly on a page boundary', async () => {
    const { app, dataset } = createTestApp();
    seedPatients(dataset, 500);

    const { manifest } = await exportAndPoll(app);

    expect(manifest.output.find((file) => file.type === 'Patient')?.count).toBe(500);
  });

  it('keeps only the most recent jobs, and forgets the oldest', () => {
    const store = createExportStore(2);
    const job = (id: string): ExportJob => ({
      id,
      tenantId: 't',
      subject: 's',
      entry: SYSTEM_ENTRY,
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

  /**
   * A record the projection cannot represent, in the one format that has
   * nowhere to say so.
   *
   * A search answers this with an `outcome` entry. NDJSON has no entries, so
   * the manifest's `error` array is where it has to land - and it must not
   * arrive dressed as a ceiling, because a ceiling is answered by narrowing the
   * export and this is answered by nothing the client can do.
   */
  /**
   * The page after the one that held the unprojectable record.
   *
   * A withheld row leaves the page, so a page of five hundred comes back with
   * four hundred and ninety-nine - and the loop reads a short page as the last
   * page. Everything after it is then dropped from the export, silently, with a
   * manifest reporting one withheld record and a file missing far more than
   * one. A truncation caused by a diagnostic is the worst way to learn of one.
   *
   * Five hundred and one dispenses, with the unprojectable one sorted first so
   * it is certainly on the first page rather than probably.
   */
  it('does not read a page shortened by a withheld row as the last page', async () => {
    const { app, dataset } = createTestApp();
    const chart = testId(8000);
    const provider = testId(900);
    const item = testId(8001);
    const lot = testId(8002);
    seed(dataset, 'Patient', makePatientRow({ id: chart, mrn: 'OR-800100' }));
    seed(dataset, 'StockItem', {
      ...storageColumns(item),
      sku: 'MET-500',
      name: 'Metformin 500 mg tablet',
      unit: 'tablet',
      rxnormCode: '860975',
      ndcCode: null,
      cvxCode: null,
      packSize: null,
      reorderLevel: null,
      controlled: false,
      controlledSchedule: null,
      active: true,
    });
    seed(dataset, 'StockLot', {
      ...storageColumns(lot),
      itemId: item,
      facilityId: DEMO_FACILITY_A,
      lotNumber: 'LOT-8000',
      status: 'AVAILABLE',
      expiresOn: null,
      openedOn: null,
      beyondUseDays: null,
      manufacturer: null,
      ndcCode: null,
      receivedOn: FIXED_NOW,
    });

    const posting = (id: string, occurredOn: Date): void => {
      seed(dataset, 'StockPosting', {
        ...storageColumns(id),
        kind: 'DISPENSE',
        facilityId: DEMO_FACILITY_A,
        patientId: chart,
        encounterId: null,
        prescriptionId: null,
        immunizationId: null,
        occurredOn,
        postedById: provider,
        witnessedById: null,
        reference: null,
        note: null,
      });
    };
    const movement = (id: string, postingId: string, lotSeq: number): void => {
      seed(dataset, 'StockMovement', {
        ...storageColumns(id),
        postingId,
        lotId: lot,
        itemId: item,
        facilityId: DEMO_FACILITY_A,
        kind: 'DISPENSE',
        quantity: 1,
        occurredOn: FIXED_NOW,
        actorId: provider,
        reason: null,
        correctsMovementId: null,
        lotSeq,
      });
    };

    // Sorted first by `occurredOn desc`, so it is on the first page by
    // construction rather than by luck - a test that happened to put it on the
    // second page would pass against the bug it exists to catch.
    const unprojectable = testId(8100);
    posting(unprojectable, new Date(FIXED_NOW.getTime() + 60_000));
    for (let index = 0; index < 51; index += 1) {
      movement(testId(8200 + index), unprojectable, index + 1);
    }
    for (let index = 0; index < 500; index += 1) {
      const id = testId(9000 + index);
      posting(id, new Date(FIXED_NOW.getTime() - (index + 1) * 1000));
      movement(testId(20_000 + index), id, 1);
    }

    let captured: Awaited<ReturnType<typeof runExport>> | undefined;
    app.get('/probe', async (c) => {
      captured = await runExport(c, SERVED_MODULES, ['MedicationDispense'], undefined);
      return c.body(null, 204);
    });
    await app.request('/probe', { headers: bearer(TOKENS.adminA) });

    // Every dispense that could be projected, including the five hundredth,
    // which lives on the page the old signal never asked for.
    expect(captured?.files[0]?.count).toBe(500);
    expect(captured?.truncations[0]?.withheld).toHaveLength(1);
    expect(captured?.truncations[0]?.withheld?.[0]).toContain(unprojectable);
  });

  it('reports a withheld record as its own reason, not as a ceiling', () => {
    const files = truncationOutcomes([
      {
        type: 'MedicationDispense',
        exported: 4,
        total: 5,
        withheld: ['MedicationDispense/x was drawn from more than 50 lots.'],
      },
    ]);

    const outcome = JSON.parse(files[0]?.ndjson ?? '{}') as {
      issue?: { code?: string; diagnostics?: string }[];
    };

    expect(outcome.issue?.map((issue) => issue.code)).toEqual(['incomplete']);
    // The ceiling did not bite, so its advice must not appear. Telling a client
    // to narrow an export that is short for another reason sends them round a
    // loop that cannot end.
    expect(JSON.stringify(outcome)).not.toContain('Narrow the export');
  });

  it('reports both reasons when the ceiling bit as well', () => {
    /* The pair is what says the two are distinguished rather than one of them
       being reported for both causes. */
    const files = truncationOutcomes(
      [{ type: 'Observation', exported: 50, total: 200, withheld: ['Observation/y is unusable.'] }],
      50
    );

    const outcome = JSON.parse(files[0]?.ndjson ?? '{}') as { issue?: { code?: string }[] };

    expect(outcome.issue?.map((issue) => issue.code)).toEqual(['too-costly', 'incomplete']);
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

/** The system-level entry, read off the list the router mounts rather than retyped. */
const SYSTEM_ENTRY = BULK_EXPORT_OPERATIONS.find((operation) => operation.scope === 'system')!;

describe('jobFor, at its edges', () => {
  /** A policy context that permits everything, so scopes are the only variable. */
  const allowAll: PolicyContext = {
    roles: ['admin'],
    permissions: new Set(),
    facilityIds: [],
    can: () => true,
    canAccessFacility: () => true,
  };

  const storeWith = (files: ExportJob['files']): { store: ExportStore; job: ExportJob } => {
    const store = createExportStore();
    const job: ExportJob = {
      id: 'job-1',
      tenantId: ADMIN_PRINCIPAL.tenantId,
      subject: ADMIN_PRINCIPAL.subject,
      entry: SYSTEM_ENTRY,
      requestUrl: 'http://localhost/fhir/$export',
      transactionTime: '2026-08-14T00:00:00.000Z',
      files,
      errors: [],
    };
    store.create(job);
    return { store, job };
  };

  const fetchWith = (store: ExportStore, principal: Principal): ExportJob =>
    jobFor(store, 'job-1', principal, allowAll, SERVED_MODULES);

  it('returns the job to the principal that ran it', () => {
    const { store, job } = storeWith([]);
    expect(fetchWith(store, ADMIN_PRINCIPAL)).toBe(job);
  });

  it('refuses another tenant, another subject and an unknown id alike', () => {
    const { store } = storeWith([]);
    expect(() => fetchWith(store, { ...ADMIN_PRINCIPAL, tenantId: 'other' })).toThrow();
    expect(() => fetchWith(store, { ...ADMIN_PRINCIPAL, subject: 'other' })).toThrow();
    expect(() => jobFor(store, 'nope', ADMIN_PRINCIPAL, allowAll, SERVED_MODULES)).toThrow();
  });

  /**
   * The case the subject check alone cannot see.
   *
   * One person holds more than one token: a SMART app authorised for
   * `user/Patient.read` and a back-office session authorised for everything are
   * the same subject in the same tenant. A job created under the broad
   * authorisation and fetched under the narrow one used to hand the narrow
   * application every Claim and Provenance in the practice, because a bulk job
   * id is an identifier and was being spent as a credential.
   */
  it('refuses a token of the same user that could not have created the export', () => {
    const { store } = storeWith([
      { type: 'Patient', ndjson: '', count: 0 },
      { type: 'Claim', ndjson: '', count: 0 },
    ]);
    const narrow: Principal = { ...ADMIN_PRINCIPAL, scopes: ['user/Patient.read'] };

    expect(() => fetchWith(store, narrow)).toThrow(/Claim/);
    // The same job, under the authorisation that made it, still comes back.
    expect(() => fetchWith(store, ADMIN_PRINCIPAL)).not.toThrow();
  });

  it('serves an export whose every type the narrower token still covers', () => {
    const { store, job } = storeWith([{ type: 'Patient', ndjson: '', count: 0 }]);
    const narrow: Principal = { ...ADMIN_PRINCIPAL, scopes: ['user/Patient.read'] };

    expect(fetchWith(store, narrow)).toBe(job);
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

describe('an authorised organisation-wide export is exempt from the per-chart care gate', () => {
  it('exports a chart the exporter has no care relationship with', async () => {
    // The regression the care-relationship gate introduced: $export walks every
    // chart-bearing resource through module.search, and the gate would 404 the
    // whole export on the first patient the exporter is not treating. An
    // organisation-wide export is authorised differently - facility.all, an
    // org-scoped token, each module's permission - and must not require a
    // relationship with every patient. This patient has clinical data but NO
    // encounter or appointment, so nothing gives adminA a care relationship.
    const { app, dataset } = harness();
    seed(dataset, 'Condition', {
      id: testId(9401),
      tenantId: DEMO_TENANT_A,
      patientId: PATIENT,
      encounterId: null,
      category: 'PROBLEM_LIST_ITEM',
      code: 'E11.9',
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Type 2 diabetes mellitus',
      snomedCode: null,
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      onsetDate: null,
      abatementDate: null,
      severityCode: null,
      bodySiteCode: null,
      note: null,
      recordedAt: FIXED_NOW,
      recordedById: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    } as never);

    const { manifest } = await exportAndPoll(app, '/fhir/$export?_type=Condition');

    expect(manifest.output.map((file) => file.type)).toContain('Condition');
  });
});

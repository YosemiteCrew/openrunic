import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProblemDocument } from '../http/problem.js';
import type { PatientDto } from '../schemas/patients.js';
import type { ListResponse } from '../schemas/pagination.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_B,
  FIXED_NOW,
  makeAppointmentRow,
  jsonBearer,
  makePatientRow,
  seedPatients,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
  seedCareRelationship,
  SUBJECTS,
  seed,
} from './support.js';

const VALID_BODY = {
  mrn: 'OR-100482',
  givenName: 'Testina',
  familyName: 'Patientsson',
  birthDate: '1994-03-02',
};

describe('GET /bff/v0/patients', () => {
  it('returns one page and the whole-set total', async () => {
    const { app, dataset } = createTestApp();
    seedPatients(dataset, 30);

    const res = await app.request('/bff/v0/patients?page=2&pageSize=10', {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse<PatientDto>;
    expect(body.data).toHaveLength(10);
    expect(body.page).toEqual({ page: 2, pageSize: 10, total: 30, totalPages: 3 });
  });

  it('reports one empty page for an empty index, never zero pages', async () => {
    const { app } = createTestApp();

    const body = (await (
      await app.request('/bff/v0/patients', { headers: bearer(TOKENS.frontDeskA) })
    ).json()) as ListResponse<PatientDto>;

    expect(body.data).toEqual([]);
    expect(body.page).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  });

  it('searches by name prefix, MRN, birth date and free text', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: testId(1), mrn: 'OR-100482', preferredName: 'Tess' }),
      makePatientRow({ id: testId(2), mrn: 'OR-100999', familyName: 'Nobody', givenName: 'Nemo' })
    );
    const search = async (query: string): Promise<ListResponse<PatientDto>> =>
      (await (
        await app.request(`/bff/v0/patients?${query}`, { headers: bearer(TOKENS.frontDeskA) })
      ).json()) as ListResponse<PatientDto>;

    expect((await search('family=Patient')).data[0]?.id).toBe(testId(1));
    expect((await search('mrn=OR-100999')).data[0]?.id).toBe(testId(2));
    expect((await search('birthDate=1994-03-02')).data).toHaveLength(2);
    expect((await search('q=Tess')).data[0]?.id).toBe(testId(1));
    expect((await search('given=Nemo&sort=birthDate&order=desc')).data[0]?.id).toBe(testId(2));
  });

  it.each([
    ['an unknown parameter', 'famliy=Pat'],
    ['a page below one', 'page=0'],
    ['a page size over the cap', 'pageSize=1000'],
    ['a non-numeric page', 'page=first'],
    ['a malformed birth date', 'birthDate=02-03-1994'],
    ['an unknown sort key', 'sort=luck'],
    ['a non-boolean active flag', 'active=maybe'],
  ])('rejects %s with a 400 problem document', async (_label, query) => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/patients?${query}`, {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as ProblemDocument;
    expect(body.type).toBe('https://openrunic.org/problems/malformed-request');
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  it('denies a principal whose roles grant no permissions', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('patient.read');
  });

  it('audits the denial as a failure', async () => {
    const { app, sink } = createTestApp();
    await app.request('/bff/v0/patients', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'authorisation.denied',
      outcome: 'failure',
      metadata: { permission: 'patient.read' },
    });
  });
});

describe('GET /bff/v0/patients/:id', () => {
  it('reads one patient', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.clinicianA });

    const res = await app.request(`/bff/v0/patients/${testId(1)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatientDto;
    expect(body).toMatchObject({
      id: testId(1),
      mrn: 'OR-100482',
      name: { given: 'Testina', family: 'Patientsson' },
      birthDate: '1994-03-02',
    });
  });

  it('emits a date of birth with no time component', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.clinicianA });

    const body = (await (
      await app.request(`/bff/v0/patients/${testId(1)}`, { headers: bearer(TOKENS.clinicianA) })
    ).json()) as PatientDto;

    expect(body.birthDate).toBe('1994-03-02');
    expect(body.createdAt).toMatch(/T.*Z$/);
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/patients/${testId(77)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('400s an id that is not a UUID, without reaching the store', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients/12', { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(400);
    expect(((await res.json()) as ProblemDocument).errors?.[0]?.path).toBe('id');
  });
});

describe('POST /bff/v0/patients', () => {
  it('registers a patient and points at it', async () => {
    const { app, dataset } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as PatientDto;
    expect(res.headers.get('location')).toBe(`/bff/v0/patients/${body.id}`);
    expect(dataset.table('Patient')).toHaveLength(1);
  });

  it('422s a body that parses but breaks the contract', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ ...VALID_BODY, birthDate: 'not-a-date' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemDocument;
    expect(body.type).toBe('https://openrunic.org/problems/validation-failed');
    expect(body.errors?.[0]?.path).toBe('birthDate');
  });

  it('422s an unexpected field rather than dropping it', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ ...VALID_BODY, tenantId: testId(1) }),
    });

    expect(res.status).toBe(422);
  });

  it('400s a body that is not JSON at all', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: '{ not json',
    });

    expect(res.status).toBe(400);
  });

  it('409s a duplicate MRN', async () => {
    const { app } = createTestApp();
    const post = () =>
      app.request('/bff/v0/patients', {
        method: 'POST',
        headers: jsonBearer(TOKENS.frontDeskA),
        body: JSON.stringify(VALID_BODY),
      });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(409);
  });

  it('denies a role without patient.write', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.billerA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('patient.write');
  });
});

describe('PATCH /bff/v0/patients/:id', () => {
  it('amends the fields it was given and leaves the rest alone', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.frontDeskA });

    const res = await app.request(`/bff/v0/patients/${testId(1)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ preferredName: 'Tess' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatientDto;
    expect(body.name).toMatchObject({ preferred: 'Tess', family: 'Patientsson' });
  });

  it('refuses to reassign the MRN', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.frontDeskA });

    const res = await app.request(`/bff/v0/patients/${testId(1)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ mrn: 'OR-999999' }),
    });

    expect(res.status).toBe(422);
    expect(dataset.table('Patient')[0]?.mrn).toBe('OR-100482');
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/patients/${testId(77)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ preferredName: 'Tess' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('audit', () => {
  it('emits one batched read event per request, not one per row', async () => {
    const { app, dataset, sink } = createTestApp();
    seedPatients(dataset, 5);

    await app.request('/bff/v0/patients', { headers: bearer(TOKENS.frontDeskA) });

    expect(sink.reads()).toHaveLength(1);
    expect(sink.reads()[0]?.event.metadata.targetCount).toBe(5);
  });

  it('records a create as a transactional write plus the read of what it returned', async () => {
    const { app, sink } = createTestApp();
    await app.request('/bff/v0/patients', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(sink.writes()).toHaveLength(1);
    expect(sink.writes()[0]).toMatchObject({
      transactional: true,
      event: { action: 'patient.created', actorId: '01890000-0000-7000-8000-000000000102' },
    });
  });
});

/**
 * The decision in #139, asserted on the surface a clinician actually uses.
 *
 * `Patient.primaryFacilityId` is the site that registered somebody, not the
 * site an act happened at. Narrowing reads on it hid the chart of a patient
 * registered at the north clinic from the clinician treating them at the south
 * clinic - and still showed a patient registered south who has only ever been
 * seen north. Wrong in both directions is not a boundary.
 *
 * These pin the answer on the BFF. `fhir.resources.test.ts` pins the same
 * answer on the FHIR boundary, which used to implement the opposite, and the
 * point of having both is that the two cannot drift apart again silently.
 */
describe('a site-limited clinician and a chart registered somewhere else', () => {
  const ELSEWHERE = testId(4242);

  function seedElsewhere(dataset: ReturnType<typeof createTestApp>['dataset']): void {
    seed(
      dataset,
      'Patient',
      makePatientRow({
        id: ELSEWHERE,
        mrn: 'OR-100990',
        familyName: 'Annexeson',
        primaryFacilityId: DEMO_FACILITY_B,
      })
    );
  }

  /**
   * #169 changes the answer #139 gave here, and this records the change rather
   * than quietly deleting the old assertion.
   *
   * #139 asked whether a chart registered at another site should be readable by
   * id, and answered yes, because the clinician holding the id is treating that
   * person. The reasoning was sound and the mechanism was not: it authorised
   * everyone who could name the chart, not everyone treating the patient, and
   * those are only the same set when nobody guesses.
   *
   * The clinician with the patient in front of them still gets in. They take
   * break-glass, which is one request, and afterwards the chart is open to them
   * and the trail says why. That is the case below.
   */
  it('refuses a chart nothing connects this reader to', async () => {
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);

    const res = await app.request(`/bff/v0/patients/${ELSEWHERE}`, {
      headers: bearer(TOKENS.siteReaderA),
    });

    /* Absent, not forbidden. A 403 would confirm the id names a real patient,
       which is the enumeration oracle the cross-tenant read already avoids. */
    expect(res.status).toBe(404);
  });

  it('opens the chart of the patient in front of them, once they say so', async () => {
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);

    const declared = await app.request(`/bff/v0/patients/${ELSEWHERE}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Collapsed in reception, no record at this site.' }),
    });
    expect(declared.status).toBe(201);

    const res = await app.request(`/bff/v0/patients/${ELSEWHERE}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
  });

  it('marks a read taken under break-glass as break-glass, not as ordinary access', async () => {
    /* The whole control. A trail that recorded the two identically would make
       the loud thing quiet, and break-glass would be an ordinary read with an
       extra step. */
    const { app, dataset, sink } = createTestApp();
    seedElsewhere(dataset);

    await app.request(`/bff/v0/patients/${ELSEWHERE}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Collapsed in reception.' }),
    });
    await app.request(`/bff/v0/patients/${ELSEWHERE}`, { headers: bearer(TOKENS.clinicianA) });

    const actions = sink.writes().map((entry) => entry.event.action);
    expect(actions).toContain('chart.access.breakGlass');
    expect(actions).not.toContain('chart.access');
  });

  it('refuses to amend a chart nothing connects this reader to', async () => {
    /*
     * Writing a chart needs at least as much standing as reading one. A rule
     * that gated the read and not the amendment would be a rule anybody could
     * walk round by sending a PATCH, and the PATCH response would confirm the
     * chart exists into the bargain.
     */
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);

    const res = await app.request(`/bff/v0/patients/${ELSEWHERE}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ familyName: 'Renamed' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns the declaration already held rather than filing a second one', async () => {
    /*
     * Re-declaring is ordinary: the window is short and an emergency outlasts
     * it. A row per attempt would turn one clinician's afternoon into a wall of
     * records that buries the sweep this table exists to make visible.
     *
     * It is also what keeps the trail unambiguous. A read taken under
     * break-glass is audited as break-glass, and if one reader could hold two
     * overlapping grants on one chart the record would not say which of them
     * the read was taken under. Two grants for the same pair are unreachable
     * through this route, so the question does not arise.
     */
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);
    const declare = async (): Promise<Response> =>
      app.request(`/bff/v0/patients/${ELSEWHERE}/break-glass`, {
        method: 'POST',
        headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Collapsed in reception.' }),
      });

    const first = await declare();
    const second = await declare();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { id: string }).id).toBe(
      ((await first.json()) as { id: string }).id
    );
  });

  it('files one grant, not two, when the same chart is declared twice at once', async () => {
    /*
     * The race the sequential test above cannot see.
     *
     * That test declares twice in a row, so the second read finds the first
     * row and the handler returns it without ever reaching the create. Sent
     * together, both requests read no grant - the handler awaits between the
     * read and the create, so the two interleave at exactly that point - and
     * both went on to file one. The documented idempotency held only for
     * requests that happened not to overlap, which is not a property, and near
     * the ceiling the loser surfaced a limit error where this route documents
     * a 200.
     *
     * This is a real reproduction rather than a simulation: the in-memory store
     * is a real implementation of the same port, and the interleaving is the
     * handler's own, not something the test arranges.
     *
     * What closes it is the natural key on the spec, which both stores enforce
     * inside the create. Against Postgres there is a second race underneath
     * this one - two connections can pass a check-then-write that one event
     * loop cannot - and `break_glass_ceiling` refuses that loser under the
     * advisory lock it already holds. `packages/database` asserts that half
     * against a real server; this asserts the half the API owns, which is that
     * losing is answered with the winner's grant rather than with an error.
     */
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);
    const declare = async (): Promise<Response> =>
      app.request(`/bff/v0/patients/${ELSEWHERE}/break-glass`, {
        method: 'POST',
        headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Collapsed in reception.' }),
      });

    const [first, second] = await Promise.all([declare(), declare()]);
    const bodies = await Promise.all([first.json(), second.json()]);

    // One of the two won; which one is not a property worth asserting.
    expect([first.status, second.status].toSorted((a, b) => a - b)).toEqual([200, 201]);
    expect((bodies[0] as { id: string }).id).toBe((bodies[1] as { id: string }).id);
    expect(dataset.table('BreakGlassGrant')).toHaveLength(1);
  });

  it('refuses a break-glass declaration with no reason', async () => {
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);

    const res = await app.request(`/bff/v0/patients/${ELSEWHERE}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '   ' }),
    });

    expect(res.status).toBe(422);
  });

  /**
   * The two bounds on break-glass, and why one of them is not enough.
   *
   * These are the only things standing between "an emergency door with a name
   * on it" and "a way to read the whole practice one request at a time", so
   * both are asserted here rather than left to the database trigger that also
   * enforces them. The trigger is the thing that is true under concurrency; the
   * handler is the thing that gives a person a sentence they can act on, and a
   * refusal nobody tested is a refusal nobody has seen.
   */
  describe('the bounds on how much glass one reader may break', () => {
    const CEILING = 10;
    const PER_WINDOW = 20;

    /* Only `Date` is faked. The bounds are questions about wall-clock instants
       and the handler reads the clock directly, but faking timers as well would
       stall the awaits these tests are made of. */
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(FIXED_NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function aChart(dataset: ReturnType<typeof createTestApp>['dataset'], n: number): string {
      const id = testId(4300 + n);
      seed(
        dataset,
        'Patient',
        makePatientRow({
          id,
          mrn: `OR-2009${String(n).padStart(2, '0')}`,
          familyName: `Elsewhere${String(n)}`,
          primaryFacilityId: DEMO_FACILITY_B,
        })
      );
      return id;
    }

    async function declare(
      app: ReturnType<typeof createTestApp>['app'],
      patientId: string,
      minutes?: number
    ): Promise<Response> {
      return app.request(`/bff/v0/patients/${patientId}/break-glass`, {
        method: 'POST',
        headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: 'Collapsed in reception.',
          ...(minutes === undefined ? {} : { minutes }),
        }),
      });
    }

    it('refuses the chart past the ceiling, and says which bound was reached', async () => {
      const { app, dataset, sink } = createTestApp();
      const charts = Array.from({ length: CEILING + 1 }, (_, n) => aChart(dataset, n));

      const statuses: number[] = [];
      for (const id of charts) statuses.push((await declare(app, id)).status);

      expect(statuses.slice(0, CEILING)).toEqual(Array.from({ length: CEILING }, () => 201));
      expect(statuses[CEILING]).toBe(403);
      const refusals = sink
        .writes()
        .filter((entry) => entry.event.action === 'breakGlass.denied')
        .map((entry) => entry.event.metadata?.['reason']);
      expect(refusals).toEqual(['ceiling']);
    });

    /**
     * The bound the ceiling cannot be.
     *
     * The ceiling counts what is still in force and the caller picks the
     * expiry, so a one-minute window empties every slot a minute later: ten
     * charts, wait, ten more, all afternoon, and nothing is ever over the
     * ceiling. That loop is exactly what `spend` does below, and the point of
     * the test is that the ceiling waves all of it through.
     */
    async function spend(
      app: ReturnType<typeof createTestApp>['app'],
      dataset: ReturnType<typeof createTestApp>['dataset'],
      count: number
    ): Promise<void> {
      for (let n = 0; n < count; n += 1) {
        if (n > 0 && n % CEILING === 0) {
          /* Past the ceiling only because the last batch has expired, which is
             the whole trick: nothing here is ever concurrent. */
          vi.setSystemTime(new Date(Date.now() + 2 * 60_000));
        }
        expect((await declare(app, aChart(dataset, n), 1)).status).toBe(201);
      }
    }

    it('refuses a reader whose earlier declarations have all expired', async () => {
      const { app, dataset, sink } = createTestApp();
      await spend(app, dataset, PER_WINDOW);
      vi.setSystemTime(new Date(Date.now() + 2 * 60_000));

      const next = await declare(app, aChart(dataset, PER_WINDOW));

      expect(next.status).toBe(403);
      /* The number in the sentence, because a refusal that does not say which
         bound was reached leaves the reader with nothing to do about it. */
      expect(((await next.json()) as ProblemDocument).detail).toContain(String(PER_WINDOW));
      const reasons = sink
        .writes()
        .filter((entry) => entry.event.action === 'breakGlass.denied')
        .map((entry) => entry.event.metadata?.['reason']);
      expect(reasons).toEqual(['rolling-limit']);
    });

    it('lets the window pass and the reader carry on', async () => {
      /* The other half: a bound that never released would be a lockout dressed
         as a limit, and the refusal above says "ask an administrator" only
         because the alternative is a clinician stuck out of every chart. */
      const { app, dataset } = createTestApp();
      await spend(app, dataset, PER_WINDOW);
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 25 * 60 * 60_000));

      expect((await declare(app, aChart(dataset, PER_WINDOW))).status).toBe(201);
    });
  });

  it('does not record a grant against an id that names nobody', async () => {
    /* Otherwise this route is the enumeration oracle the read path refuses to
       be: post a guess, and a 201 tells you the chart exists. */
    const { app, sink } = createTestApp();

    const res = await app.request(`/bff/v0/patients/${testId(4243)}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Fishing.' }),
    });

    expect(res.status).toBe(404);
    expect(sink.writes().map((entry) => entry.event.action)).not.toContain('breakGlass.created');
  });

  /**
   * And still does not get them in a listing.
   *
   * The two halves of #139 want different answers, which is the whole point:
   * the clinician holding an id is treating that person, while a caller paging
   * a list is browsing. Narrowing the list is what keeps a site-limited caller
   * out of the practice's whole index of names, MRNs and birth dates.
   */
  it('does not find them in the list, because that is browsing rather than treating', async () => {
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);

    const res = await app.request('/bff/v0/patients?pageSize=50', {
      headers: bearer(TOKENS.siteReaderA),
    });
    const body = (await res.json()) as ListResponse<PatientDto>;

    expect(body.data.map((item) => item.id)).not.toContain(ELSEWHERE);
  });

  /**
   * And what does still confine them. The sited collections narrow on
   * `facilityId` - where the act happened - which is where the things a
   * site-limited clinician should not see actually live.
   */
  it('still cannot see an appointment at the other site', async () => {
    const { app, dataset } = createTestApp();
    seedElsewhere(dataset);
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(4243), patientId: ELSEWHERE, facilityId: DEMO_FACILITY_B })
    );

    const res = await app.request('/bff/v0/appointments?pageSize=50', {
      headers: bearer(TOKENS.siteReaderA),
    });
    const body = (await res.json()) as ListResponse<{ id: string }>;

    expect(body.data.map((item) => item.id)).not.toContain(testId(4243));
  });
});

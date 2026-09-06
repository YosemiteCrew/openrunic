import { describe, expect, it } from 'vitest';

import { REFERRAL_STATUSES } from '@openrunic/database';

import { clinicalSpecs } from '../repositories/specs/clinical.js';
import type { ScopedRow } from '../repositories/rows.js';

import { matchesWhere } from './fake-port.js';

import {
  bearer,
  createTestApp,
  DEMO_TENANT_A,
  FIXED_NOW,
  jsonBearer,
  makePatientRow,
  seed,
  seedCareRelationship,
  testId,
  TOKENS,
} from './support.js';

/**
 * Referrals, and the loop.
 *
 * Creating one is the easy half. What these assert is the half that goes wrong:
 * that a referral cannot reach a closed-looking state without the facts that
 * make it closed, that the transitions refuse the moves that would corrupt the
 * record, and that the tray shows what is genuinely outstanding.
 */

const PATIENT = testId(1);
const USER = testId(951);
/** The subject `TOKENS.clinicianA` resolves to. */
const CLINICIAN = '01890000-0000-7000-8000-000000000101';

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  /*
   * Every referral in this file names PATIENT, and reading or moving one now
   * asks the care-relationship gate (#322). Without this the whole file
   * describes a clinician with no business in that chart, which is not the
   * caller any of these cases is about - and it is what let seventeen of them
   * assert a 200 through a door that had no gate at all.
   *
   * Seeded as an appointment rather than an encounter: an encounter would
   * satisfy the same relationship source and show up in nothing here either,
   * but the appointment is the cheaper row and the one `seedCareRelationship`
   * offers for exactly this.
   */
  seedCareRelationship(created.dataset, {
    patientId: PATIENT,
    providerId: CLINICIAN,
    as: 'appointment',
  });
  return created;
}

interface Referral {
  id: string;
  status: string;
  priority: string;
  sentAt: string | null;
  scheduledFor: string | null;
  seenAt: string | null;
  reportReceivedAt: string | null;
  reportDocumentId: string | null;
  declinedReason: string | null;
  awaiting: string | null;
  receivingPractice: string;
  authorisationNumber: string | null;
}

async function create(
  app: ReturnType<typeof createTestApp>['app'],
  overrides: Record<string, unknown> = {}
): Promise<Referral> {
  const res = await app.request('/bff/v0/referrals', {
    method: 'POST',
    headers: jsonBearer(TOKENS.clinicianA),
    body: JSON.stringify({
      patientId: PATIENT,
      referredById: USER,
      specialtyCode: '394579002',
      specialtyDisplay: 'Cardiology',
      receivingPractice: 'Example Cardiology Associates',
      reasonCodes: ['I25.10'],
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Referral;
}

async function step(
  app: ReturnType<typeof createTestApp>['app'],
  id: string,
  segment: string,
  body: Record<string, unknown> = {},
  token: string = TOKENS.clinicianA
): Promise<Response> {
  return app.request(`/bff/v0/referrals/${id}/${segment}`, {
    method: 'POST',
    headers: jsonBearer(token),
    body: JSON.stringify(body),
  });
}

async function stepOk(
  app: ReturnType<typeof createTestApp>['app'],
  id: string,
  segment: string,
  body: Record<string, unknown> = {}
): Promise<Referral> {
  const res = await step(app, id, segment, body);
  expect(res.status, segment).toBe(200);
  return (await res.json()) as Referral;
}

describe('raising one', () => {
  /**
   * Every other status is reached through a transition that stamps its own
   * timestamp. One created already sent would be a referral nobody can say when
   * they sent, which is the number the tray is built on - so the input schema
   * has no `status` field at all, and being strict it refuses one outright
   * rather than ignoring it.
   */
  it('is born a draft', async () => {
    const { app } = harness();

    const referral = await create(app);

    expect(referral.status).toBe('DRAFT');
    expect(referral.sentAt).toBeNull();
    expect(referral.awaiting).toBe('to be sent');
  });

  it('refuses a caller trying to create one already sent', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/referrals', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        patientId: PATIENT,
        referredById: USER,
        specialtyCode: 'X',
        specialtyDisplay: 'X',
        receivingPractice: 'X',
        status: 'SENT',
      }),
    });

    expect(res.status).toBe(422);
  });

  it('keeps the priority it was raised at', async () => {
    const { app } = harness();

    expect((await create(app, { priority: 'URGENT' })).priority).toBe('URGENT');
  });

  it('refuses an NPI that is not ten digits', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/referrals', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        patientId: PATIENT,
        referredById: USER,
        specialtyCode: 'X',
        specialtyDisplay: 'X',
        receivingPractice: 'X',
        receivingNpi: '123',
      }),
    });

    expect(res.status).toBe(422);
  });
});

describe('the loop, closing', () => {
  it('walks the ordinary path and records a fact at each step', async () => {
    const { app } = harness();
    const referral = await create(app);

    const sent = await stepOk(app, referral.id, 'send');
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).not.toBeNull();
    expect(sent.awaiting).toBe('an appointment');

    const accepted = await stepOk(app, referral.id, 'accept');
    expect(accepted.status).toBe('ACCEPTED');

    const scheduled = await stepOk(app, referral.id, 'schedule', {
      scheduledFor: '2026-09-01T09:00:00.000Z',
    });
    expect(scheduled.scheduledFor).toBe('2026-09-01T09:00:00.000Z');
    expect(scheduled.awaiting).toBe('the appointment');

    const seen = await stepOk(app, referral.id, 'seen', { seenAt: '2026-09-01T09:20:00.000Z' });
    expect(seen.seenAt).toBe('2026-09-01T09:20:00.000Z');
    expect(seen.awaiting).toBe('a report');

    const closed = await stepOk(app, referral.id, 'report', {
      reportReceivedAt: '2026-09-05T00:00:00.000Z',
    });
    expect(closed.status).toBe('COMPLETED');
    expect(closed.reportReceivedAt).toBe('2026-09-05T00:00:00.000Z');
    expect(closed.awaiting).toBeNull();
  });

  /**
   * Practices schedule before the specialist has formally accepted often enough
   * that it is the norm at some of them, so the graph permits it.
   */
  it('lets a referral be scheduled without a formal acceptance', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'send');

    const scheduled = await stepOk(app, referral.id, 'schedule', {
      scheduledFor: '2026-09-01T09:00:00.000Z',
    });

    expect(scheduled.status).toBe('SCHEDULED');
  });

  /**
   * The state this whole feature exists to make impossible: a referral that
   * looks closed on every screen with nothing having come back.
   */
  it('will not reach COMPLETED without a report date', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'send');
    await stepOk(app, referral.id, 'seen', { seenAt: '2026-09-01T09:20:00.000Z' });

    const res = await step(app, referral.id, 'report', {});

    expect(res.status).toBe(422);
  });

  it('will not jump straight from sent to completed', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'send');

    const res = await step(app, referral.id, 'report', {
      reportReceivedAt: '2026-09-05T00:00:00.000Z',
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('cannot move from SENT to COMPLETED');
  });

  it('will not send a referral twice', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'send');

    expect((await step(app, referral.id, 'send')).status).toBe(409);
  });

  it('will not move anything out of a struck-out referral', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'cancel');

    expect((await step(app, referral.id, 'send')).status).toBe(409);
  });

  /**
   * `sentAt` is the moment this practice let go of the referral. A
   * caller-supplied one would let a backdated send hide how long something has
   * been outstanding.
   */
  it('stamps the send time itself rather than taking one', async () => {
    const { app } = harness();
    const referral = await create(app);

    const sent = await stepOk(app, referral.id, 'send', {
      sentAt: '2020-01-01T00:00:00.000Z',
    });

    expect(sent.sentAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('carries a changed recipient and an authorisation through the send', async () => {
    const { app } = harness();
    const referral = await create(app);

    const sent = await stepOk(app, referral.id, 'send', {
      receivingPractice: 'Another Cardiology Practice',
      authorisationNumber: 'AUTH-9',
    });

    expect(sent.receivingPractice).toBe('Another Cardiology Practice');
    expect(sent.authorisationNumber).toBe('AUTH-9');
  });
});

describe('a referral that does not close', () => {
  /**
   * A declined referral has to go somewhere else, and the person sending it
   * needs to know whether it was the wrong specialty, a closed list, or an
   * insurance problem.
   */
  it('requires a reason to decline, and keeps it', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'send');

    expect((await step(app, referral.id, 'decline', {})).status).toBe(422);

    const declined = await stepOk(app, referral.id, 'decline', {
      reason: 'Not accepting new patients',
    });
    expect(declined.declinedReason).toBe('Not accepting new patients');
    expect(declined.awaiting).toBe('a new recipient');
  });

  it('lets a declined referral be sent somewhere else', async () => {
    const { app } = harness();
    const referral = await create(app);
    await stepOk(app, referral.id, 'send');
    await stepOk(app, referral.id, 'decline', { reason: 'Closed list' });

    const resent = await stepOk(app, referral.id, 'send', {
      receivingPractice: 'A Third Practice',
    });

    expect(resent.status).toBe('SENT');
    expect(resent.receivingPractice).toBe('A Third Practice');
  });

  it('says a cancelled referral is waiting on nothing', async () => {
    const { app } = harness();
    const referral = await create(app);

    expect((await stepOk(app, referral.id, 'cancel')).awaiting).toBeNull();
  });
});

describe('the outstanding tray', () => {
  /**
   * "Still open" is a clinical question with one right answer, and every caller
   * assembling their own status list is how two screens come to disagree about
   * how many referrals are outstanding.
   */
  it('counts what has been sent and not closed, and nothing else', async () => {
    const { app } = harness();

    const draft = await create(app);
    const sent = await create(app);
    await stepOk(app, sent.id, 'send');
    const declined = await create(app);
    await stepOk(app, declined.id, 'send');
    await stepOk(app, declined.id, 'decline', { reason: 'Closed list' });
    const closed = await create(app);
    await stepOk(app, closed.id, 'send');
    await stepOk(app, closed.id, 'seen', { seenAt: '2026-09-01T09:00:00.000Z' });
    await stepOk(app, closed.id, 'report', { reportReceivedAt: '2026-09-05T00:00:00.000Z' });

    const res = await app.request('/bff/v0/referrals?openOnly=true', {
      headers: bearer(TOKENS.clinicianA),
    });
    const body = (await res.json()) as { items: Referral[]; total: number };

    expect(body.items.map((item) => item.id)).toEqual([sent.id]);
    expect(body.total).toBe(1);
    expect(body.items.map((item) => item.id)).not.toContain(draft.id);
  });

  /**
   * Both filters at once. They used to write the same `where` key from two
   * spreads, so the second won at construction and the explicit status vanished
   * from the Postgres query while `matches` went on ANDing them. That divergence
   * is invisible to the HTTP suite, which runs on the memory port, so the spec
   * assertions below check the emitted `where` shape rather than only the answer.
   */
  it('narrows the tray by status rather than ignoring one of the two filters', async () => {
    const { app } = harness();

    const sent = await create(app);
    await stepOk(app, sent.id, 'send');
    const accepted = await create(app);
    await stepOk(app, accepted.id, 'send');
    await stepOk(app, accepted.id, 'accept');

    const res = await app.request('/bff/v0/referrals?openOnly=true&status=SENT', {
      headers: bearer(TOKENS.clinicianA),
    });
    const body = (await res.json()) as { items: Referral[]; total: number };

    // Both are open. Only one is SENT, and asking for SENT inside the tray has
    // to mean both, not whichever filter was applied last.
    expect(body.items.map((item) => item.id)).toEqual([sent.id]);
  });

  it('returns nothing for a status that cannot be open, rather than the whole tray', async () => {
    const { app } = harness();

    const sent = await create(app);
    await stepOk(app, sent.id, 'send');
    const declined = await create(app);
    await stepOk(app, declined.id, 'send');
    await stepOk(app, declined.id, 'decline', { reason: 'Closed list' });

    const res = await app.request('/bff/v0/referrals?openOnly=true&status=DECLINED', {
      headers: bearer(TOKENS.clinicianA),
    });
    const body = (await res.json()) as { items: Referral[]; total: number };

    // DECLINED is closed, so the intersection is empty. Before the fix this
    // returned every open referral from Postgres.
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('lists everything when the flag is not set', async () => {
    const { app } = harness();
    await create(app);
    const sent = await create(app);
    await stepOk(app, sent.id, 'send');

    const res = await app.request('/bff/v0/referrals', { headers: bearer(TOKENS.clinicianA) });

    expect(((await res.json()) as { total: number }).total).toBe(2);
  });

  it('narrows by patient, specialty and status', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Patient', makePatientRow({ id: testId(2), mrn: 'OR-2' }));
    // The second chart needs its own relationship: the list gate asks about
    // every chart the page returns, and this case is about the filters rather
    // than about the gate. Without it the `status=DRAFT` row is refused and
    // reads as the narrowing being wrong.
    seedCareRelationship(dataset, {
      patientId: testId(2),
      providerId: CLINICIAN,
      as: 'appointment',
      id: testId(8_002),
    });
    await create(app);
    await create(app, { patientId: testId(2), specialtyCode: '394582007' });

    const byPatient = await app.request(`/bff/v0/referrals?patientId=${testId(2)}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const bySpecialty = await app.request('/bff/v0/referrals?specialtyCode=394579002', {
      headers: bearer(TOKENS.clinicianA),
    });
    const byStatus = await app.request('/bff/v0/referrals?status=DRAFT', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(((await byPatient.json()) as { total: number }).total).toBe(1);
    expect(((await bySpecialty.json()) as { total: number }).total).toBe(1);
    expect(((await byStatus.json()) as { total: number }).total).toBe(2);
  });

  it('sorts the urgent ones to the top', async () => {
    const { app } = harness();
    await create(app, { priority: 'ROUTINE' });
    const asap = await create(app, { priority: 'ASAP' });

    const res = await app.request('/bff/v0/referrals?sort=priority&order=asc', {
      headers: bearer(TOKENS.clinicianA),
    });
    const body = (await res.json()) as { items: Referral[] };

    expect(body.items[0]?.id).toBe(asap.id);
  });
});

describe('who may touch one', () => {
  it('refuses a caller with no token', async () => {
    const { app } = harness();

    expect((await app.request('/bff/v0/referrals')).status).toBe(401);
  });

  it('refuses a reader trying to raise one', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/referrals', {
      method: 'POST',
      headers: jsonBearer(TOKENS.billerA),
      body: JSON.stringify({
        patientId: PATIENT,
        referredById: USER,
        specialtyCode: 'X',
        specialtyDisplay: 'X',
        receivingPractice: 'X',
      }),
    });

    expect(res.status).toBe(403);
  });

  it('answers 404 for a referral this organisation does not have', async () => {
    const { app } = harness();
    const referral = await create(app);

    const res = await app.request(`/bff/v0/referrals/${referral.id}`, {
      headers: bearer(TOKENS.clinicianB),
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 for an id that is not one', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/referrals/${testId(999)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('refuses a malformed id with a 400 rather than a 404', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/referrals/not-a-uuid', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /bff/v0/referrals, and what a malformed query gets', () => {
  const badQueries = [
    ['patientId=not-a-uuid', 'patientId'],
    ['encounterId=12', 'encounterId'],
    ['status=nonsense', 'status'],
    ['priority=WHENEVER', 'priority'],
    ['page=0', 'page'],
    ['pageSize=9000', 'pageSize'],
  ] as const;

  /**
   * 400, not 500. This route parsed its query with `schema.parse`, which throws
   * a ZodError rather than an ApiError, so the boundary treated a caller's typo
   * as an unexpected internal fault: it logged it and answered 500. Every other
   * list route on this surface answers 400 for the same input.
   *
   * `status` and `priority` are in this table because they used to be
   * `z.string()` cast to an enum at the call site - so a value no column can
   * hold passed validation and produced its 500 one layer further down, in the
   * repository.
   */
  it.each(badQueries)('400s %s rather than raising a server error', async (query, field) => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/referrals?${query}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status, query).toBe(400);
    const body = (await res.json()) as { errors?: { path?: string }[] };
    expect(
      body.errors?.some((issue) => issue.path === field),
      query
    ).toBe(true);
  });

  it('still serves the filters it does accept', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/referrals?status=DRAFT&priority=ROUTINE', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
  });
});

/**
 * The `where` the referral spec emits, asserted as a shape.
 *
 * These exist because the HTTP tests above cannot see the bug they guard. The
 * whole suite runs on the memory port, where `matches` decides, and `matches`
 * was always right. The defect lived only in the Prisma `where`, where two
 * spreads wrote one key and the second silently won. So the assertion has to be
 * about the object handed to Prisma, not about the answer that came back.
 */
describe('the referral status filter', () => {
  const paged = { page: 1, pageSize: 25, sort: 'createdAt', order: 'desc' } as const;
  const open = ['SENT', 'ACCEPTED', 'SCHEDULED', 'SEEN'];

  it('sends the tray through as the set of open statuses', () => {
    expect(clinicalSpecs.referrals.where({ ...paged, openOnly: true })).toEqual({
      status: { in: open },
    });
  });

  it('sends a bare status through as a set of one', () => {
    expect(clinicalSpecs.referrals.where({ ...paged, status: 'DECLINED' })).toEqual({
      status: { in: ['DECLINED'] },
    });
  });

  it('meets the tray and the status rather than emitting one of them', () => {
    expect(clinicalSpecs.referrals.where({ ...paged, openOnly: true, status: 'SENT' })).toEqual({
      status: { in: ['SENT'] },
    });
  });

  it('emits a filter that matches nothing when the status cannot be open', () => {
    // Before the fix this emitted `{ status: { in: [...open] } }` - the whole
    // tray, for a caller who asked for the declined ones inside it.
    expect(clinicalSpecs.referrals.where({ ...paged, openOnly: true, status: 'DECLINED' })).toEqual(
      { status: { in: [] } }
    );
  });

  it('emits a filter that matches nothing for a DRAFT asked for inside the tray', () => {
    // DRAFT is the status the reproducer on this bug used, and it was the case
    // furthest from the fix: nothing that is still a draft has been sent, so it
    // can never be open.
    expect(clinicalSpecs.referrals.where({ ...paged, openOnly: true, status: 'DRAFT' })).toEqual({
      status: { in: [] },
    });
  });

  it('leaves the clause out when neither is given', () => {
    expect(clinicalSpecs.referrals.where({ ...paged })).toEqual({});
  });

  /**
   * The invariant the fix exists to establish, asserted directly.
   *
   * Every test above pins the shape `where` emits, which is necessary but not
   * sufficient: a shape can be pinned correctly and still disagree with what
   * `matches` does with the same query, and it is that disagreement - not the
   * shape - that let the two ports return different rows.
   *
   * So this evaluates the emitted `where` against the same row `matches` sees,
   * using `matchesWhere`, the same Prisma-where interpreter the fake port uses
   * to answer queries. Every combination of the two parameters against every
   * referral status: 9 statuses x (9 + 1 status values) x 2 openOnly values.
   *
   * `CollectionSpec` says the two must agree (`collection.ts`, on `matches` and
   * on `where`). Before this, nothing in the repository checked that they did.
   */
  it('agrees with matches for every status, in and out of the tray', () => {
    // Only the columns either side reads for this query. `createdAt` is here
    // because `matches` ends on the date window, which is open at both ends.
    const referral = (status: string): ScopedRow<'Referral'> =>
      ({ status, createdAt: FIXED_NOW }) as unknown as ScopedRow<'Referral'>;

    const disagreements: string[] = [];
    for (const asked of [...REFERRAL_STATUSES, undefined]) {
      for (const openOnly of [true, false]) {
        const query = {
          ...paged,
          ...(asked === undefined ? {} : { status: asked }),
          ...(openOnly ? { openOnly: true } : {}),
        } as Parameters<typeof clinicalSpecs.referrals.where>[0];
        const emitted = clinicalSpecs.referrals.where(query);

        for (const rowStatus of REFERRAL_STATUSES) {
          const row = referral(rowStatus);
          const memory = clinicalSpecs.referrals.matches(row, query);
          const prisma = matchesWhere(row as unknown as Record<string, unknown>, emitted);
          if (memory !== prisma) {
            disagreements.push(
              `status=${asked ?? 'any'} openOnly=${openOnly} row=${rowStatus}: memory=${memory} prisma=${prisma}`
            );
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});

/* --------------------------------------- the chart gate on this whole surface
   --------------------------------------- (#322) */

/**
 * Every door into a referral, driven by a clinician with no relationship to the
 * chart it names.
 *
 * `referrals` is registered by hand rather than generated, so none of it went
 * through the CRUD seam where `chartFrom` puts the care-relationship gate on a
 * read. That makes this a wider hole than the one #322 found on `orders.ts`:
 * there the generated read was refused and only the hand-registered writes were
 * open, so the finding was the asymmetry. Here the READ was open too, and so was
 * the list - a caller holding `order.read` was answered every referral in the
 * tenant, each naming a patient, a specialty and a reason code.
 *
 * Driven on `dev` before this change, one clinician with no relationship:
 * `GET /referrals/{id}` 200 with the patient on it, `GET /referrals` 200 with
 * two charts in the page, and all seven transitions 200. The control that
 * identifies the reader is a `notes` read on the same chart with the same
 * token: 404 without the relationship and 200 with it.
 *
 * Each door gets its own case, so un-gating one lands on that one rather than on
 * a neighbour, and each is seeded in the state its transition is legal from -
 * otherwise `assertTransition` answers 409 before the gate is reached and a
 * refusal that never happened reads as one that did.
 */
describe('a referral is not readable or movable from outside the chart', () => {
  const STRANGER_PATIENT = testId(7401);
  const SECOND_PATIENT = testId(7402);

  function makeReferralRow(
    id: string,
    overrides: Partial<ScopedRow<'Referral'>> = {}
  ): ScopedRow<'Referral'> {
    return {
      id,
      tenantId: DEMO_TENANT_A,
      patientId: STRANGER_PATIENT,
      encounterId: null,
      referredById: USER,
      status: 'DRAFT',
      priority: 'ROUTINE',
      specialtyCode: '394579002',
      specialtyDisplay: 'Cardiology',
      receivingPractice: 'Example Cardiology Associates',
      receivingNpi: null,
      receivingPhone: null,
      reasonCodes: ['I25.10'],
      reasonText: null,
      note: null,
      authorisationNumber: null,
      sentAt: null,
      scheduledFor: null,
      seenAt: null,
      reportReceivedAt: null,
      reportDocumentId: null,
      declinedReason: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      ...overrides,
    };
  }

  /** One referral per door, each already in the state that door moves it out of. */
  const DOORS = [
    ['send', testId(7410), 'DRAFT', {}],
    ['accept', testId(7411), 'SENT', {}],
    ['decline', testId(7412), 'SENT', { reason: 'Closed list.' }],
    ['schedule', testId(7413), 'ACCEPTED', { scheduledFor: '2026-10-01T09:00:00.000Z' }],
    ['seen', testId(7414), 'SCHEDULED', { seenAt: '2026-10-01T09:30:00.000Z' }],
    ['report', testId(7415), 'SEEN', { reportReceivedAt: '2026-10-02T09:00:00.000Z' }],
    ['cancel', testId(7416), 'DRAFT', {}],
  ] as const;

  /** Every referral seeded, and NO care relationship to the chart they name. */
  function strangerApp(): ReturnType<typeof createTestApp> {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: STRANGER_PATIENT, mrn: 'OR-7401' }));
    seed(created.dataset, 'Patient', makePatientRow({ id: SECOND_PATIENT, mrn: 'OR-7402' }));
    for (const [, id, status] of DOORS) {
      seed(created.dataset, 'Referral', makeReferralRow(id, { status }));
    }
    // A second chart, so the list has more than one to be refused over and a
    // page that leaks is visibly tenant-wide rather than one row.
    seed(created.dataset, 'Referral', makeReferralRow(testId(7420), { patientId: SECOND_PATIENT }));
    return created;
  }

  function authorise(dataset: ReturnType<typeof createTestApp>['dataset'], ...ids: string[]): void {
    ids.forEach((patientId, index) => {
      seedCareRelationship(dataset, {
        patientId,
        providerId: CLINICIAN,
        as: 'appointment',
        id: testId(8_100 + index),
      });
    });
  }

  it.each(DOORS)(
    'POST /referrals/:id/%s is refused on a chart nothing connects the writer to',
    async (segment, id, _status, body) => {
      const { app } = strangerApp();

      // 404 and not 403, the same as every other chart refusal: a 403 confirms
      // the row exists to somebody who may not see it.
      expect((await step(app, id, segment, body)).status).toBe(404);
    }
  );

  it.each(DOORS)(
    'POST /referrals/:id/%s still answers a writer who is in that patient care',
    async (segment, id, _status, body) => {
      const created = strangerApp();
      authorise(created.dataset, STRANGER_PATIENT);

      // The reachable control. Without it every row above is also satisfied by a
      // route that refuses everyone, which would take the loop out of the product
      // while reading as the gate working.
      expect((await step(created.app, id, segment, body)).status).toBe(200);
    }
  );

  it('GET /referrals/:id is refused, and answers once the relationship exists', async () => {
    const refused = strangerApp();
    const allowed = strangerApp();
    authorise(allowed.dataset, STRANGER_PATIENT);

    const [outside, inside] = await Promise.all([
      refused.app.request(`/bff/v0/referrals/${testId(7410)}`, {
        headers: bearer(TOKENS.clinicianA),
      }),
      allowed.app.request(`/bff/v0/referrals/${testId(7410)}`, {
        headers: bearer(TOKENS.clinicianA),
      }),
    ]);

    expect(outside.status).toBe(404);
    expect(inside.status).toBe(200);
  });

  it('GET /referrals refuses a page carrying a chart the reader is not in', async () => {
    /*
     * The broad-list shape. A list of chart data is a read of every chart it
     * returns, and the caller naming no `patientId` is the request that asks
     * for everything - so the gate, not the query, has to answer it. Before
     * this change that page came back 200 with both patients in it.
     */
    const { app, dataset } = strangerApp();
    authorise(dataset, STRANGER_PATIENT);

    const res = await app.request('/bff/v0/referrals', { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(404);
  });

  it('GET /referrals answers the page once every chart in it is reachable', async () => {
    const { app, dataset } = strangerApp();
    authorise(dataset, STRANGER_PATIENT, SECOND_PATIENT);

    const res = await app.request('/bff/v0/referrals', { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(DOORS.length + 1);
  });
});

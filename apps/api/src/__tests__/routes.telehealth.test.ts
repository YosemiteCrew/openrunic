import { AdapterRegistry } from '@openrunic/adapters';
import { describe, expect, it } from 'vitest';

import type { JoinTokenResponse, TelehealthVisitDto } from '../schemas/telehealth.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  makeAppointmentRow,
  seed,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * The telehealth lifecycle, against the in-process vendor.
 *
 * The mock is the right thing to test against and not a compromise. The two
 * rules that matter here - a token cannot be issued for a room that has ended,
 * and a room can only be ended once - are exactly the ones a vendor sandbox
 * will not let you prove, because sandboxes keep rooms alive for convenience.
 */

const APPOINTMENT = testId(101);
const PATIENT = testId(1);
const PROVIDER = testId(900);

function harness(): ReturnType<typeof createTestApp> {
  // The same registry `createApp` builds for a development run, so these tests
  // exercise the wiring a developer actually gets rather than a second one
  // assembled here that could drift from it.
  const created = createTestApp();
  seed(created.dataset, 'Appointment', makeAppointmentRow({ id: APPOINTMENT }));
  return created;
}

function post(path: string, token: string, body?: unknown): [string, RequestInit] {
  return [
    path,
    body === undefined
      ? { method: 'POST', headers: bearer(token) }
      : { method: 'POST', headers: jsonBearer(token), body: JSON.stringify(body) },
  ];
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function openVisit(
  app: ReturnType<typeof createTestApp>['app']
): Promise<TelehealthVisitDto> {
  const res = await app.request(
    ...post(`/bff/v0/appointments/${APPOINTMENT}/telehealth`, TOKENS.adminA)
  );
  expect(res.status).toBe(201);
  return json<TelehealthVisitDto>(res);
}

describe('opening a room', () => {
  it('records the room against the appointment, and says where it is', async () => {
    const { app } = harness();

    const visit = await openVisit(app);

    expect(visit).toMatchObject({ appointmentId: APPOINTMENT, status: 'OPEN' });
    expect(visit.roomRef).not.toBe('');
    expect(visit.joinUrl.startsWith('https://')).toBe(true);
  });

  it('names the vendor that made the room', async () => {
    const { app } = harness();

    // A room outlives a configuration change, and afterwards nobody can tell
    // which vendor to ask about it.
    expect((await openVisit(app)).vendorId).not.toBe('');
  });

  it('never returns a token from the room it just made', async () => {
    const { app } = harness();

    const res = await app.request(
      ...post(`/bff/v0/appointments/${APPOINTMENT}/telehealth`, TOKENS.adminA)
    );

    // Opening a room is not the same act as letting somebody in, and a token in
    // this response would be a credential nobody asked for, logged by whatever
    // logs responses.
    expect(await res.text()).not.toContain('token');
  });

  it('refuses a second room for the same appointment', async () => {
    const { app } = harness();
    const first = await openVisit(app);

    const again = await app.request(
      ...post(`/bff/v0/appointments/${APPOINTMENT}/telehealth`, TOKENS.adminA)
    );

    // Two rooms for one visit is two waiting rooms, and half the participants
    // end up in the one nobody is watching.
    expect(again.status).toBe(409);
    expect(await again.text()).toContain(first.id);
  });

  it('refuses an appointment that does not exist', async () => {
    const { app } = harness();

    const res = await app.request(
      ...post(`/bff/v0/appointments/${testId(9_999)}/telehealth`, TOKENS.adminA)
    );

    expect(res.status).toBe(404);
  });

  it('answers 501 when the deployment configured no telehealth vendor', async () => {
    const { app, dataset } = createTestApp({ adapters: new AdapterRegistry() });
    seed(dataset, 'Appointment', makeAppointmentRow({ id: APPOINTMENT }));

    const res = await app.request(
      ...post(`/bff/v0/appointments/${APPOINTMENT}/telehealth`, TOKENS.adminA)
    );

    // Not a 500. Nothing is broken; this deployment does not do video.
    expect(res.status).toBe(501);
  });

  it('refuses a principal that may not write appointments', async () => {
    const { app } = harness();

    const res = await app.request(
      ...post(`/bff/v0/appointments/${APPOINTMENT}/telehealth`, UNPRIVILEGED_TOKEN)
    );

    expect(res.status).toBe(403);
  });
});

describe('letting somebody in', () => {
  it('issues a token for one named participant', async () => {
    const { app } = harness();
    const visit = await openVisit(app);

    const res = await app.request(
      ...post(`/bff/v0/telehealth/${visit.id}/join`, TOKENS.adminA, {
        participantId: PATIENT,
        role: 'guest',
      })
    );

    expect(res.status).toBe(200);
    const issued = await json<JoinTokenResponse>(res);
    expect(issued).toMatchObject({ visitId: visit.id, role: 'guest' });
    expect(issued.token).not.toBe('');
  });

  it('writes the token nowhere', async () => {
    const { app } = harness();
    const visit = await openVisit(app);
    const issued = await json<JoinTokenResponse>(
      await app.request(
        ...post(`/bff/v0/telehealth/${visit.id}/join`, TOKENS.adminA, {
          participantId: PROVIDER,
          role: 'host',
        })
      )
    );

    // The whole design rests on this. A stored token turns every later read of
    // this record, every backup and every support export into a way into a
    // patient's appointment, long after the visit ended.
    const stored = await app.request(`/bff/v0/telehealth/${visit.id}`, {
      headers: bearer(TOKENS.adminA),
    });
    expect(await stored.text()).not.toContain(issued.token);
  });

  it('issues a different token for each participant', async () => {
    const { app } = harness();
    const visit = await openVisit(app);

    const [guest, host] = await Promise.all(
      [
        { participantId: PATIENT, role: 'guest' },
        { participantId: PROVIDER, role: 'host' },
      ].map(async (body) =>
        json<JoinTokenResponse>(
          await app.request(...post(`/bff/v0/telehealth/${visit.id}/join`, TOKENS.adminA, body))
        )
      )
    );

    // One token per person is what makes a token revocable when an appointment
    // moves to a different provider. Sharing one makes that impossible.
    expect(guest?.token).not.toBe(host?.token);
  });

  it('lets nobody into a visit that has ended', async () => {
    const { app } = harness();
    const visit = await openVisit(app);
    await app.request(...post(`/bff/v0/telehealth/${visit.id}/end`, TOKENS.adminA, {}));

    const res = await app.request(
      ...post(`/bff/v0/telehealth/${visit.id}/join`, TOKENS.adminA, {
        participantId: PATIENT,
        role: 'guest',
      })
    );

    // Refused here rather than left to the vendor. Vendors are lenient about
    // this and a finished consultation must not be rejoinable.
    expect(res.status).toBe(409);
  });

  it('refuses a request that does not say who it is for', async () => {
    const { app } = harness();
    const visit = await openVisit(app);

    const res = await app.request(
      ...post(`/bff/v0/telehealth/${visit.id}/join`, TOKENS.adminA, { role: 'guest' })
    );

    // Not defaulted to the caller: a clinician asks for the patient's token as
    // often as their own, and a default would silently issue the wrong one.
    expect(res.status).toBe(422);
  });
});

describe('ending a visit', () => {
  it('keeps when it ended and how long it ran', async () => {
    const { app } = harness();
    const visit = await openVisit(app);

    const res = await app.request(
      ...post(`/bff/v0/telehealth/${visit.id}/end`, TOKENS.adminA, { reasonCode: 'completed' })
    );

    expect(res.status).toBe(200);
    const ended = await json<TelehealthVisitDto>(res);
    expect(ended.status).toBe('ENDED');
    expect(ended.endedAt).not.toBeNull();
    expect(ended.endedReason).toBe('completed');
    // Billing reads this as one input to visit length.
    expect(ended.durationSeconds).not.toBeNull();
  });

  it('refuses to end a visit twice', async () => {
    const { app } = harness();
    const visit = await openVisit(app);
    await app.request(...post(`/bff/v0/telehealth/${visit.id}/end`, TOKENS.adminA, {}));

    const again = await app.request(
      ...post(`/bff/v0/telehealth/${visit.id}/end`, TOKENS.adminA, {})
    );

    expect(again.status).toBe(409);
  });

  it('refuses a principal that may not write appointments', async () => {
    const { app } = harness();
    const visit = await openVisit(app);

    const res = await app.request(
      ...post(`/bff/v0/telehealth/${visit.id}/end`, UNPRIVILEGED_TOKEN, {})
    );

    expect(res.status).toBe(403);
  });
});

describe('reading visits back', () => {
  it('lists them, narrowed by appointment and by state', async () => {
    const { app } = harness();
    const visit = await openVisit(app);

    const byAppointment = await app.request(`/bff/v0/telehealth?appointmentId=${APPOINTMENT}`, {
      headers: bearer(TOKENS.adminA),
    });
    const byStatus = await app.request('/bff/v0/telehealth?status=ENDED', {
      headers: bearer(TOKENS.adminA),
    });

    expect((await json<{ data: TelehealthVisitDto[] }>(byAppointment)).data).toHaveLength(1);
    expect((await json<{ data: TelehealthVisitDto[] }>(byStatus)).data).toHaveLength(0);
    expect(visit.status).toBe('OPEN');
  });

  it('answers 404 for a visit that is not there', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/telehealth/${testId(9_998)}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(404);
  });
});

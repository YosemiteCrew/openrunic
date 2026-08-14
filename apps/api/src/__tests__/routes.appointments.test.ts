import { describe, expect, it } from 'vitest';

import type { ProblemDocument } from '../http/problem.js';
import type { AppointmentDto } from '../schemas/appointments.js';
import type { ListResponse } from '../schemas/pagination.js';

import {
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  bearer,
  createTestApp,
  jsonBearer,
  makeAppointmentRow,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
  seed,
} from './support.js';

const VALID_BODY = {
  facilityId: DEMO_FACILITY_A,
  patientId: testId(1),
  providerId: testId(900),
  typeCode: 'OFFICE-30',
  typeDisplay: 'Office visit, 30 minutes',
  start: '2026-08-14T15:00:00.000Z',
  end: '2026-08-14T15:30:00.000Z',
  durationMinutes: 30,
};

describe('GET /bff/v0/appointments', () => {
  it('serves the schedule day view for one facility', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(101), start: new Date('2026-08-14T09:00:00.000Z') }),
      makeAppointmentRow({ id: testId(102), start: new Date('2026-08-15T09:00:00.000Z') })
    );

    const res = await app.request(
      `/bff/v0/appointments?facilityId=${DEMO_FACILITY_A}&from=2026-08-14T00:00:00Z&to=2026-08-15T00:00:00Z`,
      { headers: bearer(TOKENS.frontDeskA) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse<AppointmentDto>;
    expect(body.data.map((row) => row.id)).toEqual([testId(101)]);
    expect(body.data[0]?.type).toEqual({ code: 'OFFICE-30', display: 'Office visit, 30 minutes' });
  });

  it('serves the flow board by status', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(101) }),
      makeAppointmentRow({ id: testId(102), status: 'CHECKED_IN' })
    );

    const body = (await (
      await app.request(`/bff/v0/appointments?facilityId=${DEMO_FACILITY_A}&status=CHECKED_IN`, {
        headers: bearer(TOKENS.frontDeskA),
      })
    ).json()) as ListResponse<AppointmentDto>;

    expect(body.data.map((row) => row.id)).toEqual([testId(102)]);
  });

  it.each([
    ['an unknown parameter', 'facility=1'],
    ['a non-UUID facility', 'facilityId=clinic-1'],
    ['an unknown status', 'status=SNOOZED'],
    ['a date without an offset', 'from=2026-08-14'],
    ['an unknown sort key', 'sort=vibes'],
  ])('rejects %s with a 400', async (_label, query) => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/appointments?${query}`, {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(400);
  });

  it('refuses a facility the principal has no grant for', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/appointments?facilityId=${DEMO_FACILITY_B}`, {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('facility');
  });

  it('denies a principal whose roles grant no permissions', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/appointments', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('appointment.read');
  });

  it('lets a biller see the schedule but not change it', async () => {
    const { app } = createTestApp();

    expect(
      (await app.request('/bff/v0/appointments', { headers: bearer(TOKENS.billerA) })).status
    ).toBe(200);
  });
});

describe('GET /bff/v0/appointments/:id', () => {
  it('reads one appointment', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as AppointmentDto).toMatchObject({
      id: testId(101),
      status: 'BOOKED',
      start: '2026-08-14T15:00:00.000Z',
      checkedInAt: null,
    });
  });

  it('404s an appointment that does not exist', async () => {
    const { app } = createTestApp();

    expect(
      (
        await app.request(`/bff/v0/appointments/${testId(999)}`, {
          headers: bearer(TOKENS.frontDeskA),
        })
      ).status
    ).toBe(404);
  });

  it('403s an appointment in a facility the principal cannot see', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(101), facilityId: DEMO_FACILITY_B })
    );

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      headers: bearer(TOKENS.frontDeskA),
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /bff/v0/appointments', () => {
  it('books an appointment', async () => {
    const { app, dataset } = createTestApp();
    const res = await app.request('/bff/v0/appointments', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as AppointmentDto;
    expect(res.headers.get('location')).toBe(`/bff/v0/appointments/${body.id}`);
    expect(dataset.table('Appointment')).toHaveLength(1);
  });

  it('422s an appointment that ends before it starts', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/appointments', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ ...VALID_BODY, end: '2026-08-14T14:00:00.000Z' }),
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as ProblemDocument).errors?.[0]?.path).toBe('end');
  });

  it('403s a booking into a facility the principal cannot see, before it is stored', async () => {
    const { app, dataset } = createTestApp();
    const res = await app.request('/bff/v0/appointments', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ ...VALID_BODY, facilityId: DEMO_FACILITY_B }),
    });

    expect(res.status).toBe(403);
    expect(dataset.table('Appointment')).toEqual([]);
  });

  it('denies a role without appointment.write', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/appointments', {
      method: 'POST',
      headers: jsonBearer(TOKENS.billerA),
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDocument).detail).toContain('appointment.write');
  });
});

describe('PATCH /bff/v0/appointments/:id', () => {
  it('advances the status and stamps the check-in time', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ status: 'CHECKED_IN', room: '3' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AppointmentDto;
    expect(body.status).toBe('CHECKED_IN');
    expect(body.room).toBe('3');
    expect(body.checkedInAt).not.toBeNull();
  });

  it('requires a reason on a cancellation', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ status: 'CANCELLED' }),
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as ProblemDocument).errors?.[0]?.path).toBe('cancelReason');
  });

  it('rejects an empty patch', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });

  it('rejects a reschedule that inverts the window', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ start: '2026-08-20T12:00:00Z', end: '2026-08-20T11:00:00Z' }),
    });

    expect(res.status).toBe(422);
  });

  it('refuses to move an appointment to another facility or patient', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ facilityId: DEMO_FACILITY_B }),
    });

    expect(res.status).toBe(422);
  });

  it('404s an unknown appointment', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/appointments/${testId(999)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ room: '3' }),
    });

    expect(res.status).toBe(404);
  });

  it('403s a patch to an appointment in an ungranted facility', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(101), facilityId: DEMO_FACILITY_B })
    );

    const res = await app.request(`/bff/v0/appointments/${testId(101)}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ room: '3' }),
    });

    expect(res.status).toBe(403);
    expect(dataset.table('Appointment')[0]?.room).toBeNull();
  });
});

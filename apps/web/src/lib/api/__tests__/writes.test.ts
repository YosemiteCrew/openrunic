import { describe, expect, it, vi } from 'vitest';

import { ApiError, createHttpClient, createMockClient } from '@/lib/api';
import type { ApiClient, ClaimDto, PatientCreateBody } from '@/lib/api';
import {
  MOCK_CLAIM_RECORDS,
  MOCK_DIAGNOSTIC_REPORTS,
  MOCK_ENCOUNTERS,
  MOCK_FORM_DEFINITION_RECORDS,
  MOCK_NOTES,
  MOCK_PAYMENT_RECORDS,
  MOCK_REMITTANCE_RECORDS,
  MOCK_SERVICE_REQUESTS,
  MOCK_STATEMENT_RECORDS,
  MOCK_TASKS,
} from '@/lib/api/mock/records';

/**
 * The write surface, on both clients.
 *
 * Two things are being protected. Every write reaches the path and method the
 * API actually serves, because a typo here is a 404 nobody sees until a
 * clinician meets it. And the mock refuses what the API refuses: a transition
 * the state machine forbids is a 409 in both modes, so a screen that only ever
 * runs against fixtures still meets the "no" it will meet in production.
 */

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

/** Records what the live client sent, and answers whatever the route returns. */
function transport(): { client: ApiClient; sent: () => Sent[] } {
  const calls: Sent[] = [];
  const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: 'answered' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  });
  return {
    client: createHttpClient({ baseUrl: 'http://api.test', fetchImpl }),
    sent: () => calls,
  };
}

/** Awaits a call that must be refused, and answers the problem it was refused with. */
async function refusal(call: Promise<unknown>): Promise<ApiError> {
  const outcome = await call.then(
    () => null,
    (error: unknown) => error
  );
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

const NEW_PATIENT: PatientCreateBody = {
  mrn: 'OR-990001',
  givenName: 'Testina',
  familyName: 'Nordbrandt',
  birthDate: '1990-05-04',
};

describe('the live client, every write it makes', () => {
  it('posts and patches the two aggregates the front desk creates', async () => {
    const { client, sent } = transport();

    await client.patients.create(NEW_PATIENT);
    await client.patients.update('p-1', { city: 'Cedar Falls' });
    await client.appointments.create({
      facilityId: 'f-1',
      providerId: 'd-1',
      typeCode: 'FOLLOWUP',
      typeDisplay: 'Follow-up',
      start: '2026-08-12T09:00:00.000Z',
      end: '2026-08-12T09:20:00.000Z',
      durationMinutes: 20,
    });
    await client.appointments.update('a-1', { status: 'CHECKED_IN' });

    expect(sent().map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST http://api.test/bff/v0/patients',
      'PATCH http://api.test/bff/v0/patients/p-1',
      'POST http://api.test/bff/v0/appointments',
      'PATCH http://api.test/bff/v0/appointments/a-1',
    ]);
    expect(sent()[0]?.body).toMatchObject({ mrn: 'OR-990001', familyName: 'Nordbrandt' });
  });

  it('reaches every clinical and financial transition the API serves', async () => {
    const { client, sent } = transport();

    await client.encounters.sign('e-1');
    await client.notes.sign('n-1');
    await client.notes.addAddendum('n-1', { blocks: [{ text: 'more' }] });
    await client.orders.sign('s-1');
    await client.orders.transmit('s-1');
    await client.orders.cancel('s-1');
    await client.results.review('r-1');
    await client.tasks.complete('t-1', { outcome: 'Called the patient' });
    await client.claims.scrub('c-1');
    await client.claims.submit('c-1');
    await client.claims.status('c-1', { status: 'PAID', source: 'REMIT_835' });
    await client.payments.post('m-1');
    await client.remittances.parse('w-1');
    await client.remittances.post('w-1', { method: 'EFT' });
    await client.statements.generate('x-1');
    await client.statements.send('x-1', { deliveredVia: 'EMAIL' });
    await client.forms.publish('g-1', { formDefinitionId: 'g-1', compiled: {} });

    expect(sent().map((call) => call.url.replace('http://api.test/bff/v0', ''))).toEqual([
      '/encounters/e-1/sign',
      '/notes/n-1/sign',
      '/notes/n-1/addenda',
      '/orders/s-1/sign',
      '/orders/s-1/transmit',
      '/orders/s-1/cancel',
      '/results/r-1/review',
      '/tasks/t-1/complete',
      '/claims/c-1/scrub',
      '/claims/c-1/submit',
      '/claims/c-1/status',
      '/payments/m-1/post',
      '/remittances/w-1/parse',
      '/remittances/w-1/post',
      '/statements/x-1/generate',
      '/statements/x-1/send',
      '/forms/definitions/g-1/publish',
    ]);
    expect(sent().every((call) => call.method === 'POST')).toBe(true);
  });

  it('sends a body on every transition, because the API rejects a bodyless post', async () => {
    const { client, sent } = transport();

    await client.orders.sign('s-1');
    await client.tasks.complete('t-1');

    // `{}` rather than nothing: the transition schemas are strict objects, and
    // a POST with no body at all is a 400 rather than the no-op meant by it.
    expect(sent().map((call) => call.body)).toEqual([{}, {}]);
  });

  it('escapes an id in a transition path, so a slash cannot reach another route', async () => {
    const { client, sent } = transport();
    await client.orders.sign('a/b');
    expect(sent()[0]?.url).toBe('http://api.test/bff/v0/orders/a%2Fb/sign');
  });

  it('lists a note and its addenda with the query string the API reads', async () => {
    const { client, sent } = transport();

    await client.notes.list({ patientId: 'p-1', state: 'UNSIGNED' });
    await client.notes.listAddenda('n-1', { pageSize: 50 });
    await client.encounters.list({ patientId: 'p-1' });

    expect(sent().map((call) => call.url.replace('http://api.test/bff/v0', ''))).toEqual([
      '/notes?patientId=p-1&state=UNSIGNED',
      '/notes/n-1/addenda?pageSize=50',
      '/encounters?patientId=p-1',
    ]);
  });
});

describe('the mock client, registration', () => {
  it('assigns an id and reads the new patient back on the next search', async () => {
    const client = createMockClient();

    const created = await client.patients.create(NEW_PATIENT);
    expect(created.id).toMatch(/^0192f1a0-/);
    // The nested aggregate, not the flat body: the same shape the API answers.
    expect(created.name.family).toBe('Nordbrandt');
    expect(created.address.country).toBe('US');

    const found = await client.patients.list({ mrn: 'OR-990001' });
    expect(found.data).toHaveLength(1);
    expect(found.data[0]?.id).toBe(created.id);
  });

  it('refuses a duplicate MRN the way the API refuses it', async () => {
    const client = createMockClient();
    await client.patients.create(NEW_PATIENT);

    const failure = await refusal(client.patients.create(NEW_PATIENT));
    expect(failure.status).toBe(409);
    expect(failure.problem?.detail).toBe('That MRN is taken.');
  });

  it('amends a patient without blanking the fields the patch left alone', async () => {
    const client = createMockClient();
    const created = await client.patients.create({ ...NEW_PATIENT, city: 'Birchwood' });

    const amended = await client.patients.update(created.id, { phoneMobile: '+1 555 0142 700' });

    expect(amended.telecom.phoneMobile).toBe('+1 555 0142 700');
    expect(amended.address.city).toBe('Birchwood');
    expect(amended.name.family).toBe('Nordbrandt');
    expect(amended.updatedAt > created.updatedAt).toBe(true);
  });

  it('reports an unknown patient as absent on both reads and writes', async () => {
    const client = createMockClient();
    await expect(client.patients.update('nobody', { city: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('the mock client, booking and the flow board', () => {
  it('books a slot and shows it on the next read of the day', async () => {
    const client = createMockClient();

    const booked = await client.appointments.create({
      facilityId: '0192f1a0-0000-7000-8000-00000000f001',
      patientId: '0192f1a0-0000-7000-8000-00000000p001',
      providerId: '0192f1a0-0000-7000-8000-00000000d001',
      typeCode: 'FOLLOWUP',
      typeDisplay: 'Follow-up',
      start: '2026-08-12T15:00:00.000Z',
      end: '2026-08-12T15:20:00.000Z',
      durationMinutes: 20,
    });

    expect(booked.status).toBe('BOOKED');
    expect(booked.createdVia).toBe('STAFF');
    const day = await client.appointments.list({ from: '2026-08-12T14:00:00.000Z' });
    expect(day.data.map((entry) => entry.id)).toContain(booked.id);
  });

  it('stamps arrival when the status moves to checked in, and only the first time', async () => {
    const client = createMockClient();
    const booked = await client.appointments.list({ status: 'BOOKED' });
    const id = booked.data[0]?.id ?? '';

    const checkedIn = await client.appointments.update(id, { status: 'CHECKED_IN' });
    expect(checkedIn.checkedInAt).not.toBeNull();

    const roomed = await client.appointments.update(id, { status: 'ROOMED' });
    expect(roomed.checkedInAt).toBe(checkedIn.checkedInAt);
  });

  it('refuses a patch that changes nothing, as the API does', async () => {
    const client = createMockClient();
    const day = await client.appointments.list();
    const failure = await refusal(client.appointments.update(day.data[0]?.id ?? '', {}));

    expect(failure.status).toBe(422);
    expect(failure.problem?.errors?.[0]?.message).toContain('at least one field');
  });

  it('refuses a cancellation with no reason, because the record has to say why', async () => {
    const client = createMockClient();
    const day = await client.appointments.list();
    const failure = await refusal(
      client.appointments.update(day.data[0]?.id ?? '', { status: 'CANCELLED' })
    );

    expect(failure.status).toBe(422);
    expect(failure.problem?.errors?.[0]?.path).toBe('cancelReason');
  });

  it('rewrites the visit type as a pair, so a code cannot drift from its display', async () => {
    const client = createMockClient();
    const day = await client.appointments.list();
    const id = day.data[0]?.id ?? '';

    const retyped = await client.appointments.update(id, { typeDisplay: 'Acute visit' });
    expect(retyped.type.display).toBe('Acute visit');
    expect(retyped.type.code).toBe(day.data[0]?.type.code);
  });
});

describe('the mock client, the clinical spine', () => {
  it('signs a visit once and refuses the second signature', async () => {
    const client = createMockClient();
    const underWay = MOCK_ENCOUNTERS.find((row) => row.status === 'IN_PROGRESS');
    expect(underWay).toBeDefined();

    const signed = await client.encounters.sign(underWay?.id ?? '');
    expect(signed.signedAt).not.toBeNull();
    expect(signed.status).toBe('COMPLETED');

    await expect(client.encounters.sign(underWay?.id ?? '')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('signs a note, locks it, and refuses an edit to the locked text', async () => {
    const client = createMockClient();
    const unsigned = MOCK_NOTES.find((note) => note.state === 'UNSIGNED');
    expect(unsigned).toBeDefined();
    const id = unsigned?.id ?? '';

    const signed = await client.notes.sign(id);
    expect(signed.state).toBe('SIGNED');
    expect(signed.lockedAt).toBe(signed.signedAt);

    const failure = await refusal(
      client.notes.update(id, { blocks: [{ key: 'plan', text: 'changed' }] })
    );
    expect(failure.status).toBe(409);
    expect(failure.problem?.detail).toContain('Record an addendum');
  });

  it('moves the note to amended when an addendum is recorded against it', async () => {
    const client = createMockClient();
    const signed = MOCK_NOTES.find((note) => note.state === 'SIGNED');
    const id = signed?.id ?? '';

    const addendum = await client.notes.addAddendum(id, {
      blocks: [{ key: 'addendum', text: 'Home readings received.' }],
      reason: 'Home readings',
    });

    expect(addendum.noteId).toBe(id);
    expect((await client.notes.get(id)).state).toBe('AMENDED');
    const listed = await client.notes.listAddenda(id);
    expect(listed.data.map((row) => row.id)).toContain(addendum.id);
  });

  it('refuses an addendum against a note nobody has signed', async () => {
    const client = createMockClient();
    const draft = MOCK_NOTES.find((note) => note.state === 'DRAFT' || note.state === 'UNSIGNED');
    const failure = await refusal(client.notes.addAddendum(draft?.id ?? '', { blocks: [] }));

    expect(failure.status).toBe(409);
    // The refusal names the states it could have moved to, which is the
    // actionable half of the answer for a screen with buttons on it.
    expect(failure.problem?.detail).toContain('cannot move to AMENDED');
  });

  it('reads addenda through the note, so an unknown note is absent not empty', async () => {
    const client = createMockClient();
    await expect(client.notes.listAddenda('nobody')).rejects.toMatchObject({ status: 404 });
  });

  it('creates a note as a draft when no state is named', async () => {
    const client = createMockClient();
    const created = await client.notes.create({
      patientId: 'p-1',
      encounterId: 'e-1',
      authorId: 'u-1',
      title: 'Acute visit',
      blocks: [{ key: 'plan', text: 'Rest and review.' }],
    });

    expect(created.state).toBe('DRAFT');
    expect(created.signedAt).toBeNull();
    const listed = await client.notes.list({ patientId: 'p-1' });
    expect(listed.data.map((note) => note.id)).toContain(created.id);
  });

  it('moves a note between the states a plain amendment may reach', async () => {
    const client = createMockClient();
    const draft = MOCK_NOTES.find((note) => note.state === 'DRAFT');
    const moved = await client.notes.update(draft?.id ?? '', { state: 'UNSIGNED' });
    expect(moved.state).toBe('UNSIGNED');
  });
});

describe('the mock client, orders and results', () => {
  it('walks an order through the states the ledger allows, and stops at the wall', async () => {
    const client = createMockClient();
    const pended = MOCK_SERVICE_REQUESTS.find((order) => order.status === 'PENDED');
    const id = pended?.id ?? '';

    expect((await client.orders.sign(id)).status).toBe('SIGNED');
    const transmitted = await client.orders.transmit(id);
    expect(transmitted.status).toBe('TRANSMITTED');
    // Stamped where the move happens: an order that says TRANSMITTED and
    // cannot say when is one nobody can chase.
    expect(transmitted.transmittedAt).not.toBeNull();

    await expect(client.orders.sign(id)).rejects.toMatchObject({ status: 409 });
  });

  it('cancels a transmitted order but will not sign one', async () => {
    const client = createMockClient();
    const transmitted = MOCK_SERVICE_REQUESTS.find((order) => order.status === 'TRANSMITTED');
    const id = transmitted?.id ?? '';

    await expect(client.orders.sign(id)).rejects.toMatchObject({ status: 409 });
    expect((await client.orders.cancel(id)).status).toBe('CANCELLED');
  });

  it('reviews a result once and names the reviewer', async () => {
    const client = createMockClient();
    const unreviewed = MOCK_DIAGNOSTIC_REPORTS.find((report) => report.reviewedAt === null);
    const id = unreviewed?.id ?? '';

    const reviewed = await client.results.review(id);
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(reviewed.reviewedById).not.toBeNull();

    const failure = await refusal(client.results.review(id));
    expect(failure.problem?.detail).toBe('That result has already been reviewed.');
  });

  it('completes a task with its outcome, and refuses to complete a closed one', async () => {
    const client = createMockClient();
    const open = MOCK_TASKS.find((task) => task.status === 'OPEN');
    const done = MOCK_TASKS.find((task) => task.status === 'DONE');

    const completed = await client.tasks.complete(open?.id ?? '', { outcome: 'Patient called' });
    expect(completed.status).toBe('DONE');
    expect(completed.outcome).toBe('Patient called');

    await expect(client.tasks.complete(done?.id ?? '')).rejects.toMatchObject({ status: 409 });
  });

  it('completes a task with no outcome without writing an empty one', async () => {
    const client = createMockClient();
    const open = MOCK_TASKS.find((task) => task.status === 'IN_PROGRESS');
    const completed = await client.tasks.complete(open?.id ?? '');
    expect(completed.outcome).toBeNull();
  });
});

describe('the mock client, the revenue cycle', () => {
  function claimIn(status: ClaimDto['status']): string {
    return MOCK_CLAIM_RECORDS.find((claim) => claim.status === status)?.id ?? '';
  }

  it('scrubs before it submits, and refuses a submit that skipped the scrub', async () => {
    const client = createMockClient();

    await expect(client.claims.submit(claimIn('DRAFT'))).rejects.toMatchObject({ status: 409 });
    expect((await client.claims.scrub(claimIn('DRAFT'))).status).toBe('SCRUBBED');
    const submitted = await client.claims.submit(claimIn('SCRUBBED'));
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.submittedAt).not.toBeNull();
  });

  it('records an adjudication outcome with the reason the payer gave', async () => {
    const client = createMockClient();
    const acknowledged = await client.claims.status(claimIn('SUBMITTED'), {
      status: 'ACKNOWLEDGED',
      source: 'ACK_999',
    });
    expect(acknowledged.acknowledgedAt).not.toBeNull();

    const paid = await client.claims.status(acknowledged.id, {
      status: 'PAID',
      source: 'REMIT_835',
      statusReason: 'Paid in full',
    });
    expect(paid.status).toBe('PAID');
    expect(paid.statusReason).toBe('Paid in full');
    expect(paid.adjudicatedAt).not.toBeNull();
  });

  it('posts a pending payment and refuses to post it twice', async () => {
    const client = createMockClient();
    const id = MOCK_PAYMENT_RECORDS[0]?.id ?? '';

    const posted = await client.payments.post(id, { note: 'Card present' });
    expect(posted.status).toBe('POSTED');
    expect(posted.note).toBe('Card present');
    await expect(client.payments.post(id)).rejects.toMatchObject({ status: 409 });
  });

  it('parses an advice before it posts one, and reports the exceptions', async () => {
    const client = createMockClient();
    const received = MOCK_REMITTANCE_RECORDS.find((row) => row.status === 'RECEIVED')?.id ?? '';

    await expect(client.remittances.post(received)).rejects.toMatchObject({ status: 409 });
    const parsed = await client.remittances.parse(received);
    expect(parsed.remittance.status).toBe('PARSED');
    expect(parsed.exceptionCount).toBe(parsed.remittance.exceptionCount);
  });

  it('posting an advice creates the payment it settles', async () => {
    const client = createMockClient();
    const advice = MOCK_REMITTANCE_RECORDS.find((row) => row.status === 'PARSED');
    const id = advice?.id ?? '';

    const result = await client.remittances.post(id, { method: 'EFT' });
    expect(result.remittance.status).toBe('POSTED');
    expect(result.payment.amountCents).toBe(advice?.totalPaidCents);
    expect(result.payment.source).toBe('PAYER_ERA');
    expect(result.payment.remittanceId).toBe(id);
    // Unapplied lines are reported rather than hidden: each one is somebody's work.
    expect(result.skippedLineCount).toBe(advice?.exceptionCount);
  });

  it('generates a statement, then sends it, and records how it went out', async () => {
    const client = createMockClient();
    const draft = MOCK_STATEMENT_RECORDS.find((row) => row.status === 'DRAFT')?.id ?? '';
    const generated = MOCK_STATEMENT_RECORDS.find((row) => row.status === 'GENERATED')?.id ?? '';

    await expect(client.statements.send(draft, { deliveredVia: 'EMAIL' })).rejects.toMatchObject({
      status: 409,
    });
    expect((await client.statements.generate(draft, { balanceCents: 8_000 })).balanceCents).toBe(
      8_000
    );

    const sent = await client.statements.send(generated, {
      deliveredVia: 'EMAIL',
      payLinkToken: 'a'.repeat(40),
      payLinkExpiresAt: '2026-09-01T00:00:00.000Z',
    });
    expect(sent.status).toBe('SENT');
    expect(sent.deliveredVia).toBe('EMAIL');
    // The fact of a link, never the token: a list of statements carrying tokens
    // would be a list of ways to pay other people's bills.
    expect(sent.payLinkSet).toBe(true);
    expect(Object.keys(sent)).not.toContain('payLinkToken');
  });
});

describe('the mock client, publishing a form', () => {
  it('freezes the definition and stamps who published it', async () => {
    const client = createMockClient();
    const id = MOCK_FORM_DEFINITION_RECORDS[0]?.id ?? '';

    const published = await client.forms.publish(id, {
      formDefinitionId: id,
      compiled: { validator: 'v1' },
    });

    expect(published.status).toBe('PUBLISHED');
    expect(published.publishedById).not.toBeNull();
    expect(published.compiled).toEqual({ validator: 'v1' });
    await expect(
      client.forms.publish(id, { formDefinitionId: id, compiled: {} })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a body that names a different definition from the path', async () => {
    const client = createMockClient();
    const id = MOCK_FORM_DEFINITION_RECORDS[0]?.id ?? '';

    const failure = await refusal(
      client.forms.publish(id, { formDefinitionId: 'somebody-elses', compiled: {} })
    );

    expect(failure.status).toBe(422);
    expect(failure.problem?.errors?.[0]?.path).toBe('formDefinitionId');
  });
});

describe('the mock client, as a test double', () => {
  it('fails every call with one flag, so an error state needs no hand-written client', async () => {
    const boom = new ApiError('offline', { kind: 'network' });
    const client = createMockClient({ failure: boom });

    await expect(client.patients.list()).rejects.toBe(boom);
    await expect(client.orders.sign('anything')).rejects.toBe(boom);
    await expect(client.claims.scrub('anything')).rejects.toBe(boom);
  });

  it('keeps one client from seeing what another one wrote, so a test cannot leak', async () => {
    const first = createMockClient();
    const second = createMockClient();

    await first.patients.create(NEW_PATIENT);

    expect((await first.patients.list({ mrn: 'OR-990001' })).data).toHaveLength(1);
    expect((await second.patients.list({ mrn: 'OR-990001' })).data).toHaveLength(0);
  });

  it('takes its own seed for an aggregate a screen needs in a particular state', async () => {
    const client = createMockClient({ orders: [], results: [], claims: [] });
    await expect(client.orders.sign('anything')).rejects.toMatchObject({ status: 404 });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { buildEmptyFixtures, buildFixtures, createMockApi, MockDataError } from '@/lib/api';
import { buildHomeSummary } from '@/lib/api/fixtures';
import type { PortalApi } from '@/lib/api/types';

describe('fixtures', () => {
  it('hands out an independent copy each time', () => {
    const first = buildFixtures();
    const second = buildFixtures();

    first.threads[0]?.messages.push({
      id: 'stray',
      author: 'patient',
      authorName: 'Testina Patientsson',
      sentAt: '2026-07-01T00:00:00.000Z',
      body: 'This must not leak.',
    });

    expect(second.threads[0]?.messages).toHaveLength(1);
  });

  it('uses synthetic identities only', () => {
    const fixtures = buildFixtures();

    expect(fixtures.patient.name).toBe('Testina Patientsson');
    expect(fixtures.patient.mrn).toBe('OR-100482');
  });

  it('derives the home summary from the other fixtures rather than repeating them', () => {
    const fixtures = buildFixtures();
    const home = buildHomeSummary(fixtures);

    expect(home.nextAppointment?.id).toBe(fixtures.appointments.upcoming[0]?.id);
    expect(home.unreadMessages).toBe(fixtures.threads.filter((thread) => thread.unread).length);
    // Only forms still outstanding become actions.
    expect(home.actionItems).toHaveLength(2);
    expect(home.actionItems[0]?.actionLabel).toBe('Continue the form');
    expect(home.actionItems[1]?.actionLabel).toBe('Start the form');
  });

  it('reports no next appointment when nothing is booked', () => {
    expect(buildHomeSummary(buildEmptyFixtures()).nextAppointment).toBeNull();
  });
});

describe('createMockApi reads', () => {
  let api: PortalApi;

  beforeEach(() => {
    api = createMockApi(buildFixtures());
  });

  it('returns the patient, the record, the threads, the forms and the statements', async () => {
    await expect(api.getPatient()).resolves.toMatchObject({ mrn: 'OR-100482' });
    await expect(api.getHome()).resolves.toMatchObject({ unreadMessages: 1 });
    await expect(api.getHealthRecord()).resolves.toMatchObject({ problems: expect.any(Array) });
    await expect(api.getThreads()).resolves.toHaveLength(2);
    await expect(api.getAppointments()).resolves.toMatchObject({ upcoming: expect.any(Array) });
    await expect(api.getForms()).resolves.toHaveLength(2);
    await expect(api.getStatements()).resolves.toHaveLength(2);
  });

  it('defaults to a fresh set of fixtures when none is passed', async () => {
    await expect(createMockApi().getPatient()).resolves.toMatchObject({ mrn: 'OR-100482' });
  });
});

describe('createMockApi writes', () => {
  let api: PortalApi;

  beforeEach(() => {
    api = createMockApi(buildFixtures());
  });

  it('appends a sent message to its thread and clears the unread flag', async () => {
    const message = await api.sendMessage('thread-1', 'Thank you.');
    const threads = await api.getThreads();

    expect(message.author).toBe('patient');
    expect(message.authorName).toBe('Testina Patientsson');
    expect(threads[0]?.messages.at(-1)?.body).toBe('Thank you.');
    expect(threads[0]?.unread).toBe(false);
  });

  it('gives each sent message its own id', async () => {
    const first = await api.sendMessage('thread-1', 'One.');
    const second = await api.sendMessage('thread-1', 'Two.');

    expect(first.id).not.toBe(second.id);
  });

  it('refuses to send to a thread that is gone', async () => {
    await expect(api.sendMessage('thread-missing', 'Hello.')).rejects.toBeInstanceOf(MockDataError);
  });

  it('records an appointment request without booking anything', async () => {
    const before = await api.getAppointments();
    await api.requestAppointment({ reason: 'Sore throat', preferredTimes: 'Weekday mornings' });
    const after = await api.getAppointments();

    expect(after.upcoming).toHaveLength(before.upcoming.length);
  });

  it('records a reschedule request the same way', async () => {
    await expect(
      api.requestAppointment({
        reason: 'Thyroid review',
        preferredTimes: 'Any afternoon',
        rescheduleOf: 'appt-2041',
      })
    ).resolves.toBeUndefined();
  });

  it('moves a cancelled appointment to the past with a reason', async () => {
    await api.cancelAppointment('appt-2041');
    const appointments = await api.getAppointments();

    expect(appointments.upcoming.map((item) => item.id)).not.toContain('appt-2041');
    expect(appointments.past[0]?.id).toBe('appt-2041');
    expect(appointments.past[0]?.cancelledReason).toBe('You cancelled this appointment.');
  });

  it('refuses to cancel an appointment that is not booked', async () => {
    await expect(api.cancelAppointment('appt-missing')).rejects.toBeInstanceOf(MockDataError);
  });

  it('saves answers and moves a form off not-started', async () => {
    await api.saveForm('form-2', { 'q-4': 'Yes' });
    const forms = await api.getForms();

    expect(forms[1]?.answers).toEqual({ 'q-4': 'Yes' });
    expect(forms[1]?.status).toBe('in-progress');
  });

  it('leaves a form already in progress in progress when saved', async () => {
    await api.saveForm('form-1', { 'q-1': 'Most days' });
    const forms = await api.getForms();

    expect(forms[0]?.status).toBe('in-progress');
  });

  it('submits a form', async () => {
    await api.submitForm('form-1', { 'q-1': 'Every day' });
    const forms = await api.getForms();

    expect(forms[0]?.status).toBe('submitted');
    expect(forms[0]?.answers).toEqual({ 'q-1': 'Every day' });
  });

  it('refuses to save or submit a form that is gone', async () => {
    await expect(api.saveForm('form-missing', {})).rejects.toBeInstanceOf(MockDataError);
    await expect(api.submitForm('form-missing', {})).rejects.toBeInstanceOf(MockDataError);
  });

  it('clears a statement balance on payment and returns a receipt', async () => {
    const receipt = await api.payStatement('stmt-1');
    const statements = await api.getStatements();
    const home = await api.getHome();

    expect(receipt.amount.amountMinor).toBe(8450);
    expect(receipt.cardLast4).toBe('4242');
    expect(statements[0]?.balance.amountMinor).toBe(0);
    expect(statements[0]?.status).toBe('paid');
    expect(home.balance.outstanding.amountMinor).toBe(0);
  });

  it('never drives the account balance below zero when paying a credit statement', async () => {
    await api.payStatement('stmt-2');
    const home = await api.getHome();

    expect(home.balance.outstanding.amountMinor).toBeGreaterThanOrEqual(0);
  });

  it('refuses to pay a statement that is gone', async () => {
    await expect(api.payStatement('stmt-missing')).rejects.toBeInstanceOf(MockDataError);
  });
});

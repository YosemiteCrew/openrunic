/**
 * Mock-mode adapter. The portal's default data source.
 *
 * It holds one `Fixtures` object in a closure and mutates it in place, so a session behaves
 * like a real account: a sent message stays in its thread, a cancelled appointment moves to
 * the past list, a paid statement clears its balance. Nothing is persisted and nothing is
 * shared between instances, so each test gets a clean account by building its own.
 *
 * Every method is async to match the API adapter exactly. None of them add artificial
 * latency: a test should not have to wait, and a fake delay would only hide a missing
 * loading state rather than prove one exists.
 */

import { buildFixtures, buildHomeSummary, type Fixtures } from './fixtures';
import type {
  Appointments,
  HealthRecord,
  HomeSummary,
  Message,
  MessageThread,
  Patient,
  PortalApi,
  Receipt,
  Statement,
} from './types';

/** The mock's own error type, so a screen can tell "not found" from a transport failure. */
export class MockDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockDataError';
  }
}

let messageCounter = 0;
let receiptCounter = 0;

/** Monotonic ids, so two messages sent in the same millisecond never collide. */
function nextId(prefix: string, counter: number): string {
  return `${prefix}-${counter}`;
}

export function createMockApi(fixtures: Fixtures = buildFixtures()): PortalApi {
  return {
    getPatient(): Promise<Patient> {
      return Promise.resolve(fixtures.patient);
    },

    getHome(): Promise<HomeSummary> {
      return Promise.resolve(buildHomeSummary(fixtures));
    },

    getHealthRecord(): Promise<HealthRecord> {
      return Promise.resolve(fixtures.healthRecord);
    },

    getThreads(): Promise<MessageThread[]> {
      return Promise.resolve(fixtures.threads);
    },

    sendMessage(threadId: string, body: string): Promise<Message> {
      const thread = fixtures.threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        return Promise.reject(new MockDataError('That conversation is no longer available.'));
      }

      messageCounter += 1;
      const message: Message = {
        id: nextId('msg-sent', messageCounter),
        author: 'patient',
        authorName: fixtures.patient.name,
        sentAt: new Date().toISOString(),
        body,
      };
      thread.messages.push(message);
      thread.lastMessageAt = message.sentAt;
      thread.unread = false;
      return Promise.resolve(message);
    },

    getAppointments(): Promise<Appointments> {
      return Promise.resolve(fixtures.appointments);
    },

    requestAppointment(): Promise<void> {
      // A request is not a booking: nothing joins `upcoming` until the practice confirms,
      // and the practice is not in this process, so the mock has nowhere to put it. It
      // accepts and forgets, which is exactly what the screens need to render against.
      return Promise.resolve();
    },

    cancelAppointment(id: string): Promise<void> {
      const index = fixtures.appointments.upcoming.findIndex(
        (appointment) => appointment.id === id
      );
      const appointment = fixtures.appointments.upcoming[index];
      if (!appointment) {
        return Promise.reject(new MockDataError('That appointment is no longer booked.'));
      }

      fixtures.appointments.upcoming.splice(index, 1);
      fixtures.appointments.past.unshift({
        ...appointment,
        cancelledReason: 'You cancelled this appointment.',
      });
      return Promise.resolve();
    },

    getForms() {
      return Promise.resolve(fixtures.forms);
    },

    saveForm(id: string, answers: Record<string, string>): Promise<void> {
      const form = fixtures.forms.find((candidate) => candidate.id === id);
      if (!form) {
        return Promise.reject(new MockDataError('That form is no longer available.'));
      }

      form.answers = { ...answers };
      if (form.status === 'not-started') form.status = 'in-progress';
      return Promise.resolve();
    },

    submitForm(id: string, answers: Record<string, string>): Promise<void> {
      const form = fixtures.forms.find((candidate) => candidate.id === id);
      if (!form) {
        return Promise.reject(new MockDataError('That form is no longer available.'));
      }

      form.answers = { ...answers };
      form.status = 'submitted';
      return Promise.resolve();
    },

    getStatements(): Promise<Statement[]> {
      return Promise.resolve(fixtures.statements);
    },

    payStatement(id: string): Promise<Receipt> {
      const statement = fixtures.statements.find((candidate) => candidate.id === id);
      if (!statement) {
        return Promise.reject(new MockDataError('That statement is no longer available.'));
      }

      const paid = statement.balance.amountMinor;
      statement.balance = { ...statement.balance, amountMinor: 0 };
      statement.status = 'paid';
      fixtures.balance.outstanding = {
        ...fixtures.balance.outstanding,
        amountMinor: Math.max(0, fixtures.balance.outstanding.amountMinor - paid),
      };

      receiptCounter += 1;
      return Promise.resolve({
        id: nextId('receipt', receiptCounter),
        statementId: statement.id,
        paidOn: new Date().toISOString(),
        amount: { amountMinor: paid, currency: statement.balance.currency },
        cardLast4: '4242',
      });
    },
  };
}

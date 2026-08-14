/**
 * Deterministic synthetic fixtures for mock mode.
 *
 * Every identity here is invented and every date is a fixed literal, so a screen renders
 * the same pixels on any machine on any day and a test can assert on exact strings. No
 * real patient data ever belongs in this file.
 *
 * `buildFixtures()` returns a fresh deep copy on each call, so mock mutations (sending a
 * message, cancelling an appointment, paying a statement) stay inside one session and
 * never leak between tests.
 */

import type {
  Appointment,
  Appointments,
  Balance,
  ClinicalDocument,
  FormTask,
  HealthRecord,
  HomeSummary,
  MessageThread,
  Patient,
  Statement,
} from './types';

const CURRENCY = 'GBP';

const PATIENT: Patient = {
  id: 'patient-or-100482',
  name: 'Testina Patientsson',
  mrn: 'OR-100482',
  dateOfBirth: '1984-03-11',
};

const UPCOMING: Appointment[] = [
  {
    id: 'appt-2041',
    startsAt: '2026-09-03T09:30:00.000Z',
    durationMinutes: 20,
    reason: 'Thyroid review',
    clinician: 'Dr. Okafor',
    department: 'Endocrinology',
    mode: 'video',
    joinUrl: 'https://example.invalid/video/appt-2041',
  },
  {
    id: 'appt-2052',
    startsAt: '2026-09-24T14:00:00.000Z',
    durationMinutes: 30,
    reason: 'Blood pressure check',
    clinician: 'Exampla Testperson',
    department: 'General practice',
    mode: 'in-person',
    location: 'Elmfield Practice, Room 4',
    directionsUrl: 'https://example.invalid/directions/elmfield',
  },
];

const PAST: Appointment[] = [
  {
    id: 'appt-1988',
    startsAt: '2026-06-11T11:15:00.000Z',
    durationMinutes: 20,
    reason: 'Thyroid review',
    clinician: 'Dr. Okafor',
    department: 'Endocrinology',
    mode: 'in-person',
    location: 'Elmfield Practice, Room 2',
  },
  {
    id: 'appt-1954',
    startsAt: '2026-03-02T08:45:00.000Z',
    durationMinutes: 15,
    reason: 'Blood test',
    clinician: 'Demonstra Fixtureby',
    department: 'Phlebotomy',
    mode: 'in-person',
    location: 'Elmfield Practice, Room 1',
  },
];

const BALANCE: Balance = {
  outstanding: { amountMinor: 8450, currency: CURRENCY },
  dueOn: '2026-09-15',
  statementCount: 2,
};

const HEALTH_RECORD: HealthRecord = {
  problems: [
    {
      id: 'prob-1',
      term: 'Hypothyroidism',
      code: 'E03.9',
      plain: 'Underactive thyroid',
      recordedOn: '2023-11-04',
      status: 'Being treated',
    },
    {
      id: 'prob-2',
      term: 'Essential hypertension',
      code: 'I10',
      plain: 'High blood pressure with no single known cause',
      recordedOn: '2024-05-19',
      status: 'Being treated',
    },
    {
      id: 'prob-3',
      term: 'Iron deficiency anaemia',
      code: 'D50.9',
      plain: 'Low iron, which can leave you tired',
      recordedOn: '2022-01-27',
      status: 'Resolved',
    },
  ],
  medications: [
    {
      id: 'med-1',
      name: 'Levothyroxine',
      plain: 'Replaces the thyroid hormone your body makes too little of',
      strength: 75,
      unit: 'micrograms',
      instruction: 'Take one tablet each morning, before food.',
      prescribedBy: 'Dr. Okafor',
      startedOn: '2023-11-08',
    },
    {
      id: 'med-2',
      name: 'Amlodipine',
      plain: 'Relaxes blood vessels to lower blood pressure',
      strength: 5,
      unit: 'milligrams',
      instruction: 'Take one tablet each evening.',
      prescribedBy: 'Exampla Testperson',
      startedOn: '2024-05-19',
    },
  ],
  allergies: [
    {
      id: 'alg-1',
      substance: 'Penicillin',
      plain: 'A common antibiotic',
      reaction: 'Rash and swelling',
      severity: 'Severe',
      recordedOn: '2016-08-02',
    },
    {
      id: 'alg-2',
      substance: 'Pollen',
      plain: 'Grass and tree pollen in spring and summer',
      reaction: 'Sneezing and itchy eyes',
      severity: 'Mild',
      recordedOn: '2015-04-30',
    },
  ],
  immunisations: [
    {
      id: 'imm-1',
      vaccine: 'Influenza',
      plain: 'Seasonal flu',
      givenOn: '2025-10-09',
      doseLabel: 'Yearly dose',
    },
    {
      id: 'imm-2',
      vaccine: 'Tetanus, diphtheria and polio',
      plain: 'Three-in-one booster',
      givenOn: '2019-02-14',
      doseLabel: 'Booster',
    },
  ],
  documents: [
    {
      id: 'doc-1',
      title: 'Endocrinology clinic letter',
      plain: 'A summary of your thyroid appointment, written for your GP',
      addedOn: '2026-06-13',
      format: 'PDF, 2 pages',
    },
    {
      id: 'doc-2',
      title: 'Blood test report',
      plain: 'The full laboratory report behind your results',
      addedOn: '2026-06-09',
      format: 'PDF, 1 page',
    },
  ],
  results: [
    {
      id: 'res-1',
      name: 'Thyroid stimulating hormone',
      plain: 'How hard your body is asking the thyroid to work',
      value: 6.8,
      unit: 'mIU/L',
      referenceRange: '0.4 to 4.0 mIU/L',
      range: 'out-of-range',
      rangeLabel: 'Above the usual range',
      takenOn: '2026-06-09',
    },
    {
      id: 'res-2',
      name: 'Haemoglobin',
      plain: 'The protein that carries oxygen in your blood',
      value: 131,
      unit: 'g/L',
      referenceRange: '120 to 150 g/L',
      range: 'in-range',
      rangeLabel: 'In the usual range',
      takenOn: '2026-06-09',
    },
    {
      id: 'res-3',
      name: 'Vitamin D',
      plain: 'Helps your body use calcium for bone strength',
      value: 58,
      unit: 'nmol/L',
      referenceRange: '',
      range: 'unknown',
      rangeLabel: 'No usual range recorded',
      takenOn: '2026-06-09',
    },
  ],
};

const THREADS: MessageThread[] = [
  {
    id: 'thread-1',
    subject: 'Thyroid result',
    correspondent: 'Dr. Okafor',
    lastMessageAt: '2026-06-14T10:02:00.000Z',
    unread: true,
    messages: [
      {
        id: 'msg-1',
        author: 'care-team',
        authorName: 'Dr. Okafor',
        sentAt: '2026-06-14T10:02:00.000Z',
        body: 'Your thyroid result is a little above the usual range. Your dose may need a small change. Bring any symptoms you have noticed to the review on 3 September.',
      },
    ],
  },
  {
    id: 'thread-2',
    subject: 'Repeat prescription',
    correspondent: 'Exampla Testperson',
    lastMessageAt: '2026-05-28T15:40:00.000Z',
    unread: false,
    messages: [
      {
        id: 'msg-2',
        author: 'patient',
        authorName: 'Testina Patientsson',
        sentAt: '2026-05-27T09:12:00.000Z',
        body: 'I have two weeks of amlodipine left. Can the repeat be sent to the pharmacy on Elm Row?',
      },
      {
        id: 'msg-3',
        author: 'care-team',
        authorName: 'Exampla Testperson',
        sentAt: '2026-05-28T15:40:00.000Z',
        body: 'The repeat has gone to the pharmacy on Elm Row. It is usually ready two working days later.',
      },
    ],
  },
];

const FORMS: FormTask[] = [
  {
    id: 'form-1',
    title: 'Before your thyroid review',
    purpose: 'Your answers go to Dr. Okafor before the appointment on 3 September.',
    dueOn: '2026-09-01',
    status: 'in-progress',
    answers: { 'q-1': 'Some days' },
    questions: [
      {
        id: 'q-1',
        prompt: 'How often have you felt unusually tired in the last two weeks?',
        help: 'Pick the answer closest to your experience.',
        kind: 'single-choice',
        options: ['Not at all', 'Some days', 'Most days', 'Every day'],
      },
      {
        id: 'q-2',
        prompt: 'Have you missed any doses of levothyroxine?',
        kind: 'yes-no',
      },
      {
        id: 'q-3',
        prompt: 'Is there anything else you want to raise at the appointment?',
        help: 'Leave this blank if there is nothing.',
        kind: 'text',
      },
    ],
  },
  {
    id: 'form-2',
    title: 'Contact details check',
    purpose: 'Confirms the phone number and address the practice writes to.',
    dueOn: '2026-09-10',
    status: 'not-started',
    answers: {},
    questions: [
      {
        id: 'q-4',
        prompt: 'Is the phone number ending 4471 still the best number for you?',
        kind: 'yes-no',
      },
      {
        id: 'q-5',
        prompt: 'What address should letters go to?',
        help: 'Leave this blank to keep the address already on file.',
        kind: 'text',
      },
    ],
  },
];

const STATEMENTS: Statement[] = [
  {
    id: 'stmt-1',
    reference: 'ST-2026-0418',
    issuedOn: '2026-06-15',
    dueOn: '2026-09-15',
    status: 'due',
    total: { amountMinor: 8450, currency: CURRENCY },
    balance: { amountMinor: 8450, currency: CURRENCY },
    lines: [
      {
        id: 'line-1',
        description: 'Endocrinology appointment with Dr. Okafor',
        code: 'CONS-30',
        quantity: 1,
        amount: { amountMinor: 6500, currency: CURRENCY },
      },
      {
        id: 'line-2',
        description: 'Blood test, thyroid and full blood count',
        code: 'LAB-114',
        quantity: 1,
        amount: { amountMinor: 1950, currency: CURRENCY },
      },
    ],
  },
  {
    id: 'stmt-2',
    reference: 'ST-2026-0233',
    issuedOn: '2026-03-04',
    dueOn: '2026-04-04',
    status: 'credit',
    total: { amountMinor: -1200, currency: CURRENCY },
    balance: { amountMinor: -1200, currency: CURRENCY },
    lines: [
      {
        id: 'line-3',
        description: 'Refund for an appointment the practice moved',
        code: 'ADJ-02',
        quantity: 1,
        amount: { amountMinor: -1200, currency: CURRENCY },
      },
    ],
  },
];

export interface Fixtures {
  patient: Patient;
  appointments: Appointments;
  balance: Balance;
  healthRecord: HealthRecord;
  threads: MessageThread[];
  forms: FormTask[];
  statements: Statement[];
  documents: ClinicalDocument[];
}

/** Structured deep copy, so a caller can mutate its fixtures without touching the source. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/** Assembles the home screen's summary from the other fixtures, so the two can never drift. */
export function buildHomeSummary(fixtures: Fixtures): HomeSummary {
  const unreadMessages = fixtures.threads.filter((thread) => thread.unread).length;
  const outstandingForms = fixtures.forms.filter((form) => form.status !== 'submitted');

  return {
    patient: copy(fixtures.patient),
    nextAppointment: copy(fixtures.appointments.upcoming[0] ?? null),
    balance: copy(fixtures.balance),
    unreadMessages,
    actionItems: outstandingForms.map((form) => ({
      id: `action-${form.id}`,
      title: form.title,
      detail: form.purpose,
      href: '/forms',
      actionLabel: form.status === 'in-progress' ? 'Continue the form' : 'Start the form',
    })),
  };
}

/** A fresh, independent copy of every fixture. */
export function buildFixtures(): Fixtures {
  return {
    patient: copy(PATIENT),
    appointments: { upcoming: copy(UPCOMING), past: copy(PAST) },
    balance: copy(BALANCE),
    healthRecord: copy(HEALTH_RECORD),
    threads: copy(THREADS),
    forms: copy(FORMS),
    statements: copy(STATEMENTS),
    documents: copy(HEALTH_RECORD.documents),
  };
}

/** Fixtures with every collection emptied, for exercising the empty states. */
export function buildEmptyFixtures(): Fixtures {
  return {
    patient: copy(PATIENT),
    appointments: { upcoming: [], past: [] },
    balance: {
      outstanding: { amountMinor: 0, currency: CURRENCY },
      dueOn: null,
      statementCount: 0,
    },
    healthRecord: {
      problems: [],
      medications: [],
      allergies: [],
      immunisations: [],
      documents: [],
      results: [],
    },
    threads: [],
    forms: [],
    statements: [],
    documents: [],
  };
}

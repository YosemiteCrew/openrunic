import { describe, expect, it } from 'vitest';

import { RELATIONSHIP_SOURCES } from '../policy/care-relationship.js';
import type { ScopedRow } from '../repositories/rows.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_PORTAL_PATIENT,
  FIXED_NOW,
  makeAppointmentRow,
  makePatientRow,
  seed,
  storageColumns,
  SUBJECTS,
  testId,
  TOKENS,
} from './support.js';

/**
 * Who may open a chart, asked of both boundaries at once.
 *
 * The BFF and the FHIR server have drifted apart on exactly this question
 * before: #139 found the FHIR boundary narrowing patient reads on
 * `primaryFacilityId` while the BFF did not, so the same caller got 404 from
 * one and 200 from the other for the same chart. Nothing stopped that except
 * somebody noticing.
 *
 * So every case here runs against both, from one table. A rule that held on one
 * boundary and not the other fails as two cases with the same name, and the
 * name says which side gave the wrong answer.
 */

const PATIENT = testId(3_001);
const OTHER_PROVIDER = testId(3_002);
const CARE_TEAM = testId(3_003);

/**
 * Older than the facility-activity window (365 days), computed against the real
 * clock because the boundary reads `new Date()` and cannot be handed a fixed
 * one. Relative rather than a literal so it stays stale whenever the suite runs.
 */
const STALE_AGO_MS = 400 * 24 * 60 * 60 * 1000;

/** Both addressed reads of the same chart. A rule has to answer them alike. */
const BOUNDARIES = [
  { name: 'bff', path: (id: string) => `/bff/v0/patients/${id}` },
  { name: 'fhir', path: (id: string) => `/fhir/Patient/${id}` },
] as const;

type Dataset = ReturnType<typeof createTestApp>['dataset'];
type Seeder = (dataset: Dataset) => void;

/** A chart with nobody attached to it. Every case adds its own reason. */
function baseChart(dataset: Dataset): void {
  seed(dataset, 'Patient', makePatientRow({ id: PATIENT, mrn: 'OR-103001' }));
}

/**
 * Seeders for the rows these cases are made of.
 *
 * Written once rather than inline per case, because the same fifteen-line
 * literal repeated seven times is what a duplication gate is for, and because
 * a case reads better as "an encounter, entered in error" than as the columns
 * that spell it.
 */
function anEncounter(
  dataset: Dataset,
  overrides: Partial<ScopedRow<'Encounter'>> & { id: string }
): void {
  seed(dataset, 'Encounter', {
    ...storageColumns(overrides.id),
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT,
    providerId: OTHER_PROVIDER,
    appointmentId: null,
    class: 'AMBULATORY',
    status: 'COMPLETED',
    reasonCode: 'R51',
    reasonText: 'Headache',
    startedAt: FIXED_NOW,
    endedAt: null,
    signedAt: null,
    signedById: null,
    ...overrides,
  });
}

function aTeamWithMember(
  dataset: Dataset,
  options: {
    teamId: string;
    memberId: string;
    patientId?: string;
    status?: ScopedRow<'CareTeam'>['status'];
    periodStart?: Date | null;
    periodEnd?: Date | null;
    teamPeriodStart?: Date | null;
    teamPeriodEnd?: Date | null;
  }
): void {
  const patientId = options.patientId ?? PATIENT;
  seed(dataset, 'CareTeam', {
    ...storageColumns(options.teamId),
    patientId,
    status: options.status ?? 'ACTIVE',
    name: null,
    periodStart: options.teamPeriodStart ?? null,
    periodEnd: options.teamPeriodEnd ?? null,
  });
  seed(dataset, 'CareTeamParticipant', {
    ...storageColumns(options.memberId),
    careTeamId: options.teamId,
    patientId,
    memberType: 'USER',
    memberUserId: SUBJECTS.clinicianA,
    memberRelatedPersonId: null,
    roleCode: '207Q00000X',
    roleSystem: 'http://nucc.org/provider-taxonomy',
    roleText: null,
    periodStart: options.periodStart ?? null,
    periodEnd: options.periodEnd ?? null,
  });
}

function aTask(
  dataset: Dataset,
  id: string,
  assigneeUserId: string,
  assignedById: string | null = OTHER_PROVIDER
): void {
  seed(dataset, 'Task', {
    ...storageColumns(id),
    type: 'RESULT',
    status: 'OPEN',
    priority: 'NORMAL',
    patientId: PATIENT,
    encounterId: null,
    subjectType: null,
    subjectId: null,
    title: 'Sign the lab result',
    description: null,
    assigneeType: 'USER',
    assigneeUserId,
    assigneeTeamKey: null,
    assignedById,
    dueAt: null,
    slaState: 'OK',
    expiresAt: null,
    sourceEventId: null,
    completedAt: null,
    completedById: null,
    outcome: null,
  });
}

function aClaim(dataset: Dataset, id: string, patientId: string, encounterId: string): void {
  seed(dataset, 'Claim', {
    ...storageColumns(id),
    patientId,
    encounterId,
    coverageId: testId(3_411),
    payerId: testId(3_412),
    status: 'DRAFT',
    frequency: 'ORIGINAL',
    diagnosisCodes: ['E11.9'],
    totalChargedCents: 12_000,
    totalPaidCents: 0,
    totalAdjustedCents: 0,
    patientResponsibilityCents: 0,
    secondaryOfId: null,
    priorClaimId: null,
    controlNumbers: {},
    snapshot: {},
    statusReason: null,
    submittedAt: null,
    acknowledgedAt: null,
    adjudicatedAt: null,
  });
}

/**
 * A case, and which entry in `RELATIONSHIP_SOURCES` it is there to exercise.
 *
 * Naming the source rather than counting the cases is what lets a source have
 * two of them - `facility-activity` has an encounter half and an appointment
 * half, and `assigned-task` has a colleague's task and the system's own - while
 * still failing when a source has none.
 */
interface GrantedCase {
  readonly why: string;
  readonly source: string;
  readonly seedIt: Seeder;
}

const GRANTED: readonly GrantedCase[] = [
  {
    why: 'the clinician saw them',
    source: 'encounter',
    seedIt: (dataset) => {
      anEncounter(dataset, { id: testId(3_010), providerId: SUBJECTS.clinicianA });
    },
  },
  {
    why: 'the clinician is due to see them',
    source: 'appointment',
    seedIt: (dataset) => {
      seed(
        dataset,
        'Appointment',
        makeAppointmentRow({
          id: testId(3_011),
          patientId: PATIENT,
          providerId: SUBJECTS.clinicianA,
          facilityId: DEMO_FACILITY_A,
        })
      );
    },
  },
  {
    why: 'the clinician is on their care team',
    source: 'care-team',
    seedIt: (dataset) => {
      aTeamWithMember(dataset, { teamId: CARE_TEAM, memberId: testId(3_012) });
    },
  },
  {
    why: 'they took break-glass and it has not expired',
    source: 'break-glass',
    seedIt: (dataset) => {
      seed(dataset, 'BreakGlassGrant', {
        ...storageColumns(testId(3_014)),
        userId: SUBJECTS.clinicianA,
        patientId: PATIENT,
        reason: 'Collapsed in reception, no record at this site.',
        grantedAt: new Date(FIXED_NOW.getTime() - 60 * 1000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    },
  },
  {
    why: 'somebody else handed them a task about this patient',
    source: 'assigned-task',
    seedIt: (dataset) => {
      /* ADR-0007 lists `Task.assigneeUserId` in the evidence table. Without it a
         clinician sent a result to sign can open the task and not the chart the
         task is about, which makes the work impossible and teaches people that
         break-glass is a normal step. */
      aTask(dataset, testId(3_016), SUBJECTS.clinicianA, OTHER_PROVIDER);
    },
  },
  {
    why: 'somebody else is due to see them at a site the clinician works at',
    source: 'facility-activity',
    seedIt: (dataset) => {
      /* Reception's commonest case, and the one that showed the encounter half
         of `facility-activity` was carrying the appointment half's test too. */
      seed(
        dataset,
        'Appointment',
        makeAppointmentRow({
          id: testId(3_015),
          patientId: PATIENT,
          providerId: OTHER_PROVIDER,
          facilityId: DEMO_FACILITY_A,
        })
      );
    },
  },
  {
    why: 'the clinician personally saw them, over a year ago',
    source: 'encounter',
    seedIt: (dataset) => {
      /* The provider source has no recency bound, unlike facility-activity: a
         clinician named on a visit keeps the chart after the site's general
         access to it has gone stale. This is what makes the two distinct. */
      anEncounter(dataset, {
        id: testId(3_030),
        providerId: SUBJECTS.clinicianA,
        startedAt: new Date(Date.now() - STALE_AGO_MS),
      });
    },
  },
  {
    why: 'somebody else saw them at a site the clinician works at',
    source: 'facility-activity',
    seedIt: (dataset) => {
      /* The receptionist and the covering nurse. Neither is named on anything,
         and both legitimately open the chart. */
      anEncounter(dataset, { id: testId(3_013) });
    },
  },
];

const REFUSED: readonly { readonly why: string; readonly seedIt: Seeder }[] = [
  {
    why: 'nothing connects them at all',
    seedIt: () => {
      /* The case the whole change is about: a chart readable by anyone who can
         name it. */
    },
  },
  {
    why: 'the only activity is at a site the clinician does not work at',
    seedIt: (dataset) => {
      anEncounter(dataset, { id: testId(3_020), facilityId: DEMO_FACILITY_B });
    },
  },
  {
    why: 'the only task about them is assigned to somebody else',
    seedIt: (dataset) => {
      /* The half that says the task source is a narrowing. Without the
         assignee filter it would authorise on the existence of any task about
         the patient, which is every patient anyone has ever worked. */
      aTask(dataset, testId(3_027), OTHER_PROVIDER);
    },
  },
  {
    why: 'the only task about them has no recorded assigner',
    seedIt: (dataset) => {
      /* Null is not trusted-because-system: it is every task from before the
         column existed, every task an old instance writes mid-rolling-deploy,
         and a task self-assigned through the pre-change handler. An absence is
         not provenance, so it does not authorise. */
      aTask(dataset, testId(3_029), SUBJECTS.clinicianA, null);
    },
  },
  {
    why: 'the only task about them is one they assigned to themselves',
    seedIt: (dataset) => {
      /* The reported escalation. Every role that can read a chart can also
         write a task, and a task names its own patient and its own assignee, so
         without the provenance check an account holding `task.write` would file
         one about any patient id it could guess and have manufactured its own
         relationship: no reason, no expiry, no ceiling. */
      aTask(dataset, testId(3_028), SUBJECTS.clinicianA, SUBJECTS.clinicianA);
    },
  },
  {
    why: 'the only facility activity is a visit over a year ago',
    seedIt: (dataset) => {
      /* facility-activity expires. A completed visit by somebody else, older
         than the window, is history - not a live reason for the whole site to
         hold the chart open, which unbounded it would be forever. */
      anEncounter(dataset, {
        id: testId(3_031),
        providerId: OTHER_PROVIDER,
        startedAt: new Date(Date.now() - STALE_AGO_MS),
      });
    },
  },
  {
    why: 'the only facility activity is a booking over a year ago',
    seedIt: (dataset) => {
      /* The appointment half of the same expiry: a no-show or a passed booking
         from last year is not current, and the future side stays open only
         because a booking still to come is a live commitment. */
      seed(
        dataset,
        'Appointment',
        makeAppointmentRow({
          id: testId(3_032),
          patientId: PATIENT,
          providerId: OTHER_PROVIDER,
          facilityId: DEMO_FACILITY_A,
          start: new Date(Date.now() - STALE_AGO_MS),
          end: new Date(Date.now() - STALE_AGO_MS + 30 * 60 * 1000),
        })
      );
    },
  },
  {
    why: 'the only encounter was declared never to have happened',
    seedIt: (dataset) => {
      /* This schema keeps a correction as ENTERED_IN_ERROR rather than deleting
         the row, which is right for the trail and wrong for authorisation: a
         visit somebody already withdrew would otherwise grant every clinician
         at that site permanent access to the chart. */
      anEncounter(dataset, {
        id: testId(3_022),
        providerId: SUBJECTS.clinicianA,
        status: 'ENTERED_IN_ERROR',
      });
    },
  },
  {
    why: 'the only care-team membership has ended',
    seedIt: (dataset) => {
      /* A participant row outlives the membership on purpose, because deleting
         it would rewrite who was responsible at the time. So the row staying is
         right and reading it as current is wrong: a clinician taken off a team
         keeps their row and loses the chart. */
      aTeamWithMember(dataset, {
        teamId: testId(3_023),
        memberId: testId(3_024),
        periodStart: new Date(FIXED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000),
      });
    },
  },
  {
    why: 'the team they are on has not started yet',
    seedIt: (dataset) => {
      /* A team can be marked ACTIVE with a period that has not begun. Status is
         not the whole of "in force". */
      /* Future relative to the real clock the check reads (`new Date()`), not to
         FIXED_NOW: a start a day past FIXED_NOW is already behind us. */
      aTeamWithMember(dataset, {
        teamId: testId(3_033),
        memberId: testId(3_034),
        teamPeriodStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    },
  },
  {
    why: 'the team they are on has stood down',
    seedIt: (dataset) => {
      aTeamWithMember(dataset, {
        teamId: testId(3_035),
        memberId: testId(3_036),
        teamPeriodEnd: new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000),
      });
    },
  },
  {
    why: 'the team they are on is no longer active',
    seedIt: (dataset) => {
      aTeamWithMember(dataset, {
        teamId: testId(3_025),
        memberId: testId(3_026),
        status: 'INACTIVE',
      });
    },
  },
  {
    why: 'the break-glass window has expired',
    seedIt: (dataset) => {
      seed(dataset, 'BreakGlassGrant', {
        ...storageColumns(testId(3_021)),
        userId: SUBJECTS.clinicianA,
        patientId: PATIENT,
        reason: 'Emergency, last week.',
        grantedAt: new Date(FIXED_NOW.getTime() - 2 * 60 * 60 * 1000),
        expiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
      });
    },
  },
];

const CASES = BOUNDARIES.flatMap((boundary) => [
  ...GRANTED.map((one) => ({ boundary, ...one, expected: 200 })),
  ...REFUSED.map((one) => ({ boundary, ...one, expected: 404 })),
]);

describe('both boundaries answer the chart question identically', () => {
  it.each(
    CASES.map(
      (one) =>
        [
          `${one.boundary.name}: ${one.expected === 200 ? 'opens' : 'refuses'} when ${one.why}`,
          one,
        ] as const
    )
  )('%s', async (_label, one) => {
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    one.seedIt(dataset);

    const res = await app.request(one.boundary.path(PATIENT), {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(one.expected);
  });

  it('has a case for every source the policy lists', () => {
    /*
     * The guard on the guard. A source added to `RELATIONSHIP_SOURCES` without
     * a case here would be an unasserted way into a chart, and this suite would
     * pass without noticing.
     *
     * It compares names rather than counts. An earlier version subtracted the
     * halves of `facility-activity` from `GRANTED.length` and added one back
     * for `own-record`, which meant a case added for a source that already had
     * one broke the arithmetic and said "a source has no case" about a suite
     * that had just grown a test. Names do not have that failure mode, and they
     * say which source is missing rather than that one is.
     *
     * `own-record` is excluded deliberately: a staff token cannot exercise it,
     * and the portal compartment tests are where it lives.
     */
    const covered = new Set(GRANTED.map((one) => one.source));
    const staffReachable = RELATIONSHIP_SOURCES.map((source) => source.name).filter(
      (name) => name !== 'own-record'
    );

    expect(
      staffReachable.filter((name) => !covered.has(name)),
      'a relationship source has no case: adding one is adding a way into a chart'
    ).toEqual([]);
    expect(
      [...covered].filter((name) => !staffReachable.includes(name)),
      'a case names a source the policy does not list'
    ).toEqual([]);
  });
});

describe('the gate is not walked around', () => {
  /*
   * Every one of these was a live bypass when the gate first landed, found by
   * reviewing the diff rather than by a test failing. A guard that the next
   * route along defeats is not a guard, so each way round it gets its own case.
   */

  function chartWithNoRelationship(): ReturnType<typeof createTestApp> {
    const created = createTestApp();
    baseChart(created.dataset);
    return created;
  }

  it('refuses the C-CDA, which returns more of the chart than the read does', async () => {
    /* This route is mounted three lines above the gated read and takes the same
       id. Gating one and not the other left the wider door open: refused the
       chart header, a caller could ask for problems, medications, allergies,
       immunisations and encounters in one document. */
    const { app } = chartWithNoRelationship();

    const res = await app.request(`/bff/v0/patients/${PATIENT}/ccd`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('refuses a search that names one chart by id', async () => {
    /* `GET /fhir/Patient?_id={id}` is the addressed read wearing a search's
       clothes, and it answered 200 with the whole resource while
       `GET /fhir/Patient/{id}` answered 404. */
    const { app } = chartWithNoRelationship();

    const res = await app.request(`/fhir/Patient?_id=${PATIENT}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('refuses a search that names one chart by MRN', async () => {
    const { app } = chartWithNoRelationship();

    const res = await app.request('/fhir/Patient?identifier=OR-103001', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('refuses a chart-scoped search, which is the chart spelled differently', async () => {
    /*
     * The last hole, and the widest. Every clinical resource advertises
     * `patient`, and `Condition?patient=Patient/{id}` is not a search at all: it
     * is "open this chart's problem list". Measured before it was closed - with
     * no relationship, the addressed Patient read and the addressed Condition
     * read both answered 404 while this answered 200 with the ICD-10 diagnosis.
     * Gating the addressed read and leaving this is gating the door and leaving
     * the window.
     */
    const { app, dataset } = chartWithNoRelationship();
    seed(dataset, 'Condition', {
      ...storageColumns(testId(3_500)),
      patientId: PATIENT,
      encounterId: null,
      code: 'E11.9',
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Type 2 diabetes',
      category: 'PROBLEM_LIST_ITEM',
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
    });

    const addressed = await app.request(`/fhir/Condition/${testId(3_500)}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const scoped = await app.request(`/fhir/Condition?patient=Patient/${PATIENT}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(addressed.status).toBe(404);
    expect(scoped.status, 'the chart-scoped search must answer like the read').toBe(404);
  });

  it('still allows a search that describes a patient rather than naming one', async () => {
    /*
     * The other half, and the one that matters more. Registration and
     * duplicate-checking look somebody up by name and birth date precisely
     * because there is no relationship yet, and #169 requires those to keep
     * working. Narrowing them would trade a lookup problem for a duplicate
     * records problem, which is its own patient-safety hazard.
     */
    const { app } = chartWithNoRelationship();

    const res = await app.request('/fhir/Patient?family=Patientsson', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
  });
});

/**
 * The gate is asked by the route that reads the parent row, and the routes that
 * read a collection INSIDE that parent were not asking it.
 *
 * #300. Every one of these routes reads its parent first and says so in a
 * comment: an id naming a chart this principal cannot reach should be a 404
 * rather than an empty list, because an empty list says the parent has no
 * children and that is a different and false statement. The reasoning is right
 * about the row being ABSENT and silent about it being present and ungated -
 * `findById` narrows by tenant, by the portal compartment and by facility, and
 * never by care relationship. So the parent answered 404 and the thing inside
 * it answered 200, to the same principal, in the same breath.
 *
 * Each case carries the refused parent beside it, because without that half the
 * case only says the fixture is unreachable rather than that the child route is
 * the way round.
 */
describe('a collection inside a chart is not a way round the gate', () => {
  const ENCOUNTER = testId(3_600);

  /**
   * A chart whose only encounter is at a site this reader holds no grant for.
   *
   * `facility-activity` is what would otherwise answer for a clinician with no
   * other tie to the chart, so the encounter has to exist - the parent rows
   * below all hang off one - and it has to be somewhere the reader is not.
   */
  function unreachableChart(): ReturnType<typeof createTestApp> {
    const created = createTestApp();
    baseChart(created.dataset);
    anEncounter(created.dataset, { id: ENCOUNTER, facilityId: DEMO_FACILITY_B });
    return created;
  }

  /** The same chart, with the reader on the encounter. The control for every case. */
  function reachableChart(): ReturnType<typeof createTestApp> {
    const created = createTestApp();
    baseChart(created.dataset);
    anEncounter(created.dataset, { id: ENCOUNTER, providerId: SUBJECTS.clinicianA });
    return created;
  }

  const NOTE = testId(3_610);

  function aNoteWithAddendum(dataset: Dataset): void {
    seed(dataset, 'ClinicalNote', {
      ...storageColumns(NOTE),
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      authorId: SUBJECTS.clinicianA,
      title: 'Progress note',
      blocks: [],
      state: 'AMENDED',
      cosignerId: null,
      cosignedAt: null,
      signedAt: FIXED_NOW,
      signedById: SUBJECTS.clinicianA,
      lockedAt: null,
    } as unknown as ScopedRow<'ClinicalNote'>);
    seed(dataset, 'NoteAddendum', {
      ...storageColumns(testId(3_611)),
      noteId: NOTE,
      authorId: SUBJECTS.clinicianA,
      blocks: [],
      reason: 'Corrected the laterality',
      signedAt: FIXED_NOW,
    });
  }

  it('refuses the addenda of a note whose own read is refused', async () => {
    /* The amendment text: a clinician's correction to a signed note, which is
       chart content and was being served whole. */
    const { app, dataset } = unreachableChart();
    aNoteWithAddendum(dataset);

    const note = await app.request(`/bff/v0/notes/${NOTE}`, { headers: bearer(TOKENS.clinicianA) });
    const addenda = await app.request(`/bff/v0/notes/${NOTE}/addenda`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(note.status, 'the parent read is the half that was already right').toBe(404);
    expect(addenda.status).toBe(404);
  });

  it('still serves the addenda to a reader who is in that patient’s care', async () => {
    /* The other half, and the one that decides whether this is a fix or an
       outage: a refusal that also refuses the correct reader is the failure
       that gets a gate deleted. */
    const { app, dataset } = reachableChart();
    aNoteWithAddendum(dataset);

    const note = await app.request(`/bff/v0/notes/${NOTE}`, { headers: bearer(TOKENS.clinicianA) });
    const addenda = await app.request(`/bff/v0/notes/${NOTE}/addenda`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(note.status).toBe(200);
    expect(addenda.status).toBe(200);
  });

  const THREAD = testId(3_620);

  function aThreadWithMessage(dataset: Dataset): void {
    seed(dataset, 'MessageThread', {
      ...storageColumns(THREAD),
      kind: 'PATIENT',
      patientId: PATIENT,
      subject: 'Repeat prescription',
      lastMessageAt: FIXED_NOW,
      closedAt: null,
    } as unknown as ScopedRow<'MessageThread'>);
    seed(dataset, 'Message', {
      ...storageColumns(testId(3_621)),
      threadId: THREAD,
      senderType: 'PATIENT',
      senderUserId: null,
      senderPatientId: PATIENT,
      body: 'Asking about the dose.',
      sentAt: FIXED_NOW,
      readAt: null,
    } as unknown as ScopedRow<'Message'>);
  }

  it('refuses the messages inside a thread whose own read is refused', async () => {
    const { app, dataset } = unreachableChart();
    aThreadWithMessage(dataset);

    const thread = await app.request(`/bff/v0/messages/threads/${THREAD}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const messages = await app.request(`/bff/v0/messages/threads/${THREAD}/messages`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(thread.status).toBe(404);
    expect(messages.status).toBe(404);
  });

  it('still serves those messages to a reader in that patient’s care', async () => {
    const { app, dataset } = reachableChart();
    aThreadWithMessage(dataset);

    const messages = await app.request(`/bff/v0/messages/threads/${THREAD}/messages`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(messages.status).toBe(200);
  });

  const REPORT = testId(3_630);

  function aReportWithAnalyte(dataset: Dataset): void {
    seed(dataset, 'DiagnosticReport', {
      ...storageColumns(REPORT),
      patientId: PATIENT,
      encounterId: null,
      serviceRequestId: null,
      specimenId: null,
      status: 'FINAL',
      category: 'LAB',
      code: '58410-2',
      codeSystem: 'http://loinc.org',
      display: 'CBC panel',
      performingLabName: null,
      abnormalFlag: 'NORMAL',
      narrative: null,
      rawStorageKey: null,
      effectiveAt: FIXED_NOW,
      issuedAt: FIXED_NOW,
      reviewedById: null,
      reviewedAt: null,
    } as unknown as ScopedRow<'DiagnosticReport'>);
    seed(dataset, 'ResultObservation', {
      ...storageColumns(testId(3_631)),
      diagnosticReportId: REPORT,
      patientId: PATIENT,
      status: 'FINAL',
      sequence: 1,
      loincCode: '718-7',
      code: '718-7',
      codeSystem: 'http://loinc.org',
      display: 'Haemoglobin',
      valueNumber: null,
      valueText: '13.4',
      valueCode: null,
      unit: 'g/dL',
      referenceLow: null,
      referenceHigh: null,
      referenceRangeText: null,
      interpretationCode: null,
      abnormalFlag: 'NORMAL',
      effectiveAt: FIXED_NOW,
    } as unknown as ScopedRow<'ResultObservation'>);
  }

  it('refuses the analytes under a report whose own read is refused', async () => {
    const { app, dataset } = unreachableChart();
    aReportWithAnalyte(dataset);

    const report = await app.request(`/bff/v0/results/${REPORT}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const analytes = await app.request(`/bff/v0/results/${REPORT}/observations`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(report.status).toBe(404);
    expect(analytes.status).toBe(404);
  });

  it('still serves those analytes to a reader in that patient’s care', async () => {
    const { app, dataset } = reachableChart();
    aReportWithAnalyte(dataset);

    const analytes = await app.request(`/bff/v0/results/${REPORT}/observations`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(analytes.status).toBe(200);
  });

  const PAYMENT = testId(3_640);

  function aPaymentWithAllocation(dataset: Dataset): void {
    seed(dataset, 'Payment', {
      ...storageColumns(PAYMENT),
      patientId: PATIENT,
      payerId: null,
      remittanceId: null,
      source: 'PATIENT',
      method: 'CARD',
      status: 'POSTED',
      amountCents: 4_000,
      currency: 'USD',
      reference: null,
      adapterRef: null,
      receivedAt: FIXED_NOW,
      postedAt: FIXED_NOW,
      postedById: null,
      note: null,
    } as unknown as ScopedRow<'Payment'>);
    seed(dataset, 'PaymentAllocation', {
      ...storageColumns(testId(3_641)),
      paymentId: PAYMENT,
      patientId: PATIENT,
      claimId: null,
      claimLineId: null,
      chargeItemId: null,
      amountCents: 4_000,
      adjustmentGroupCode: null,
      adjustmentReasonCode: null,
      appliedAt: FIXED_NOW,
      note: null,
    });
  }

  it('refuses the allocations under a payment whose own read is refused', async () => {
    /* The biller, not the clinician: `payment.read` is a billing permission and
       a clinician asking is a 403 before the chart question is ever reached,
       which would have made this case pass for the wrong reason. */
    const { app, dataset } = unreachableChart();
    aPaymentWithAllocation(dataset);

    const payment = await app.request(`/bff/v0/payments/${PAYMENT}`, {
      headers: bearer(TOKENS.billerA),
    });
    const allocations = await app.request(`/bff/v0/payments/${PAYMENT}/allocations`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(payment.status).toBe(404);
    expect(allocations.status).toBe(404);
  });

  it('still serves the allocations to a biller who may open that chart', async () => {
    const { app, dataset } = reachableChart();
    aPaymentWithAllocation(dataset);

    const allocations = await app.request(`/bff/v0/payments/${PAYMENT}/allocations`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(allocations.status).toBe(200);
  });

  /*
   * The claim pair runs as the biller, because a clinician holds no
   * `claim.read` and the case that matters for a claim is the one the suite
   * already carries for the addressed read: a biller with no grant for the site
   * the encounter happened at.
   */
  const BILLED_CLAIM = testId(3_650);

  function aClaimWithLine(dataset: Dataset): void {
    seed(dataset, 'Patient', makePatientRow({ id: testId(3_651), mrn: 'OR-103651' }));
    anEncounter(dataset, {
      id: testId(3_652),
      facilityId: DEMO_FACILITY_B,
      patientId: testId(3_651),
    });
    aClaim(dataset, BILLED_CLAIM, testId(3_651), testId(3_652));
    seed(dataset, 'ClaimLine', {
      ...storageColumns(testId(3_653)),
      claimId: BILLED_CLAIM,
      chargeItemId: testId(3_654),
      sequence: 1,
      code: '99213',
      codeSystem: 'http://www.ama-assn.org/go/cpt',
      modifiers: [],
      units: 1,
      chargedCents: 12_000,
      allowedCents: null,
      paidCents: 0,
      adjustedCents: 0,
      diagnosisPointers: [1],
      serviceDateFrom: FIXED_NOW,
      serviceDateTo: null,
      statusReason: null,
    });
  }

  it('refuses the LINES of a claim whose own read is refused', async () => {
    /* `refuses the same claim to a biller with no grant for that site` above is
       the parent half of this, on the FHIR boundary, and it was already
       passing while this answered 200 with the CPT codes and the amounts.
       Separate from the history case below so that reverting one route names
       one test: a single case covering both cannot say which of the two is
       ungated, which is the whole failure this block exists to catch. */
    const { app, dataset } = createTestApp();
    aClaimWithLine(dataset);

    const claim = await app.request(`/fhir/Claim/${BILLED_CLAIM}`, {
      headers: bearer(TOKENS.billerA),
    });
    const lines = await app.request(`/bff/v0/claims/${BILLED_CLAIM}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(claim.status).toBe(404);
    expect(lines.status).toBe(404);
  });

  it('refuses the STATUS HISTORY of a claim whose own read is refused', async () => {
    const { app, dataset } = createTestApp();
    aClaimWithLine(dataset);

    const history = await app.request(`/bff/v0/claims/${BILLED_CLAIM}/history`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(history.status).toBe(404);
  });

  /*
   * The ninth route, and the one where the shape of the fix above does not fit.
   *
   * A remittance is a payer document, so unlike every other parent here there
   * is no chart ON it to guard - `remittances.findById` narrows by tenant and
   * by nothing else. The chart data is on the CHILDREN: a `RemittanceLine`
   * names a claim and publishes its procedure code, its service date and what
   * the patient owes. Refusing `claims/{id}/lines` and serving the same line
   * one hop sideways is the gate working and the window open.
   */
  const REMITTANCE = testId(3_660);

  function aRemittanceOverThatClaim(dataset: Dataset): void {
    seed(dataset, 'Remittance', {
      ...storageColumns(REMITTANCE),
      payerId: testId(3_661),
      status: 'RECEIVED',
      checkOrEftNumber: null,
      totalPaidCents: 9_000,
      receivedAt: FIXED_NOW,
      paidAt: null,
      rawStorageKey: null,
      parsed: null,
      exceptionCount: 0,
      postedAt: null,
      postedById: null,
    } as unknown as ScopedRow<'Remittance'>);
    seed(dataset, 'RemittanceLine', {
      ...storageColumns(testId(3_662)),
      remittanceId: REMITTANCE,
      claimId: BILLED_CLAIM,
      claimLineId: testId(3_653),
      sequence: 1,
      payerControlNumber: null,
      code: '99213',
      chargedCents: 12_000,
      allowedCents: 9_000,
      paidCents: 9_000,
      patientResponsibilityCents: 3_000,
      adjustmentGroupCode: null,
      adjustmentReasonCode: null,
      remarkCodes: [],
      serviceDateFrom: FIXED_NOW,
      matched: true,
    });
  }

  it('refuses a remittance line naming a claim the reader may not open', async () => {
    const { app, dataset } = createTestApp();
    aClaimWithLine(dataset);
    aRemittanceOverThatClaim(dataset);

    const claimLines = await app.request(`/bff/v0/claims/${BILLED_CLAIM}/lines`, {
      headers: bearer(TOKENS.billerA),
    });
    const remittanceLines = await app.request(`/bff/v0/remittances/${REMITTANCE}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(claimLines.status, 'the claim route is the half already fixed').toBe(404);
    expect(remittanceLines.status).toBe(404);
  });

  it('refuses the remittance when only its LAST line is out of reach', async () => {
    /*
     * One claim-bearing line cannot tell "every claim on the page" from "the
     * first one" - the mutation that gates only `rows[0]` is green against the
     * case above. So there are two lines here in sequence order, the REACHABLE
     * chart first, and the row that must refuse is the one a first-only gate
     * never looks at. Same correction the collections worklist needed.
     */
    const REACHABLE = testId(3_670);
    const { app, dataset } = createTestApp();
    aClaimWithLine(dataset);
    aRemittanceOverThatClaim(dataset);
    seed(dataset, 'Patient', makePatientRow({ id: REACHABLE, mrn: 'OR-103670' }));
    anEncounter(dataset, { id: testId(3_671), patientId: REACHABLE });
    aClaim(dataset, testId(3_672), REACHABLE, testId(3_671));
    seed(dataset, 'RemittanceLine', {
      ...storageColumns(testId(3_673)),
      remittanceId: REMITTANCE,
      claimId: testId(3_672),
      claimLineId: null,
      sequence: 0,
      payerControlNumber: null,
      code: '99214',
      chargedCents: 15_000,
      allowedCents: 11_000,
      paidCents: 11_000,
      patientResponsibilityCents: 4_000,
      adjustmentGroupCode: null,
      adjustmentReasonCode: null,
      remarkCodes: [],
      serviceDateFrom: FIXED_NOW,
      matched: true,
    });

    const res = await app.request(`/bff/v0/remittances/${REMITTANCE}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(404);
  });

  it('refuses to PARSE a remittance whose lines name a chart out of reach', async () => {
    /*
     * The write half, and it had no test at all: removing the guard from the
     * shared reader was red on exactly one case in the whole 3597-test package,
     * which is a guard covering three routes and pinned on one.
     *
     * Parsing is where a remittance's lines are counted and its status moves,
     * and posting turns those same lines into payment allocations ON those
     * charts. Both read through the same function, so both are gated - and now
     * one of them says so.
     */
    const { app, dataset } = createTestApp();
    aClaimWithLine(dataset);
    aRemittanceOverThatClaim(dataset);

    const res = await app.request(`/bff/v0/remittances/${REMITTANCE}/parse`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.billerA), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it('still parses a remittance whose claims the reader may open', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(3_651), mrn: 'OR-103651' }));
    anEncounter(dataset, { id: testId(3_652), patientId: testId(3_651) });
    aClaim(dataset, BILLED_CLAIM, testId(3_651), testId(3_652));
    aRemittanceOverThatClaim(dataset);

    const res = await app.request(`/bff/v0/remittances/${REMITTANCE}/parse`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.billerA), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });

  it('still serves a remittance line whose claim the reader may open', async () => {
    /* Facility A, so `facility-activity` answers. Without this the case above
       is satisfied by refusing every biller every remittance, which would take
       the payment-posting workflow out entirely. */
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(3_651), mrn: 'OR-103651' }));
    anEncounter(dataset, { id: testId(3_652), patientId: testId(3_651) });
    aClaim(dataset, BILLED_CLAIM, testId(3_651), testId(3_652));
    aRemittanceOverThatClaim(dataset);

    const res = await app.request(`/bff/v0/remittances/${REMITTANCE}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
  });

  it('serves an unmatched line, which names no claim and so has no chart', async () => {
    /* The other direction the guard must not break: an exception line nobody
       has matched yet is the biller's actual work queue, and it carries no
       chart to ask about. */
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    aRemittanceOverThatClaim(dataset);
    seed(dataset, 'RemittanceLine', {
      ...storageColumns(testId(3_663)),
      remittanceId: testId(3_664),
      claimId: null,
      claimLineId: null,
      sequence: 1,
      payerControlNumber: 'UNMATCHED-1',
      code: '99213',
      chargedCents: 12_000,
      allowedCents: 0,
      paidCents: 0,
      patientResponsibilityCents: 0,
      adjustmentGroupCode: null,
      adjustmentReasonCode: null,
      remarkCodes: [],
      serviceDateFrom: FIXED_NOW,
      matched: false,
    });
    seed(dataset, 'Remittance', {
      ...storageColumns(testId(3_664)),
      payerId: testId(3_661),
      status: 'RECEIVED',
      checkOrEftNumber: null,
      totalPaidCents: 0,
      receivedAt: FIXED_NOW,
      paidAt: null,
      rawStorageKey: null,
      parsed: null,
      exceptionCount: 1,
      postedAt: null,
      postedById: null,
    } as unknown as ScopedRow<'Remittance'>);

    const res = await app.request(`/bff/v0/remittances/${testId(3_664)}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
  });

  it('still serves the lines for a claim the biller may open', async () => {
    /* Facility A this time, so `facility-activity` answers and the biller does
       their daily job. Without this the case above is satisfied by refusing
       every biller every claim. */
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(3_651), mrn: 'OR-103651' }));
    anEncounter(dataset, { id: testId(3_652), patientId: testId(3_651) });
    aClaim(dataset, BILLED_CLAIM, testId(3_651), testId(3_652));

    const lines = await app.request(`/bff/v0/claims/${BILLED_CLAIM}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(lines.status).toBe(200);
  });
});

/**
 * The work queues, which are the same bypass with no id in the request at all.
 *
 * A queue names no chart, so nothing about the request looks like a chart read
 * - and that is exactly what made these invisible. Both list rows their crud
 * sibling already gates on the page, and both were answering with `patientId`
 * for charts whose own list is refused.
 */
describe('a work queue is not a way round the gate either', () => {
  const STATEMENT = testId(3_700);
  const DOSE = testId(3_710);

  function aStatement(dataset: Dataset): void {
    seed(dataset, 'Statement', {
      ...storageColumns(STATEMENT),
      patientId: PATIENT,
      status: 'SENT',
      balanceCents: 42_100,
      dunningCycle: 1,
      lastNoticeAt: FIXED_NOW,
      holdUntil: null,
      holdReason: null,
      closedReason: null,
      periodStart: null,
      periodEnd: null,
      generatedAt: FIXED_NOW,
      deliveredVia: null,
      deliveredAt: null,
      pdfStorageKey: null,
      payLinkToken: null,
      payLinkExpiresAt: null,
      paidAt: null,
    } as unknown as ScopedRow<'Statement'>);
  }

  function aPendingDose(dataset: Dataset): void {
    seed(dataset, 'Immunization', {
      ...storageColumns(DOSE),
      patientId: PATIENT,
      encounterId: null,
      status: 'COMPLETED',
      cvxCode: '208',
      mvxCode: null,
      ndcCode: null,
      display: 'COVID-19 vaccine',
      lotNumber: null,
      expirationDate: null,
      siteCode: null,
      routeCode: null,
      doseQuantity: null,
      doseUnit: null,
      administeredAt: FIXED_NOW,
      administeredById: null,
      visDate: null,
      refusalReasonCode: null,
      reportedToRegistryAt: null,
    } as unknown as ScopedRow<'Immunization'>);
  }

  it('refuses the collections worklist over a chart the reader may not open', async () => {
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    aStatement(dataset);

    const gated = await app.request('/bff/v0/statements', { headers: bearer(TOKENS.billerA) });
    const worklist = await app.request('/bff/v0/collections/worklist', {
      headers: bearer(TOKENS.billerA),
    });

    expect(gated.status, 'the crud list of the same rows was already right').toBe(404);
    expect(worklist.status).toBe(404);
  });

  it('refuses the queue when only its LAST chart is out of reach', async () => {
    /*
     * A one-row queue cannot tell "every chart on the page" from "the first
     * one", and the first one is the version somebody writes by accident. So
     * the reachable chart is generated a day earlier and the queue sorts
     * oldest-first: the row that must refuse is the one a first-only gate
     * never reaches.
     */
    const OTHER = testId(3_702);
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    seed(dataset, 'Patient', makePatientRow({ id: OTHER, mrn: 'OR-103702' }));
    anEncounter(dataset, { id: testId(3_703), patientId: OTHER });
    seed(dataset, 'Statement', {
      ...storageColumns(testId(3_704)),
      patientId: OTHER,
      status: 'SENT',
      balanceCents: 1_000,
      dunningCycle: 1,
      lastNoticeAt: FIXED_NOW,
      holdUntil: null,
      holdReason: null,
      closedReason: null,
      periodStart: null,
      periodEnd: null,
      generatedAt: new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000),
      deliveredVia: null,
      deliveredAt: null,
      pdfStorageKey: null,
      payLinkToken: null,
      payLinkExpiresAt: null,
      paidAt: null,
    } as unknown as ScopedRow<'Statement'>);
    aStatement(dataset);

    const worklist = await app.request('/bff/v0/collections/worklist', {
      headers: bearer(TOKENS.billerA),
    });

    expect(worklist.status).toBe(404);
  });

  it('still serves the worklist once the reader may open the chart', async () => {
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    anEncounter(dataset, { id: testId(3_701) });
    aStatement(dataset);

    const worklist = await app.request('/bff/v0/collections/worklist', {
      headers: bearer(TOKENS.billerA),
    });

    expect(worklist.status).toBe(200);
  });

  it('refuses the registry queue over a chart the reader may not open', async () => {
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    aPendingDose(dataset);

    const pending = await app.request('/bff/v0/immunisations/registry/pending', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(pending.status).toBe(404);
  });

  it('still serves the registry queue once the reader may open the chart', async () => {
    const { app, dataset } = createTestApp();
    baseChart(dataset);
    anEncounter(dataset, { id: testId(3_711), providerId: SUBJECTS.clinicianA });
    aPendingDose(dataset);

    const pending = await app.request('/bff/v0/immunisations/registry/pending', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(pending.status).toBe(200);
  });
});

describe('break-glass is bounded, not merely recorded', () => {
  async function declare(
    app: ReturnType<typeof createTestApp>['app'],
    patientId: string,
    token: string = TOKENS.clinicianA
  ): Promise<Response> {
    return app.request(`/bff/v0/patients/${patientId}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Collapsed in reception.' }),
    });
  }

  it('is refused to a role that may read charts but may not decide which', async () => {
    /*
     * The critical one. Gating a privilege-granting route on the privilege it
     * grants makes it self-service: `read-only` holds every `.read` permission,
     * so it held `patient.read`, so it could grant itself every chart in the
     * tenant one request at a time. `patient.breakGlass` does not end in
     * `.read`, so the bundle does not pick it up.
     */
    const { app, dataset } = createTestApp();
    baseChart(dataset);

    const res = await declare(app, PATIENT, TOKENS.siteReaderA);

    expect(res.status).toBe(403);
  });

  it('is refused to a portal principal', async () => {
    /*
     * What refuses it is the permission, not the actor-type guard in the
     * handler: `patient-portal` does not hold `patient.breakGlass`, so
     * `requirePermission` answers 403 before the handler runs. Deleting the
     * actor-type check does not make this test fail, and that is stated rather
     * than glossed - the check is a backstop for a tenant that forks the roles
     * and grants the capability somewhere it does not belong, where the grant's
     * `userId` would otherwise take a Patient id into a foreign key to `User`.
     *
     * A portal user never needs break-glass in any case: `own-record` already
     * covers their one chart.
     */
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: DEMO_PORTAL_PATIENT, mrn: 'OR-103099' }));

    const res = await declare(app, DEMO_PORTAL_PATIENT, TOKENS.portalA);

    expect(res.status).toBe(403);
  });

  it('returns the grant already held rather than filing a second', async () => {
    /* Re-declaring is ordinary: the window is short and an emergency outlasts
       it. A row per attempt would bury the sweep this table exists to show. */
    const { app, dataset } = createTestApp();
    baseChart(dataset);

    const first = await declare(app, PATIENT);
    const second = await declare(app, PATIENT);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { id: string }).id).toBe(
      ((await first.json()) as { id: string }).id
    );
  });

  it('refuses once too many charts are held open at once', async () => {
    /*
     * The bound that makes this a control rather than a record. Without it an
     * account holding no write permission at all could take the whole practice,
     * one request at a time, and the audit trail would describe it afterwards.
     */
    const { app, dataset } = createTestApp();
    for (let index = 0; index < 12; index += 1) {
      seed(
        dataset,
        'Patient',
        makePatientRow({
          id: testId(3_100 + index),
          mrn: `OR-1032${String(index).padStart(2, '0')}`,
        })
      );
    }

    const statuses: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      statuses.push((await declare(app, testId(3_100 + index))).status);
    }

    expect(statuses.filter((status) => status === 201)).toHaveLength(10);
    expect(statuses.filter((status) => status === 403)).toHaveLength(2);
  });

  it('records a refused declaration, so a sweep of guessed ids leaves a trail', async () => {
    /* The response still distinguishes a real id from a fake one - a hit is a
       201. The record is what makes the sweep visible. */
    const { app, sink } = createTestApp();

    const res = await declare(app, testId(3_999));

    expect(res.status).toBe(404);
    expect(sink.writes().map((entry) => entry.event.action)).toContain('breakGlass.denied');
  });
});

describe('the audit trail answers the questions it was built to answer', () => {
  it('files chart access against the chart, not only against a target id', async () => {
    /* The per-patient disclosure report filters on `patientId`. An access that
       does not appear in it is one nobody investigating that chart can see. */
    const { app, dataset, sink } = createTestApp();
    baseChart(dataset);
    anEncounter(dataset, { id: testId(3_200), providerId: SUBJECTS.clinicianA });

    await app.request(`/bff/v0/patients/${PATIENT}`, { headers: bearer(TOKENS.clinicianA) });

    const access = sink.writes().find((entry) => entry.event.action === 'chart.access');
    expect(access?.event.patientId).toBe(PATIENT);
  });

  it('sets the breakglass flag the compliance query filters on', async () => {
    /*
     * `AuditEvent` carries a `breakglass` boolean and the audit search exposes
     * it, so "every emergency access this quarter" is one query. It returned
     * nothing while the distinction lived only in the action string, which is a
     * control legible to whoever already knows to grep for it.
     */
    const { app, dataset, sink } = createTestApp();
    baseChart(dataset);

    await app.request(`/bff/v0/patients/${PATIENT}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Collapsed in reception.' }),
    });
    await app.request(`/bff/v0/patients/${PATIENT}`, { headers: bearer(TOKENS.clinicianA) });

    const access = sink.writes().find((entry) => entry.event.action === 'chart.access.breakGlass');
    expect(access?.event.breakglass).toBe(true);
    expect(access?.event.patientId).toBe(PATIENT);
  });

  it('records the stated reason, which is the whole control', async () => {
    /*
     * The reason lives on a table with no read route, so without it on the
     * event the review surface could say that somebody broke glass and not why.
     * A reviewer looking at "emergency access, no reason given" has nothing to
     * act on.
     */
    const { app, dataset, sink } = createTestApp();
    baseChart(dataset);

    await app.request(`/bff/v0/patients/${PATIENT}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Collapsed in reception, no record at this site.' }),
    });

    const created = sink.writes().find((entry) => entry.event.action === 'breakGlass.created');
    expect(created?.event.metadata).toMatchObject({
      reason: 'Collapsed in reception, no record at this site.',
    });
  });

  it('names the patient on the declaration event too', async () => {
    /* "Who broke glass on this chart" is the question the
       `(tenantId, patientId, grantedAt)` index was added for, and the audit
       trail has to be able to answer it as well as the table. */
    const { app, dataset, sink } = createTestApp();
    baseChart(dataset);

    await app.request(`/bff/v0/patients/${PATIENT}/break-glass`, {
      method: 'POST',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Collapsed in reception.' }),
    });

    const created = sink.writes().find((entry) => entry.event.action === 'breakGlass.created');
    expect(created?.event.patientId).toBe(PATIENT);
  });
});

describe('a clinician on more than one care team', () => {
  it('opens either chart, not only the team they joined most recently', async () => {
    /*
     * The source listed the reader's memberships one page at a time and
     * compared in memory, so it saw only their newest. A clinician added to a
     * second patient's team stopped being able to open the first one's chart,
     * and where another source happened to cover it the audit trail recorded
     * the wrong reason.
     */
    const { app, dataset } = createTestApp();
    const other = testId(3_301);
    baseChart(dataset);
    seed(dataset, 'Patient', makePatientRow({ id: other, mrn: 'OR-103301' }));

    for (const [index, patientId] of [PATIENT, other].entries()) {
      aTeamWithMember(dataset, {
        teamId: testId(3_310 + index),
        memberId: testId(3_320 + index),
        patientId,
      });
    }

    for (const patientId of [PATIENT, other]) {
      const res = await app.request(`/bff/v0/patients/${patientId}`, {
        headers: bearer(TOKENS.clinicianA),
      });
      expect(res.status, `chart ${patientId}`).toBe(200);
    }
  });

  it('does not open a chart they are on no team for', async () => {
    /*
     * The other half, and the one that says the fix is a narrowing rather than
     * a widening. Filtering the membership query by patient is what makes this
     * a 404; asking only "is this reader on any care team at all" would answer
     * 200 and pass the case above, so without this the fix could be deleted and
     * nothing would fail.
     */
    const { app, dataset } = createTestApp();
    const stranger = testId(3_302);
    baseChart(dataset);
    seed(dataset, 'Patient', makePatientRow({ id: stranger, mrn: 'OR-103302' }));

    aTeamWithMember(dataset, { teamId: testId(3_330), memberId: testId(3_331) });

    const own = await app.request(`/bff/v0/patients/${PATIENT}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const theirs = await app.request(`/bff/v0/patients/${stranger}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(own.status).toBe(200);
    expect(theirs.status).toBe(404);
  });
});

describe('the roles that are not at the bedside', () => {
  /*
   * The gate covers every resource that names a chart, and the question that
   * raises is whether the people who legitimately work those charts without
   * meeting the patient still can. A biller is the sharpest case: they open a
   * claim from an accounts-receivable queue, they are named on nothing, and
   * "break glass" is the wrong answer for a daily job.
   */

  const BILLED = testId(3_400);

  function billedChart(dataset: Dataset): void {
    seed(dataset, 'Patient', makePatientRow({ id: BILLED, mrn: 'OR-103400' }));
    anEncounter(dataset, { id: testId(3_401), patientId: BILLED, providerId: testId(3_402) });
  }

  it('lets a biller open a claim for a chart they are named on nowhere', async () => {
    /*
     * Works because of `facility-activity` rather than because billing has a
     * source of its own, and that is worth stating: `ChargeItem.encounterId` is
     * NOT NULL, so a patient with anything to bill necessarily has an encounter,
     * and the biller's facility grant is what makes that encounter visible. A
     * biller granted no facility at all would still be refused - correctly, and
     * that is what `facility.all` is for.
     */
    const { app, dataset } = createTestApp();
    billedChart(dataset);
    aClaim(dataset, testId(3_410), BILLED, testId(3_401));

    const res = await app.request(`/fhir/Claim/${testId(3_410)}`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
  });

  it('refuses the same claim to a biller with no grant for that site', async () => {
    /* The other half. If this were 200 the facility narrowing would not be
       doing anything and the source would authorise every claim in the tenant. */
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: BILLED, mrn: 'OR-103400' }));
    anEncounter(dataset, {
      id: testId(3_401),
      facilityId: DEMO_FACILITY_B,
      patientId: BILLED,
      providerId: testId(3_402),
    });
    aClaim(dataset, testId(3_410), BILLED, testId(3_401));

    const res = await app.request(`/fhir/Claim/${testId(3_410)}`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(404);
  });
});

/**
 * The task source, exercised the way it would actually be attacked.
 *
 * The cases above seed rows straight into the store, which is the right shape
 * for asking what the policy does with a row and the wrong one for asking
 * whether a caller can produce that row. These go through the write routes,
 * because the whole finding was that a task is evidence a reader can write for
 * themselves: every role that can read a chart can also write a task, and a
 * task names its own patient and its own assignee.
 */
describe('a task is evidence only when somebody else produced it', () => {
  const CHART = testId(3_500);

  function aChartNobodyIsInvolvedWith(dataset: Dataset): void {
    seed(dataset, 'Patient', makePatientRow({ id: CHART, mrn: 'OR-103500' }));
  }

  async function fileTask(
    app: ReturnType<typeof createTestApp>['app'],
    token: string,
    assigneeUserId: string
  ): Promise<string> {
    const res = await app.request('/bff/v0/tasks', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'RESULT',
        title: 'Sign the lab result',
        patientId: CHART,
        assigneeType: 'USER',
        assigneeUserId,
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  const chart = (patientId: string): string => `/bff/v0/patients/${patientId}`;

  it('refuses the chart to the reader who filed the task themselves', async () => {
    /*
     * The reported escalation, end to end. The biller role holds `task.write`
     * and `patient.read` and nothing else it would need: without provenance it
     * could file a task naming any patient id it could guess, put itself in
     * `assigneeUserId`, and read the chart - no reason recorded, no expiry, no
     * ceiling, none of the things break-glass exists to impose.
     */
    const { app, dataset } = createTestApp();
    aChartNobodyIsInvolvedWith(dataset);

    await fileTask(app, TOKENS.billerA, SUBJECTS.billerA);
    const res = await app.request(chart(CHART), { headers: bearer(TOKENS.billerA) });

    expect(res.status).toBe(404);
  });

  it('opens the chart once a colleague hands the task over', async () => {
    /* And the other half, because a rule that refused this would refuse the
       inbox: a result sent to somebody to sign is exactly the case the source
       is in the list for. */
    const { app, dataset } = createTestApp();
    aChartNobodyIsInvolvedWith(dataset);

    await fileTask(app, TOKENS.clinicianA, SUBJECTS.billerA);
    const res = await app.request(chart(CHART), { headers: bearer(TOKENS.billerA) });

    expect(res.status).toBe(200);
  });

  it('refuses even the reassignment to a reader with no relationship to the chart', async () => {
    /*
     * The chart gate now stops the walk-round at the PATCH itself. Reassigning a
     * task about a chart you are not on is a chart amendment, refused the same
     * way the read is, so the attack never reaches the point where the
     * provenance stamp would decide it.
     */
    const { app, dataset } = createTestApp();
    aChartNobodyIsInvolvedWith(dataset);
    const id = await fileTask(app, TOKENS.clinicianA, SUBJECTS.frontDeskA);

    const moved = await app.request(`/bff/v0/tasks/${id}`, {
      method: 'PATCH',
      headers: { ...bearer(TOKENS.billerA), 'content-type': 'application/json' },
      body: JSON.stringify({ assigneeType: 'USER', assigneeUserId: SUBJECTS.billerA }),
    });
    expect(moved.status).toBe(404);
    const res = await app.request(chart(CHART), { headers: bearer(TOKENS.billerA) });
    expect(res.status).toBe(404);
  });

  it('reassigning a delegated task to yourself stops it authorising the chart', async () => {
    /*
     * The case the stamp exists for, now that the gate lets a reassignment
     * through only when the reader already has a relationship. billerA is handed
     * a task about the chart by clinicianA, which authorises billerA through
     * `assigned-task` - somebody else produced the row. billerA then reassigns
     * it to themselves. The stamp rewrites who handed it out, so the task is now
     * theirs-assigned-by-themselves and is no longer evidence: the very read
     * that worked a moment ago is refused. Stamping only on create would leave
     * `assignedById` as clinicianA and keep the chart open forever on the
     * strength of a delegation the reader has since erased.
     */
    const { app, dataset } = createTestApp();
    aChartNobodyIsInvolvedWith(dataset);
    const id = await fileTask(app, TOKENS.clinicianA, SUBJECTS.billerA);

    // Authorised by the delegated task while clinicianA is still its assigner.
    expect((await app.request(chart(CHART), { headers: bearer(TOKENS.billerA) })).status).toBe(200);

    const moved = await app.request(`/bff/v0/tasks/${id}`, {
      method: 'PATCH',
      headers: { ...bearer(TOKENS.billerA), 'content-type': 'application/json' },
      body: JSON.stringify({ assigneeType: 'USER', assigneeUserId: SUBJECTS.billerA }),
    });
    expect(moved.status).toBe(200);

    // Now theirs-assigned-by-themselves: the task no longer counts, and nothing
    // else connects billerA to this chart.
    expect((await app.request(chart(CHART), { headers: bearer(TOKENS.billerA) })).status).toBe(404);
  });

  it('refuses an assigner named in the request body', async () => {
    /*
     * The column is server-owned, and a body key that reached it would undo
     * every case above in one line. Two things stop it and this asserts the
     * outer one: the create schema does not have the key, so the request is
     * rejected rather than quietly stripped. If that schema is ever relaxed to
     * strip unknown keys instead, the stamp is still last in the spread and
     * still wins, and the second half of this test is what would notice.
     */
    const { app, dataset } = createTestApp();
    aChartNobodyIsInvolvedWith(dataset);

    const res = await app.request('/bff/v0/tasks', {
      method: 'POST',
      headers: { ...bearer(TOKENS.billerA), 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'RESULT',
        title: 'Sign the lab result',
        patientId: CHART,
        assigneeType: 'USER',
        assigneeUserId: SUBJECTS.billerA,
        assignedById: SUBJECTS.clinicianA,
      }),
    });
    expect(res.status).toBe(422);

    expect((await app.request(chart(CHART), { headers: bearer(TOKENS.billerA) })).status).toBe(404);
  });
});

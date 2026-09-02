import { describe, expect, it } from 'vitest';

import { RELATIONSHIP_SOURCES } from '../policy/care-relationship.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
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

const GRANTED: readonly { readonly why: string; readonly seedIt: Seeder }[] = [
  {
    why: 'the clinician saw them',
    seedIt: (dataset) => {
      seed(dataset, 'Encounter', {
        ...storageColumns(testId(3_010)),
        facilityId: DEMO_FACILITY_A,
        patientId: PATIENT,
        providerId: SUBJECTS.clinicianA,
        appointmentId: null,
        class: 'AMBULATORY',
        status: 'COMPLETED',
        reasonCode: 'R51',
        reasonText: 'Headache',
        startedAt: FIXED_NOW,
        endedAt: null,
        signedAt: null,
        signedById: null,
      });
    },
  },
  {
    why: 'the clinician is due to see them',
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
    seedIt: (dataset) => {
      seed(dataset, 'CareTeam', {
        ...storageColumns(CARE_TEAM),
        patientId: PATIENT,
        status: 'ACTIVE',
        name: null,
        periodStart: null,
        periodEnd: null,
      });
      seed(dataset, 'CareTeamParticipant', {
        ...storageColumns(testId(3_012)),
        careTeamId: CARE_TEAM,
        patientId: PATIENT,
        memberType: 'USER',
        memberUserId: SUBJECTS.clinicianA,
        memberRelatedPersonId: null,
        roleCode: '207Q00000X',
        roleSystem: 'http://nucc.org/provider-taxonomy',
        roleText: null,
        periodStart: null,
        periodEnd: null,
      });
    },
  },
  {
    why: 'they took break-glass and it has not expired',
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
    why: 'somebody else is due to see them at a site the clinician works at',
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
    why: 'somebody else saw them at a site the clinician works at',
    seedIt: (dataset) => {
      /* The receptionist and the covering nurse. Neither is named on anything,
         and both legitimately open the chart. */
      seed(dataset, 'Encounter', {
        ...storageColumns(testId(3_013)),
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
      });
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
      seed(dataset, 'Encounter', {
        ...storageColumns(testId(3_020)),
        facilityId: DEMO_FACILITY_B,
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
     * pass without noticing. `own-record` is the exception and is covered by
     * the portal compartment tests, because a staff token cannot exercise it.
     */
    /*
     * `GRANTED` has one more case than there are sources, because
     * `facility-activity` has two halves - an encounter and an appointment -
     * and each needs its own. `own-record` has none here and is counted
     * separately: a staff token cannot exercise it, and the portal compartment
     * tests are where it lives.
     */
    const asserted = GRANTED.length + 1 - 1;

    expect(
      asserted,
      'a relationship source has no case: adding one is adding a way into a chart'
    ).toBe(RELATIONSHIP_SOURCES.length);
  });
});

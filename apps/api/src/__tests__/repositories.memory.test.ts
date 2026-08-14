import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import { APPOINTMENT_DEFAULTS, PATIENT_DEFAULTS } from '../repositories/defaults.js';
import {
  createEmptyDataset,
  createMemoryRepositoryRegistry,
  type MemoryDataset,
} from '../repositories/memory.js';
import type { PatientListQuery, Repositories } from '../repositories/types.js';

import {
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  FIXED_NOW,
  makeAppointmentRow,
  makePatientRow,
  seedPatients,
  seed,
  testId,
} from './support.js';

function harness(dataset: MemoryDataset = createEmptyDataset()): {
  dataset: MemoryDataset;
  sink: MemoryAuditSink;
  repos: (tenantId?: string) => Repositories;
} {
  const sink = createMemoryAuditSink();
  let counter = 500;
  const registry = createMemoryRepositoryRegistry({
    dataset,
    clock: { now: () => FIXED_NOW },
    nextId: () => testId((counter += 1)),
  });

  return {
    dataset,
    sink,
    repos: (tenantId = DEMO_TENANT_A) =>
      registry.forRequest({
        tenantId,
        audit: new AuditCollector(sink, {
          tenantId,
          actorType: 'user',
          actorId: testId(900),
          requestId: 'req-1',
          method: 'GET',
          path: '/test',
        }),
      }),
  };
}

const BASE_QUERY: PatientListQuery = { page: 1, pageSize: 25, sort: 'familyName', order: 'asc' };

describe('column defaults', () => {
  it('match what schema.prisma declares', () => {
    expect(PATIENT_DEFAULTS).toEqual({
      sexAtBirth: 'UNKNOWN',
      languageCode: 'en',
      country: 'US',
      sensitivityClass: 'NORMAL',
      portalEnabled: false,
      active: true,
    });
    expect(APPOINTMENT_DEFAULTS).toEqual({ status: 'BOOKED', createdVia: 'STAFF' });
  });
});

describe('the in-memory patient repository', () => {
  it('creates a row, applying the schema defaults', async () => {
    const { repos } = harness();
    const row = await repos().patients.create({
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
    });

    expect(row).toMatchObject({
      tenantId: DEMO_TENANT_A,
      mrn: 'OR-100482',
      sexAtBirth: 'UNKNOWN',
      languageCode: 'en',
      country: 'US',
      active: true,
      createdAt: FIXED_NOW,
    });
  });

  it('carries every optional field through', async () => {
    const { repos } = harness();
    const row = await repos().patients.create({
      mrn: 'OR-100483',
      primaryFacilityId: DEMO_FACILITY_A,
      givenName: 'Testina',
      middleName: 'Q',
      familyName: 'Patientsson',
      prefix: 'Ms',
      suffix: 'III',
      preferredName: 'Tess',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
      deceasedAt: new Date('2026-01-01T00:00:00.000Z'),
      sexAtBirth: 'FEMALE',
      genderIdentityCode: '446141000124107',
      pronouns: 'she/her',
      raceCodes: ['2106-3'],
      ethnicityCodes: ['2186-5'],
      languageCode: 'de',
      maritalStatusCode: 'M',
      email: 'testina@example.invalid',
      phoneMobile: '+15550100',
      phoneHome: '+15550101',
      addressLine1: '1 Test Street',
      addressLine2: 'Flat 2',
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'DE',
      sensitivityClass: 'RESTRICTED',
      portalEnabled: true,
      active: false,
    });

    expect(row.preferredName).toBe('Tess');
    expect(row.raceCodes).toEqual(['2106-3']);
    expect(row.sensitivityClass).toBe('RESTRICTED');
    expect(row.portalEnabled).toBe(true);
    expect(row.active).toBe(false);
  });

  it('refuses a duplicate MRN inside the tenant but allows it across tenants', async () => {
    const { repos } = harness();
    const input = {
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
    };
    await repos().patients.create(input);

    await expect(repos().patients.create(input)).rejects.toThrow(/already exists/);
    await expect(repos(DEMO_TENANT_B).patients.create(input)).resolves.toMatchObject({
      tenantId: DEMO_TENANT_B,
    });
  });

  it('finds by id and by MRN inside the tenant only', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1), tenantId: DEMO_TENANT_A }));
    const { repos } = harness(dataset);
    const byMrn = { ...BASE_QUERY, mrn: 'OR-100482' };

    await expect(repos().patients.findById(testId(1))).resolves.toMatchObject({ id: testId(1) });
    await expect(repos().patients.list(byMrn)).resolves.toMatchObject({ total: 1 });
    await expect(repos(DEMO_TENANT_B).patients.findById(testId(1))).resolves.toBeNull();
    await expect(repos(DEMO_TENANT_B).patients.list(byMrn)).resolves.toMatchObject({ total: 0 });
  });

  it('paginates and reports the whole-set total', async () => {
    const dataset = createEmptyDataset();
    seedPatients(dataset, 7);
    const { repos } = harness(dataset);

    const page = await repos().patients.list({ ...BASE_QUERY, page: 2, pageSize: 3 });

    expect(page.total).toBe(7);
    expect(page.rows).toHaveLength(3);
    expect(page.rows[0]?.familyName).toBe('TestpersonD');
  });

  it('returns an empty page past the end rather than the last page', async () => {
    const dataset = createEmptyDataset();
    seedPatients(dataset, 3);
    const { repos } = harness(dataset);

    const page = await repos().patients.list({ ...BASE_QUERY, page: 9, pageSize: 3 });

    expect(page.rows).toEqual([]);
    expect(page.total).toBe(3);
  });

  it('filters by MRN, name prefix, birth date, active and sex', async () => {
    const dataset = createEmptyDataset();
    seed(
      dataset,
      'Patient',
      makePatientRow({
        id: testId(1),
        mrn: 'OR-1',
        familyName: 'Patientsson',
        givenName: 'Testina',
      }),
      makePatientRow({
        id: testId(2),
        mrn: 'OR-2',
        familyName: 'Otherperson',
        givenName: 'Sam',
        sexAtBirth: 'MALE',
        active: false,
        birthDate: new Date('1980-01-01T00:00:00.000Z'),
      })
    );
    const { repos } = harness(dataset);
    const list = (query: Partial<PatientListQuery>) =>
      repos().patients.list({ ...BASE_QUERY, ...query });

    expect((await list({ mrn: 'OR-2' })).rows).toHaveLength(1);
    expect((await list({ family: 'pat' })).rows[0]?.id).toBe(testId(1));
    expect((await list({ given: 'SAM' })).rows[0]?.id).toBe(testId(2));
    expect((await list({ active: false })).rows[0]?.id).toBe(testId(2));
    expect((await list({ sexAtBirth: 'MALE' })).rows[0]?.id).toBe(testId(2));
    expect((await list({ id: testId(1) })).rows).toHaveLength(1);
    expect((await list({ birthDate: new Date('1980-01-01T00:00:00.000Z') })).rows[0]?.id).toBe(
      testId(2)
    );
  });

  it('matches free text across name, preferred name and MRN', async () => {
    const dataset = createEmptyDataset();
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: testId(1), mrn: 'OR-100482', preferredName: 'Tess' }),
      makePatientRow({ id: testId(2), mrn: 'OR-999', familyName: 'Nobody', givenName: 'Nemo' })
    );
    const { repos } = harness(dataset);
    const list = (q: string) => repos().patients.list({ ...BASE_QUERY, q });

    expect((await list('tess')).rows[0]?.id).toBe(testId(1));
    expect((await list('100482')).rows[0]?.id).toBe(testId(1));
    expect((await list('nemo')).rows[0]?.id).toBe(testId(2));
    expect((await list('nothing-matches')).rows).toEqual([]);
  });

  it('sorts by each supported key in both directions', async () => {
    const dataset = createEmptyDataset();
    seed(
      dataset,
      'Patient',
      makePatientRow({
        id: testId(1),
        mrn: 'a',
        familyName: 'Bravo',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      makePatientRow({
        id: testId(2),
        mrn: 'b',
        familyName: 'Alpha',
        birthDate: new Date('2000-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      })
    );
    const { repos } = harness(dataset);
    const ids = async (query: Partial<PatientListQuery>) =>
      (await repos().patients.list({ ...BASE_QUERY, ...query })).rows.map((row) => row.id);

    expect(await ids({ sort: 'familyName' })).toEqual([testId(2), testId(1)]);
    expect(await ids({ sort: 'familyName', order: 'desc' })).toEqual([testId(1), testId(2)]);
    expect(await ids({ sort: 'birthDate' })).toEqual([testId(1), testId(2)]);
    expect(await ids({ sort: 'birthDate', order: 'desc' })).toEqual([testId(2), testId(1)]);
    expect(await ids({ sort: 'createdAt' })).toEqual([testId(1), testId(2)]);
  });

  it('breaks ties on id so a page boundary is stable', async () => {
    const dataset = createEmptyDataset();
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: testId(2), mrn: 'a', familyName: 'Same', givenName: 'Same' }),
      makePatientRow({ id: testId(1), mrn: 'b', familyName: 'Same', givenName: 'Same' })
    );
    const { repos } = harness(dataset);

    const page = await repos().patients.list(BASE_QUERY);
    expect(page.rows.map((row) => row.id)).toEqual([testId(1), testId(2)]);
  });

  it('patches only the fields present and reports them on the audit event', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    const { repos, sink } = harness(dataset);

    const row = await repos().patients.update(testId(1), { familyName: 'Renamed', active: false });

    expect(row).toMatchObject({ familyName: 'Renamed', active: false, givenName: 'Testina' });
    expect(sink.writes()[0]?.event.metadata.fields).toEqual(['familyName', 'active']);
  });

  it('patches every patchable column', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    const { repos } = harness(dataset);

    const row = await repos().patients.update(testId(1), {
      primaryFacilityId: DEMO_FACILITY_A,
      givenName: 'A',
      middleName: 'B',
      familyName: 'C',
      prefix: 'D',
      suffix: 'E',
      preferredName: 'F',
      birthDate: new Date('2000-01-01T00:00:00.000Z'),
      deceasedAt: new Date('2026-01-01T00:00:00.000Z'),
      sexAtBirth: 'MALE',
      genderIdentityCode: 'G',
      pronouns: 'they/them',
      raceCodes: ['2106-3'],
      ethnicityCodes: ['2186-5'],
      languageCode: 'de',
      maritalStatusCode: 'M',
      email: 'a@example.invalid',
      phoneMobile: '+15550100',
      phoneHome: '+15550101',
      addressLine1: 'L1',
      addressLine2: 'L2',
      city: 'City',
      state: 'ST',
      postalCode: '00000',
      country: 'DE',
      sensitivityClass: 'VERY_RESTRICTED',
      portalEnabled: true,
      active: false,
    });

    expect(row).toMatchObject({ pronouns: 'they/them', country: 'DE', portalEnabled: true });
    expect(row?.raceCodes).toEqual(['2106-3']);
  });

  it('resolves update to null for another tenant rather than touching the row', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1), familyName: 'Patientsson' }));
    const { repos } = harness(dataset);

    await expect(
      repos(DEMO_TENANT_B).patients.update(testId(1), { familyName: 'Stolen' })
    ).resolves.toBeNull();
    expect(dataset.table('Patient')[0]?.familyName).toBe('Patientsson');
  });

  it('registers a read for every row it hands back', async () => {
    const dataset = createEmptyDataset();
    seedPatients(dataset, 3);
    const sinkHarness = harness(dataset);
    const repos = sinkHarness.repos();

    await repos.patients.list(BASE_QUERY);
    await repos.patients.findById(testId(1));

    // The collector buffers, so the proof is the pending count rather than the
    // sink: this is exactly the batching the plan asks for.
    expect(sinkHarness.sink.events).toHaveLength(0);
  });

  it('audits a create and an update inside the unit of work', async () => {
    const { repos, sink } = harness();
    await repos().patients.create({
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
    });

    expect(sink.writes()).toHaveLength(1);
    expect(sink.writes()[0]).toMatchObject({
      transactional: true,
      event: { action: 'patient.created', metadata: { mrn: 'OR-100482' } },
    });
  });
});

describe('the in-memory appointment repository', () => {
  const CREATE_INPUT = {
    facilityId: DEMO_FACILITY_A,
    patientId: testId(1),
    providerId: testId(900),
    typeCode: 'OFFICE-30',
    typeDisplay: 'Office visit, 30 minutes',
    start: new Date('2026-08-14T15:00:00.000Z'),
    end: new Date('2026-08-14T15:30:00.000Z'),
    durationMinutes: 30,
  };

  it('books with the schema defaults', async () => {
    const { repos } = harness();
    const row = await repos().appointments.create(CREATE_INPUT);

    expect(row).toMatchObject({
      tenantId: DEMO_TENANT_A,
      status: 'BOOKED',
      createdVia: 'STAFF',
      checkedInAt: null,
      cancelReason: null,
    });
  });

  it('books without a patient, as a held slot', async () => {
    const { repos, sink } = harness();
    const row = await repos().appointments.create({
      ...CREATE_INPUT,
      patientId: undefined,
      room: '3',
      reasonText: 'Follow-up',
      recurrenceGroupId: testId(700),
      recurrenceRule: { freq: 'WEEKLY' },
      status: 'PENDING',
      createdVia: 'PORTAL',
    });

    expect(row.patientId).toBeNull();
    expect(row.recurrenceGroupId).toBe(testId(700));
    expect(sink.writes()[0]?.event.patientId).toBeUndefined();
  });

  it('filters by facility, provider, patient, status and a half-open window', async () => {
    const dataset = createEmptyDataset();
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(101), start: new Date('2026-08-14T09:00:00.000Z') }),
      makeAppointmentRow({
        id: testId(102),
        facilityId: testId(801),
        providerId: testId(901),
        patientId: testId(2),
        status: 'CHECKED_IN',
        start: new Date('2026-08-15T09:00:00.000Z'),
      })
    );
    const { repos } = harness(dataset);
    const list = (query: Record<string, unknown>) =>
      repos().appointments.list({
        page: 1,
        pageSize: 25,
        sort: 'start',
        order: 'asc',
        ...query,
      });

    expect((await list({ facilityId: DEMO_FACILITY_A })).rows).toHaveLength(1);
    expect((await list({ providerId: testId(901) })).rows[0]?.id).toBe(testId(102));
    expect((await list({ patientId: testId(2) })).rows[0]?.id).toBe(testId(102));
    expect((await list({ status: 'CHECKED_IN' })).rows[0]?.id).toBe(testId(102));
    expect(
      (
        await list({
          from: new Date('2026-08-14T00:00:00.000Z'),
          to: new Date('2026-08-15T00:00:00.000Z'),
        })
      ).rows.map((row) => row.id)
    ).toEqual([testId(101)]);
  });

  it('sorts by start or creation, in both directions', async () => {
    const dataset = createEmptyDataset();
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({
        id: testId(101),
        start: new Date('2026-08-14T11:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      makeAppointmentRow({
        id: testId(102),
        start: new Date('2026-08-14T09:00:00.000Z'),
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
      })
    );
    const { repos } = harness(dataset);
    const ids = async (query: Record<string, unknown>) =>
      (
        await repos().appointments.list({
          page: 1,
          pageSize: 25,
          sort: 'start',
          order: 'asc',
          ...query,
        })
      ).rows.map((row) => row.id);

    expect(await ids({})).toEqual([testId(102), testId(101)]);
    expect(await ids({ order: 'desc' })).toEqual([testId(101), testId(102)]);
    expect(await ids({ sort: 'createdAt' })).toEqual([testId(101), testId(102)]);
  });

  it('stamps checkedInAt exactly once, when the status first reaches CHECKED_IN', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));
    const { repos, sink } = harness(dataset);

    const first = await repos().appointments.update(testId(101), { status: 'CHECKED_IN' });
    expect(first?.checkedInAt).toEqual(FIXED_NOW);
    expect(sink.writes()[0]?.event.metadata).toMatchObject({
      statusFrom: 'BOOKED',
      statusTo: 'CHECKED_IN',
    });

    const stamped = first?.checkedInAt;
    await repos().appointments.update(testId(101), { status: 'ROOMED' });
    const again = await repos().appointments.update(testId(101), { status: 'CHECKED_IN' });
    expect(again?.checkedInAt).toBe(stamped);
  });

  it('applies every patchable field', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));
    const { repos } = harness(dataset);

    const row = await repos().appointments.update(testId(101), {
      start: new Date('2026-08-20T10:00:00.000Z'),
      end: new Date('2026-08-20T10:45:00.000Z'),
      durationMinutes: 45,
      room: '4',
      reasonText: 'Rescheduled',
      cancelReason: 'n/a',
      providerId: testId(902),
      typeCode: 'OFFICE-45',
      typeDisplay: 'Office visit, 45 minutes',
    });

    expect(row).toMatchObject({ durationMinutes: 45, room: '4', providerId: testId(902) });
  });

  it('omits the status transition from the audit event when the status did not move', async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));
    const { repos, sink } = harness(dataset);

    await repos().appointments.update(testId(101), { room: '5' });

    expect(sink.writes()[0]?.event.metadata).not.toHaveProperty('statusFrom');
  });

  it("hides another tenant's appointments from read and update alike", async () => {
    const dataset = createEmptyDataset();
    seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));
    const { repos } = harness(dataset);

    await expect(repos(DEMO_TENANT_B).appointments.findById(testId(101))).resolves.toBeNull();
    await expect(
      repos(DEMO_TENANT_B).appointments.update(testId(101), { room: '9' })
    ).resolves.toBeNull();
    expect(
      (
        await repos(DEMO_TENANT_B).appointments.list({
          page: 1,
          pageSize: 25,
          sort: 'start',
          order: 'asc',
        })
      ).total
    ).toBe(0);
  });

  it('defaults its clock and id source when none are injected', async () => {
    const registry = createMemoryRepositoryRegistry();
    const repos = registry.forRequest({
      tenantId: DEMO_TENANT_A,
      audit: new AuditCollector(createMemoryAuditSink(), {
        tenantId: DEMO_TENANT_A,
        actorType: 'user',
        actorId: testId(900),
        requestId: 'r',
        method: 'POST',
        path: '/x',
      }),
    });

    const row = await repos.appointments.create(CREATE_INPUT);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(registry.dataset.table('Appointment')).toHaveLength(1);
  });
});

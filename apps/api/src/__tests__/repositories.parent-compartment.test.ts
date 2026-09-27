import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import { createEmptyDataset, createMemoryRepositoryRegistry } from '../repositories/memory.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { ScopedRow } from '../repositories/rows.js';
import type { Repositories } from '../repositories/types.js';

import { createFakePort } from './fake-port.js';
import {
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  FIXED_NOW,
  makeAppointmentRow,
  storageColumns,
  testId,
} from './support.js';

/**
 * A telehealth visit has no patient column; its chart is its appointment's.
 * Both storage ports must follow that appointment to the same answer, so every
 * case here runs against each of them over the same rows.
 */

const PATIENT_A = testId(1);
const PATIENT_B = testId(2);
const APPOINTMENT_A = testId(101);
const APPOINTMENT_B = testId(102);
/** An appointment that exists only in the other organisation, naming patient A. */
const APPOINTMENT_ELSEWHERE = testId(103);
const VISIT_A = testId(701);
const VISIT_B = testId(702);
const VISIT_ELSEWHERE = testId(703);

function visit(id: string, appointmentId: string): ScopedRow<'TelehealthVisit'> {
  return {
    ...storageColumns(id),
    appointmentId,
    vendorId: 'demo-vendor',
    roomRef: `room-${id}`,
    joinUrl: `https://video.example.test/${id}`,
    status: 'OPEN',
    scheduledStart: new Date('2026-08-14T15:00:00.000Z'),
    expiresAt: new Date('2026-08-14T16:00:00.000Z'),
    endedAt: null,
    endedReason: null,
    durationSeconds: null,
  };
}

type Ports = 'memory' | 'prisma';

function harness(
  port: Ports
): (compartmentPatientId?: string, audit?: AuditCollector) => Repositories {
  const dataset = createEmptyDataset();
  dataset.table('Appointment').push(
    makeAppointmentRow({ id: APPOINTMENT_A, patientId: PATIENT_A }),
    makeAppointmentRow({ id: APPOINTMENT_B, patientId: PATIENT_B }),
    makeAppointmentRow({
      id: APPOINTMENT_ELSEWHERE,
      patientId: PATIENT_A,
      tenantId: DEMO_TENANT_B,
    })
  );
  dataset
    .table('TelehealthVisit')
    .push(
      visit(VISIT_A, APPOINTMENT_A),
      visit(VISIT_B, APPOINTMENT_B),
      visit(VISIT_ELSEWHERE, APPOINTMENT_ELSEWHERE)
    );

  let counter = 800;
  const nextId = (): string => testId((counter += 1));
  const registry =
    port === 'memory'
      ? createMemoryRepositoryRegistry({ dataset, clock: { now: () => FIXED_NOW }, nextId })
      : createPrismaRepositoryRegistry((tenantId) =>
          createFakePort({ dataset, tenantId, now: () => FIXED_NOW, nextId })
        );
  return (compartmentPatientId, audit = collector(createMemoryAuditSink())) =>
    registry.forRequest({
      tenantId: DEMO_TENANT_A,
      ...(compartmentPatientId === undefined ? {} : { compartmentPatientId }),
      audit,
    });
}

function collector(sink: MemoryAuditSink): AuditCollector {
  return new AuditCollector(sink, {
    tenantId: DEMO_TENANT_A,
    actorType: 'user',
    actorId: testId(900),
    requestId: 'req-1',
    method: 'GET',
    path: '/test',
  });
}

const LIST = { page: 1, pageSize: 25, sort: 'scheduledStart', order: 'asc' } as const;

describe.each<Ports>(['memory', 'prisma'])(
  'a visit reached through its appointment (%s)',
  (port) => {
    it('lists only the visit on the caller’s own appointment', async () => {
      const page = await harness(port)(PATIENT_A).telehealthVisits.list(LIST);

      expect(page.rows.map((row) => row.id)).toEqual([VISIT_A]);
      expect(page.total).toBe(1);
    });

    it('reads another chart’s visit as absent, singly and by set', async () => {
      const visits = harness(port)(PATIENT_A).telehealthVisits;

      await expect(visits.findById(VISIT_A)).resolves.toMatchObject({ id: VISIT_A });
      await expect(visits.findById(VISIT_B)).resolves.toBeNull();
      const both = await visits.findByIds([VISIT_A, VISIT_B, VISIT_ELSEWHERE]);
      expect(both.map((row) => row.id)).toEqual([VISIT_A]);
    });

    it('does not follow a key to an appointment in another organisation', async () => {
      const visits = harness(port)(PATIENT_A).telehealthVisits;

      // The visit row is in this tenant and its appointment names patient A, but
      // that appointment is another organisation's, so it decides nothing here.
      await expect(visits.findById(VISIT_ELSEWHERE)).resolves.toBeNull();
    });

    it('cannot amend another chart’s visit', async () => {
      const visits = harness(port)(PATIENT_A).telehealthVisits;

      await expect(visits.update(VISIT_B, { status: 'ENDED' })).resolves.toBeNull();
    });

    it('refuses a create on another chart’s appointment and allows one on its own', async () => {
      const repos = harness(port);
      const input = {
        vendorId: 'demo-vendor',
        roomRef: 'room-new',
        joinUrl: 'https://video.example.test/new',
        scheduledStart: new Date('2026-08-15T15:00:00.000Z'),
        expiresAt: new Date('2026-08-15T16:00:00.000Z'),
      };

      await expect(
        repos(PATIENT_A).telehealthVisits.create({ ...input, appointmentId: APPOINTMENT_B })
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        repos(PATIENT_B).telehealthVisits.create({ ...input, appointmentId: APPOINTMENT_B })
      ).resolves.toMatchObject({ appointmentId: APPOINTMENT_B });
    });

    it('attributes a visit it reads and writes to the caller’s patient', async () => {
      const sink = createMemoryAuditSink();
      const audit = collector(sink);
      const visits = harness(port)(PATIENT_A, audit).telehealthVisits;

      await visits.findById(VISIT_A);
      await visits.update(VISIT_A, { status: 'ENDED' });
      await audit.flush();

      // The visit has no patient column, so without the compartment standing in
      // for it the patient access report would never list this disclosure.
      const read = sink.events.find((entry) => entry.event.action === 'phi.read');
      expect(read?.event.patientId).toBe(PATIENT_A);
      const write = sink.events.find((entry) => entry.event.action === 'appointment.updated');
      expect(write?.event.patientId).toBe(PATIENT_A);
    });

    it('refuses a create whose appointment key is shaped like a filter', async () => {
      // A value that is not an id must be compared as a value. Read as filter
      // operators, `{ not: '' }` would match the caller's own appointment and
      // the ownership check would pass for a visit bound to no appointment.
      await expect(
        harness(port)(PATIENT_A).telehealthVisits.create({
          appointmentId: { not: '' } as unknown as string,
          vendorId: 'demo-vendor',
          roomRef: 'room-shaped',
          joinUrl: 'https://video.example.test/shaped',
          scheduledStart: new Date('2026-08-15T15:00:00.000Z'),
          expiresAt: new Date('2026-08-15T16:00:00.000Z'),
        })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('leaves a caller with no compartment the whole organisation', async () => {
      const page = await harness(port)().telehealthVisits.list(LIST);

      expect(page.rows.map((row) => row.id).sort()).toEqual([VISIT_A, VISIT_B, VISIT_ELSEWHERE]);
    });
  }
);

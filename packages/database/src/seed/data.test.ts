import { describe, expect, it } from 'vitest';

import { verifyAuditChain } from '../audit.js';
import { isUuidv7 } from '../uuid.js';
import { buildDemoPractice } from './data.js';

const practice = buildDemoPractice();

describe('buildDemoPractice', () => {
  it('is deterministic: two builds produce identical rows', () => {
    expect(buildDemoPractice()).toStrictEqual(buildDemoPractice());
  });

  it('builds the practice the scope calls for', () => {
    expect(practice.facilities).toHaveLength(2);
    expect(practice.users.filter((user) => user.isProvider)).toHaveLength(3);
    expect(practice.patients).toHaveLength(20);
  });

  it('includes the named demo identities', () => {
    expect(practice.patients[0]).toMatchObject({
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
    });
    expect(practice.users.map((user) => user.familyName)).toContain('Okafor');
  });

  it('gives every row a UUIDv7 primary key', () => {
    const ids = Object.values(practice)
      .flatMap((rows) => (Array.isArray(rows) ? rows : [rows]))
      .map((row) => String(row.id));
    expect(ids.every(isUuidv7)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stamps every row with the organisation as its tenant', () => {
    const organisationId = practice.organisation.id;
    const tenants = Object.entries(practice)
      .filter(([key]) => key !== 'organisation')
      .flatMap(([, rows]) => (Array.isArray(rows) ? rows : []))
      .map((row) => (row as { tenantId?: string }).tenantId);
    expect(new Set(tenants)).toStrictEqual(new Set([organisationId]));
  });

  it('populates every clinical surface the demo has to show', () => {
    expect(practice.encounters.length).toBeGreaterThan(0);
    expect(practice.conditions.length).toBeGreaterThan(0);
    expect(practice.medicationRequests.length).toBeGreaterThan(0);
    expect(practice.allergies.length).toBeGreaterThan(0);
    expect(practice.observations.length).toBeGreaterThan(0);
    expect(practice.serviceRequests.length).toBeGreaterThan(0);
    expect(practice.diagnosticReports.length).toBeGreaterThan(0);
    expect(practice.resultObservations.length).toBeGreaterThan(0);
    expect(practice.claims.length).toBeGreaterThan(0);
    expect(practice.payments.length).toBeGreaterThan(0);
    expect(practice.statements.length).toBeGreaterThan(0);
    expect(practice.formPromotedValues.length).toBeGreaterThan(0);
    // The pharmacy pillar. Omitted from this list until 2026-09-06, which is
    // why the seed shipped ten prescriptions and nothing to fill them from:
    // every inventory read answered 200 with an empty page.
    expect(practice.stockItems.length).toBeGreaterThan(0);
    expect(practice.stockLots.length).toBeGreaterThan(0);
    expect(practice.stockPostings.length).toBeGreaterThan(0);
    expect(practice.stockMovements.length).toBeGreaterThan(0);
  });

  it('gives the pharmacy pillar a ledger each of its reads can answer from', () => {
    // Not a count. Each assertion is a route that answers [] without it:
    // `/inventory/lots`, `/inventory/expiring`, `/inventory/reorder`, and the
    // dispense a prescription is filled by.
    const facilities = new Set(practice.stockLots.map((lot) => lot.facilityId));
    expect(facilities.size).toBeGreaterThan(1);

    // `/inventory/expiring` defaults to a 30-day window that STARTS at today, so
    // the lot has to be unexpired and inside it. Measured against the receipt
    // instead, this assertion passes over a lot that expired months ago and the
    // route still answers [].
    const today = new Date('2026-08-17T00:00:00.000Z');
    const windowEnd = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(
      practice.stockLots.some(
        (lot) => (lot.expiresOn as Date) > today && (lot.expiresOn as Date) <= windowEnd
      )
    ).toBe(true);

    const dispenses = practice.stockPostings.filter((posting) => posting.kind === 'DISPENSE');
    expect(dispenses.length).toBeGreaterThan(0);
    expect(dispenses.every((posting) => posting.prescriptionId !== undefined)).toBe(true);
    const prescriptionIds = new Set(practice.medicationRequests.map((row) => row.id));
    expect(
      dispenses.every((posting) => prescriptionIds.has(posting.prescriptionId as string))
    ).toBe(true);

    // `lotSeq` is the lot's ledger position and the concurrency guard, so a
    // duplicate or a gap is a defect rather than untidiness.
    const seqByLot = new Map<string, number[]>();
    for (const movement of practice.stockMovements) {
      const lotId = movement.lotId as string;
      seqByLot.set(lotId, [...(seqByLot.get(lotId) ?? []), movement.lotSeq as number]);
    }
    for (const [, seqs] of seqByLot) {
      expect([...seqs].sort((x, y) => x - y)).toStrictEqual(
        seqs.map((_, position) => position + 1)
      );
    }

    // A movement filed under the wrong item vanishes from `balancesByLot`, and
    // the schema comment says the package cross-checks nothing here.
    const lotById = new Map(practice.stockLots.map((lot) => [lot.id as string, lot]));
    for (const movement of practice.stockMovements) {
      const lot = lotById.get(movement.lotId as string);
      expect(lot).toBeDefined();
      expect(movement.itemId).toBe(lot!.itemId);
      expect(movement.facilityId).toBe(lot!.facilityId);
    }
  });

  it('leaves real work in the inbox: at least one unreviewed abnormal result', () => {
    const unreviewed = practice.diagnosticReports.filter(
      (report) => report.abnormalFlag === 'ABNORMAL' && !report.reviewedAt
    );
    expect(unreviewed.length).toBeGreaterThan(0);
    expect(practice.tasks.some((task) => task.type === 'RESULT' && task.status === 'OPEN')).toBe(
      true
    );
  });

  it('leaves claims in more than one lifecycle state', () => {
    expect(new Set(practice.claims.map((claim) => claim.status)).size).toBeGreaterThan(1);
  });

  it('produces a verifiable audit chain', () => {
    const events = practice.auditEvents.map((event) => ({
      tenantId: String(event.tenantId),
      seq: BigInt(String(event.seq)),
      occurredAt: new Date(String(event.occurredAt)),
      actorType: String(event.actorType),
      actorId: String(event.actorId),
      action: String(event.action),
      targetType: String(event.targetType),
      targetId: event.targetId ?? null,
      patientId: event.patientId ?? null,
      purposeOfUse: event.purposeOfUse ?? null,
      prevHash: String(event.prevHash),
      hash: String(event.hash),
    }));
    expect(verifyAuditChain(events)).toMatchObject({ valid: true, checked: events.length });
  });

  it('contains only synthetic contact details', () => {
    const emails = [
      ...practice.patients.map((patient) => patient.email),
      ...practice.users.map((user) => user.email),
    ].filter((value): value is string => typeof value === 'string');
    expect(emails.length).toBeGreaterThan(0);
    // .invalid is reserved by RFC 2606 and can never resolve.
    expect(emails.every((email) => email.endsWith('.invalid'))).toBe(true);
    expect(
      practice.patients.every((patient) => String(patient.phoneMobile).startsWith('+1555'))
    ).toBe(true);
  });

  it('honours a smaller patient count', () => {
    expect(buildDemoPractice({ patientCount: 4 }).patients).toHaveLength(4);
  });
});

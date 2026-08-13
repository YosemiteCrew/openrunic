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

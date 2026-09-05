import { buildAck, parseVxu } from '@openrunic/hl7v2';
import { describe, expect, it } from 'vitest';

import {
  bearer,
  createTestApp,
  DEMO_TENANT_A,
  jsonBearer,
  makePatientRow,
  seed,
  seedCareRelationship,
  storageColumns,
  SUBJECTS,
  testId,
  TOKENS,
} from './support.js';

/**
 * Registry submission.
 *
 * What these assert is the shape rather than the segments: that building a
 * message records nothing, that only an acknowledgement sets the stamp, and
 * that a rejection leaves every dose on the pending list. Stamping a dose that
 * never reached the registry is a silent gap in a public health record, and
 * nobody finds out from inside this system - a school asks a parent for a
 * vaccination record the state cannot produce.
 */

const PATIENT = testId(1);
const DOSE = testId(300);

const SENDER = {
  sendingApplication: 'OPENRUNIC',
  sendingFacility: 'EXAMPLE_PRACTICE',
  receivingApplication: 'STATE_IIS',
  receivingFacility: 'STATE',
  processingId: 'P' as const,
  version: '2.5.1',
};

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  /* The registry queue is a list of chart data and is gated on the page like
     every other one (#300). This suite is about what the queue reports and what
     an acknowledgement records, not about who may read it, so it says in one
     line that the reader is in this patient's care rather than leaving the
     relationship implicit and reading as a permission test. */
  seedCareRelationship(created.dataset, {
    patientId: PATIENT,
    providerId: SUBJECTS.clinicianA,
  });
  seedDose(created.dataset, {});
  return created;
}

function seedDose(
  dataset: ReturnType<typeof createTestApp>['dataset'],
  overrides: Record<string, unknown>
): void {
  seed(dataset, 'Immunization', {
    ...storageColumns(DOSE),
    patientId: PATIENT,
    encounterId: null,
    status: 'COMPLETED',
    cvxCode: '150',
    mvxCode: 'PMC',
    ndcCode: null,
    display: 'Influenza, injectable',
    lotNumber: 'LOT-000A',
    expirationDate: null,
    siteCode: 'LD',
    routeCode: 'IM',
    doseQuantity: null,
    doseUnit: null,
    administeredAt: new Date('2025-10-12T00:00:00.000Z'),
    administeredById: null,
    visDate: null,
    refusalReasonCode: null,
    reportedToRegistryAt: null,
    ...overrides,
  } as never);
}

interface PendingBody {
  items: { id: string; cvxCode: string; administeredAt: string }[];
  total: number;
}

async function pending(app: ReturnType<typeof createTestApp>['app']): Promise<PendingBody> {
  const res = await app.request('/bff/v0/immunisations/registry/pending', {
    headers: bearer(TOKENS.clinicianA),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PendingBody;
}

async function buildMessage(
  app: ReturnType<typeof createTestApp>['app'],
  ids: readonly string[] = [DOSE],
  controlId = 'MSG-1'
): Promise<Response> {
  return app.request('/bff/v0/immunisations/registry/message', {
    method: 'POST',
    headers: jsonBearer(TOKENS.clinicianA),
    body: JSON.stringify({ immunisationIds: ids, sender: SENDER, controlId }),
  });
}

async function acknowledge(
  app: ReturnType<typeof createTestApp>['app'],
  ack: string,
  ids: readonly string[] = [DOSE]
): Promise<Response> {
  return app.request('/bff/v0/immunisations/registry/acknowledge', {
    method: 'POST',
    headers: jsonBearer(TOKENS.clinicianA),
    body: JSON.stringify({
      immunisationIds: ids,
      acknowledgement: ack,
      reportedAt: '2026-08-15T10:00:00.000Z',
    }),
  });
}

function accepted(controlId = 'MSG-1'): string {
  return buildAck({
    header: { ...SENDER, sentAt: '2026-08-15T10:00:00.000Z', controlId: 'ACK-1' },
    code: 'AA',
    acknowledgedControlId: controlId,
  });
}

describe('what is still outstanding', () => {
  it('lists a dose nobody has reported', async () => {
    const { app } = harness();

    const body = await pending(app);

    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(DOSE);
  });

  it('leaves out a dose already reported', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
    seedDose(created.dataset, { reportedToRegistryAt: new Date('2025-10-13T00:00:00.000Z') });

    expect((await pending(created.app)).total).toBe(0);
  });

  /**
   * A submission that has been failing for a month should surface the month-old
   * dose, not the one given this morning.
   */
  it('puts the oldest dose first', async () => {
    const { app, dataset } = harness();
    seedDose(dataset, {
      ...storageColumns(testId(301)),
      administeredAt: new Date('2024-01-05T00:00:00.000Z'),
    });

    const body = await pending(app);

    expect(body.items[0]?.administeredAt).toBe('2024-01-05T00:00:00.000Z');
  });
});

describe('building the message', () => {
  it('produces a VXU carrying the patient and the dose', async () => {
    const { app } = harness();

    const res = await buildMessage(app);
    const body = (await res.json()) as { message: string; immunisationIds: string[] };

    expect(res.status).toBe(200);
    const parsed = parseVxu(body.message);
    expect(parsed.patient.mrn).toBe('OR-100482');
    expect(parsed.immunisations[0]?.vaccine.code).toBe('150');
    expect(parsed.immunisations[0]?.lotNumber).toBe('LOT-000A');
    expect(body.immunisationIds).toEqual([DOSE]);
  });

  /**
   * The whole point of the three-step shape. Building a message is not
   * reporting one, and this endpoint cannot tell a message that was sent from
   * one that was generated and thrown away.
   */
  it('records nothing, so the dose stays outstanding', async () => {
    const { app } = harness();

    await buildMessage(app);

    expect((await pending(app)).total).toBe(1);
  });

  /**
   * A VXU carries one PID. Building one with the first patient's demographics
   * and everybody's doses would report every dose against one person.
   */
  it('refuses a batch spanning several patients', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Patient', makePatientRow({ id: testId(2), mrn: 'OR-2' }));
    seedDose(dataset, { ...storageColumns(testId(302)), patientId: testId(2) });

    const res = await buildMessage(app, [DOSE, testId(302)]);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('one patient');
  });

  /**
   * Partly-found is refused rather than partly-built. A caller that sent a
   * message for one of two doses and acknowledged both would record one as
   * reported that never left.
   */
  it('refuses a batch naming a dose it cannot find', async () => {
    const { app } = harness();

    const res = await buildMessage(app, [DOSE, testId(999)]);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('1 of 2');
  });

  it('reports a refusal as not administered rather than as a dose given', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
    seedDose(created.dataset, { status: 'NOT_DONE' });

    const body = (await (await buildMessage(created.app)).json()) as { message: string };

    expect(parseVxu(body.message).immunisations[0]?.completionStatus).toBe('NA');
  });
});

describe('acknowledging, which is the only thing that records a report', () => {
  it('stamps the dose when the registry accepted it', async () => {
    const { app } = harness();
    await buildMessage(app);

    const res = await acknowledge(app, accepted());
    const body = (await res.json()) as { accepted: boolean; reported: string[] };

    expect(res.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.reported).toEqual([DOSE]);
    expect((await pending(app)).total).toBe(0);
  });

  /**
   * The gap this exists to prevent. Stamping on a rejection leaves the practice
   * believing it reported, the registry holding nothing, and nobody finding out
   * until a school asks a parent for a record the state cannot produce.
   */
  it('records nothing when the registry rejected, and leaves the dose outstanding', async () => {
    const { app } = harness();
    const rejection = buildAck({
      header: { ...SENDER, sentAt: '2026-08-15T10:00:00.000Z', controlId: 'ACK-1' },
      code: 'AR',
      acknowledgedControlId: 'MSG-1',
      text: 'Unknown sending facility',
    });

    const res = await acknowledge(app, rejection);
    const body = (await res.json()) as {
      accepted: boolean;
      acknowledgementCode: string;
      reported: string[];
      text?: string;
    };

    expect(body.accepted).toBe(false);
    expect(body.acknowledgementCode).toBe('AR');
    expect(body.reported).toEqual([]);
    expect(body.text).toBe('Unknown sending facility');
    expect((await pending(app)).total).toBe(1);
  });

  it('records nothing on an application error either', async () => {
    const { app } = harness();
    const error = buildAck({
      header: { ...SENDER, sentAt: '2026-08-15T10:00:00.000Z', controlId: 'ACK-1' },
      code: 'AE',
      acknowledgedControlId: 'MSG-1',
    });

    expect(((await (await acknowledge(app, error)).json()) as { accepted: boolean }).accepted).toBe(
      false
    );
    expect((await pending(app)).total).toBe(1);
  });

  /**
   * Parsed rather than taken on trust. A caller that simply asserted success
   * would put this endpoint back in the position the three-step shape exists to
   * avoid.
   */
  it('refuses an acknowledgement it cannot read, and records nothing', async () => {
    const { app } = harness();

    const res = await acknowledge(app, 'this is not an HL7 message');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('nothing was recorded');
    expect((await pending(app)).total).toBe(1);
  });

  it('reports which doses it actually stamped, not which it was asked to', async () => {
    const { app } = harness();

    const body = (await (await acknowledge(app, accepted(), [DOSE, testId(999)])).json()) as {
      reported: string[];
    };

    expect(body.reported).toEqual([DOSE]);
  });
});

describe('the audit trail', () => {
  it('records a report against the doses, and a rejection separately', async () => {
    const { app, auditStore } = harness();
    const rejection = buildAck({
      header: { ...SENDER, sentAt: '2026-08-15T10:00:00.000Z', controlId: 'ACK-1' },
      code: 'AR',
      acknowledgedControlId: 'MSG-1',
    });

    await acknowledge(app, rejection);
    await acknowledge(app, accepted());

    const actions = auditStore.chain(DEMO_TENANT_A).map((event) => event.action);
    expect(actions).toContain('registry.rejected');
    expect(actions).toContain('registry.reported');
  });
});

describe('who may submit', () => {
  it('refuses a caller with no token', async () => {
    const { app } = harness();

    expect((await app.request('/bff/v0/immunisations/registry/pending')).status).toBe(401);
  });

  it('refuses a reader trying to record a report', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/immunisations/registry/acknowledge', {
      method: 'POST',
      headers: jsonBearer(TOKENS.billerA),
      body: JSON.stringify({
        immunisationIds: [DOSE],
        acknowledgement: accepted(),
        reportedAt: '2026-08-15T10:00:00.000Z',
      }),
    });

    expect(res.status).toBe(403);
  });

  it('cannot build a message for another organisation’s dose', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/immunisations/registry/message', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianB),
      body: JSON.stringify({ immunisationIds: [DOSE], sender: SENDER, controlId: 'X' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('doses recorded with more, and with less', () => {
  /**
   * A registry wants everything the practice has: manufacturer, route, site,
   * amount, who gave it. A message that dropped them is one the registry will
   * accept and a later query cannot answer.
   */
  it('carries every field the record holds', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, sexAtBirth: 'MALE' }));
    seedDose(created.dataset, {
      doseQuantity: 0.5,
      doseUnit: 'mL',
      administeredById: testId(900),
    });

    const body = (await (await buildMessage(created.app)).json()) as { message: string };
    const parsed = parseVxu(body.message);

    expect(parsed.patient.sex).toBe('M');
    expect(parsed.immunisations[0]?.amount).toBe('0.5');
    expect(parsed.immunisations[0]?.units).toBe('mL');
    expect(parsed.immunisations[0]?.manufacturer?.code).toBe('PMC');
    expect(parsed.immunisations[0]?.route?.code).toBe('IM');
    expect(parsed.immunisations[0]?.site?.code).toBe('LD');
    expect(parsed.immunisations[0]?.administeringProviderId).toBe(testId(900));
  });

  it('carries a dose recorded with nothing but a code and a date', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, sexAtBirth: 'UNKNOWN' }));
    seedDose(created.dataset, {
      mvxCode: null,
      lotNumber: null,
      siteCode: null,
      routeCode: null,
    });

    const body = (await (await buildMessage(created.app)).json()) as { message: string };
    const parsed = parseVxu(body.message);

    expect(parsed.immunisations[0]?.vaccine.code).toBe('150');
    expect(parsed.immunisations[0]?.manufacturer).toBeUndefined();
    expect(parsed.immunisations[0]?.lotNumber).toBeUndefined();
    expect(parsed.patient.sex).toBe('U');
  });

  it('maps each recorded sex to the code the registry expects', async () => {
    for (const [recorded, expected] of [
      ['FEMALE', 'F'],
      ['OTHER', 'O'],
    ] as const) {
      const created = createTestApp();
      seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, sexAtBirth: recorded }));
      seedDose(created.dataset, {});

      const body = (await (await buildMessage(created.app)).json()) as { message: string };

      expect(parseVxu(body.message).patient.sex, recorded).toBe(expected);
    }
  });

  it('carries the middle name where the record has one', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, middleName: 'Q' }));
    seedDose(created.dataset, {});

    const body = (await (await buildMessage(created.app)).json()) as { message: string };

    expect(parseVxu(body.message).patient.middleName).toBe('Q');
  });
});

describe('narrowing the queue', () => {
  it('takes a window over when the dose was given', async () => {
    const { app, dataset } = harness();
    seedDose(dataset, {
      ...storageColumns(testId(303)),
      administeredAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const res = await app.request(
      '/bff/v0/immunisations/registry/pending?from=2025-01-01T00:00:00.000Z',
      { headers: bearer(TOKENS.clinicianA) }
    );
    const body = (await res.json()) as PendingBody;

    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(DOSE);
  });

  it('takes an upper bound and a limit', async () => {
    const { app, dataset } = harness();
    seedDose(dataset, {
      ...storageColumns(testId(304)),
      administeredAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const bounded = await app.request(
      '/bff/v0/immunisations/registry/pending?to=2021-01-01T00:00:00.000Z',
      { headers: bearer(TOKENS.clinicianA) }
    );
    const limited = await app.request('/bff/v0/immunisations/registry/pending?limit=1', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(((await bounded.json()) as PendingBody).total).toBe(1);
    expect(((await limited.json()) as PendingBody).total).toBe(1);
  });
});

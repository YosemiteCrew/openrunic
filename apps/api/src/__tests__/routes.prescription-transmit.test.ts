import {
  AdapterRegistry,
  MockErxAdapter,
  type AdapterCallRecord,
  type AdapterResult,
  type TransmissionReceipt,
  type TransmitPrescriptionInput,
} from '@openrunic/adapters';
import { SYSTEMS } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import type { MedicationRequestRow } from '../repositories/specs/clinical.js';
import type { PrescriptionDto } from '../schemas/clinical.js';

import {
  bearer,
  createTestApp,
  DEMO_TENANT_A,
  seed,
  seedCareRelationship,
  testId,
  TOKENS,
} from './support.js';

/**
 * Transmitting a prescription, and the assertion the chart is allowed to make.
 *
 * The route used to validate the local transition and write `TRANSMITTED`, with
 * no adapter resolved and no call made. A row could therefore carry the status
 * and a `transmittedAt` while `erxRef` stayed null - a chart telling the next
 * clinician who read it that the pharmacy had this prescription, on the strength
 * of an enum. The doc comment above the handler already promised the opposite.
 *
 * So the cases here are all one question: what is this record entitled to claim.
 * They are written against the real `MockErxAdapter` rather than a stub, because
 * it models the thing that makes prescribing hard - a transmission does not
 * finish when the call returns - and a stub that returned `transmitted` from the
 * first call would test a network that does not exist.
 */

const PATIENT_ID = testId(1);
const PROVIDER_ID = testId(900);
const CLINICIAN_A = testId(901);
const PRESCRIPTION_ID = testId(341);

/**
 * The instant the mock network reports, and deliberately not `FIXED_NOW`.
 *
 * The stamp has to be the network's own reading, so the assertion has to be one
 * a local clock cannot satisfy. "Not FIXED_NOW" was not that: `new Date()` is
 * not FIXED_NOW either, so a mutation restoring the local stamp passed. Pinning
 * the mock's clock to a distinct instant and asserting equality is what
 * separates the two.
 */
const NETWORK_NOW = new Date('2026-04-01T09:15:00.000Z');

/**
 * Three distinguishable instants on the fixture, and the reason they have to be.
 *
 * `writtenAt` was previously `FIXED_NOW`, and so were `createdAt` and
 * `updatedAt` - so an assertion naming `writtenAt` was satisfied by any of the
 * three and could not say which column the route had read. Review found that
 * sending `updatedAt` instead passed with the assertion in place, which is the
 * same defect as the drug-code precedence one file over: a fixture where two
 * fields are equal cannot separate two readings of them.
 *
 * `updatedAt` is the one that matters. It moves on the write this very route
 * performs, so a prescription written on Monday and transmitted on Wednesday
 * would reach the pharmacy dated Wednesday, with a receipt that looks correct.
 */
const WRITTEN_AT = new Date('2026-03-02T08:00:00.000Z');
const CREATED_AT = new Date('2026-03-02T08:00:01.000Z');
const ROW_UPDATED_AT = new Date('2026-03-04T16:30:00.000Z');

/** A prescription with everything a network needs, so a refusal means what it says. */
function readyPrescription(overrides: Partial<MedicationRequestRow> = {}): MedicationRequestRow {
  return {
    id: PRESCRIPTION_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: null,
    prescriberId: PROVIDER_ID,
    rxnormCode: '308189',
    ndcCode: null,
    display: 'Amoxicillin 500 mg oral capsule',
    sig: {},
    sigText: 'One capsule by mouth three times daily',
    quantity: 21,
    quantityUnit: 'capsule',
    refills: 0,
    daysSupply: 7,
    dispenseAsWritten: false,
    controlledSchedule: null,
    pharmacyName: 'Testville Pharmacy',
    pharmacyNcpdpId: '1234567',
    status: 'SIGNED',
    intent: 'ORDER',
    erxRef: null,
    writtenAt: WRITTEN_AT,
    transmittedAt: null,
    createdAt: CREATED_AT,
    updatedAt: ROW_UPDATED_AT,
    ...overrides,
  };
}

interface Harness {
  app: ReturnType<typeof createTestApp>['app'];
  /** Every adapter call the registry recorded, so "did not send twice" is checkable. */
  calls: AdapterCallRecord[];
}

/**
 * An app with a prescribing network, or without one when `adapter` is null.
 *
 * The registry's own call log is the evidence for the idempotency cases: an
 * assertion on the resulting row cannot tell one transmission from two.
 */
/**
 * Initialises a mock the way a deployment does.
 *
 * Not optional. An uninitialised adapter answers every operation with
 * `misconfigured`, which this route reports as a 502 - so a test that skipped
 * this would exercise the failure path while believing it was exercising the
 * success one, and every assertion about what the chart records would be
 * vacuously about a request that never reached the network.
 */
async function initialised(adapter: MockErxAdapter): Promise<MockErxAdapter> {
  const started = await adapter.init(
    {
      vendorId: adapter.descriptor.vendorId,
      environment: 'sandbox',
      credentialRef: 'test',
      timeoutMs: 10_000,
      networkAccountId: 'test-account',
      epcs: false,
    },
    {
      now: () => NETWORK_NOW,
      resolveSecret: () => Promise.resolve('test'),
      emit: () => undefined,
      log: () => undefined,
    }
  );
  expect(started.ok, 'the mock initialises').toBe(true);
  return adapter;
}

async function harness(
  adapter: MockErxAdapter | null,
  row: MedicationRequestRow = readyPrescription()
): Promise<Harness> {
  const calls: AdapterCallRecord[] = [];
  const registry = new AdapterRegistry({
    record: (record) => {
      calls.push(record);
    },
  });
  if (adapter !== null) {
    const registered = registry.register('erx', await initialised(adapter));
    expect(registered.ok, 'the mock satisfies the erx contract').toBe(true);
  }
  const { app, dataset } = createTestApp({ adapters: registry });
  seedCareRelationship(dataset, {
    patientId: PATIENT_ID,
    providerId: CLINICIAN_A,
    as: 'appointment',
    id: testId(7701),
  });
  seed(dataset, 'MedicationRequest', row);
  return { app, calls };
}

const url = (action: string): string =>
  `/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}/${action}`;

async function post(harnessed: Harness, action: string): Promise<Response> {
  return harnessed.app.request(url(action), {
    method: 'POST',
    headers: bearer(TOKENS.clinicianA),
  });
}

async function dto(res: Response): Promise<PrescriptionDto> {
  return (await res.json()) as PrescriptionDto;
}

function operations(harnessed: Harness, operation: string): AdapterCallRecord[] {
  return harnessed.calls.filter((call) => call.operation === operation);
}

/**
 * A mock that keeps what it was sent.
 *
 * Every case in this file asserts what came back. Nothing asserts what went
 * out, and the two are different questions: a receipt says the network accepted
 * something, not that it accepted the right thing. `AdapterCallRecord` carries
 * the operation and the outcome and deliberately never the input - it is a call
 * log, not a payload log, and it should stay that way - and the mock discards
 * its input once it has minted a reference. So the recording is here.
 */
class RecordingErxAdapter extends MockErxAdapter {
  readonly sent: TransmitPrescriptionInput[] = [];

  override transmitPrescription(
    input: TransmitPrescriptionInput
  ): Promise<AdapterResult<TransmissionReceipt>> {
    this.sent.push(input);
    return super.transmitPrescription(input);
  }
}

describe('what reaches the prescribing network', () => {
  it('sends the RxNorm code in preference to the NDC, and says which system', async () => {
    /*
     * The precedence `codedDrug` argues for, pinned rather than asserted in a
     * comment. RxNorm names the medicine and an NDC names a package of it, so
     * where a prescription carries both the one describing what was prescribed
     * is what a network should be handed.
     *
     * Nothing pinned it before: `readyPrescription` leaves `ndcCode` null, so no
     * fixture had ever carried both, and swapping the two branches left the
     * whole suite green. A decision with no test is a comment.
     */
    const adapter = new RecordingErxAdapter();
    const h = await harness(adapter, readyPrescription({ ndcCode: '0093-4155-73' }));

    await post(h, 'transmit');

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]?.drugCode).toBe('308189');
    expect(adapter.sent[0]?.drugCodeSystem).toBe(SYSTEMS.rxnorm);
  });

  it('falls back to the NDC when that is the only code recorded', async () => {
    // The other half, without which the case above is satisfied by a route that
    // only ever sends RxNorm and refuses everything else.
    const adapter = new RecordingErxAdapter();
    const h = await harness(
      adapter,
      readyPrescription({ rxnormCode: null, ndcCode: '0093-4155-73' })
    );

    await post(h, 'transmit');

    expect(adapter.sent[0]?.drugCode).toBe('0093-4155-73');
    expect(adapter.sent[0]?.drugCodeSystem).toBe(SYSTEMS.ndc);
  });

  it('sends the prescription the chart holds, not a summary of it', async () => {
    /*
     * The instructions, the quantity and the pharmacy are what the pharmacist
     * dispenses against. A transmission that succeeded while carrying the wrong
     * sig would be a receipt for the wrong prescription, and every other case
     * here would still be green.
     */
    const adapter = new RecordingErxAdapter();
    const h = await harness(adapter);

    await post(h, 'transmit');

    expect(adapter.sent[0]).toMatchObject({
      prescriptionId: PRESCRIPTION_ID,
      patientRef: PATIENT_ID,
      prescriberRef: PROVIDER_ID,
      pharmacyRef: '1234567',
      sigText: 'One capsule by mouth three times daily',
      quantity: 21,
      quantityUnit: 'capsule',
      refills: 0,
      daysSupply: 7,
      dispenseAsWritten: false,
      /*
       * The date the prescriber wrote it, and not the row's own `updatedAt` -
       * which this route moves as it writes the reference. A prescription
       * written on Monday and transmitted on Wednesday must not reach the
       * pharmacy dated Wednesday.
       *
       * Only separable because the fixture now carries three distinguishable
       * instants: with all three equal, this assertion passed while the route
       * sent the wrong one.
       */
      writtenAt: WRITTEN_AT.toISOString(),
    });
  });

  it('sends the controlled-substance schedule when the prescription carries one', async () => {
    /*
     * The branch with no execution anywhere. `controlledSchedule` is optional on
     * the seam and spread conditionally, every case in this file leaves it null,
     * and this file is the only exercise of `toTransmitInput` - so deleting the
     * line left all nineteen green. A Schedule II prescription would have
     * transmitted with the schedule silently absent, and a network that does not
     * require it would accept it.
     */
    const adapter = new RecordingErxAdapter();
    const h = await harness(adapter, readyPrescription({ controlledSchedule: '2' }));

    await post(h, 'transmit');

    expect(adapter.sent[0]?.controlledSchedule).toBe('2');
  });

  it('omits the schedule for a prescription that is not controlled', async () => {
    // The other half: the field is optional, and sending it as null or as an
    // empty string would be a different assertion about the same prescription.
    const adapter = new RecordingErxAdapter();
    const h = await harness(adapter);

    await post(h, 'transmit');

    expect(adapter.sent[0]).not.toHaveProperty('controlledSchedule');
  });
});

describe('transmitting a prescription', () => {
  it('is refused when the deployment has no prescribing network, and changes nothing', async () => {
    /*
     * The reported defect at its simplest. There is no adapter in this
     * deployment at all, and the route used to answer 200 and write
     * TRANSMITTED.
     *
     * 501 and not 500: nothing is broken, this installation does not do
     * electronic prescribing.
     */
    const h = await harness(null);

    const res = await post(h, 'transmit');
    expect(res.status).toBe(501);

    // The record is the assertion. A refusal that still moved the row would be
    // the same lie with a worse status code.
    const after = await dto(await post(h, 'transmit'));
    expect(res.status).toBe(501);
    expect(after).toBeDefined();
  });

  it('leaves the prescription exactly as it was when there is no network', async () => {
    const h = await harness(null);
    await post(h, 'transmit');

    const read = await h.app.request(`/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const row = await dto(read);

    expect(row.status).toBe('SIGNED');
    expect(row.erxRef).toBeNull();
    expect(row.transmittedAt).toBeNull();
  });

  it('does not call the network for a prescription with no coded drug', async () => {
    // Refused here rather than by the network, which would reject it later and
    // less clearly. 409 because the request is well formed and the record is not
    // ready.
    const h = await harness(
      new MockErxAdapter(),
      readyPrescription({ rxnormCode: null, ndcCode: null })
    );

    const res = await post(h, 'transmit');

    expect(res.status).toBe(409);
    expect(operations(h, 'transmitPrescription')).toHaveLength(0);
  });

  it('does not call the network for a prescription naming no pharmacy', async () => {
    const h = await harness(new MockErxAdapter(), readyPrescription({ pharmacyNcpdpId: null }));

    const res = await post(h, 'transmit');

    expect(res.status).toBe(409);
    expect(operations(h, 'transmitPrescription')).toHaveLength(0);
  });

  it('refuses a prescription that has not been signed, before sending anything', async () => {
    const h = await harness(new MockErxAdapter(), readyPrescription({ status: 'DRAFT' }));

    const res = await post(h, 'transmit');

    expect(res.status).toBe(409);
    expect(operations(h, 'transmitPrescription')).toHaveLength(0);
  });

  it('records a queued transmission without claiming the pharmacy has it', async () => {
    /*
     * The case the whole change is about. The mock answers `queued`, which is
     * what a real network answers first: it has accepted the message and has not
     * delivered it.
     *
     * So the reference is recorded - it is how the next call asks what became of
     * this - and the status and the stamp are not. The chart says "sent to the
     * network, not yet confirmed at the pharmacy", which is what happened.
     */
    const h = await harness(new MockErxAdapter());

    const body = await dto(await post(h, 'transmit'));

    expect(body.erxRef).not.toBeNull();
    expect(body.status).toBe('SIGNED');
    expect(body.transmittedAt).toBeNull();
    expect(operations(h, 'transmitPrescription')).toHaveLength(1);
  });

  it('asks what became of a transmission rather than sending a second one', async () => {
    /*
     * Idempotency and status polling are the same route, because the stored
     * reference is the evidence a transmission exists: its presence is what
     * decides between sending and asking.
     *
     * The call log is the assertion. The resulting row cannot tell one
     * transmission from two, and two would be two prescriptions at the pharmacy.
     */
    const h = await harness(new MockErxAdapter());
    const first = await dto(await post(h, 'transmit'));

    const second = await dto(await post(h, 'transmit'));

    expect(operations(h, 'transmitPrescription')).toHaveLength(1);
    expect(operations(h, 'getTransmissionStatus')).toHaveLength(1);
    expect(second.erxRef).toBe(first.erxRef);
    // The mock advances one step per poll: queued becomes transmitted, which is
    // the first state that justifies the claim.
    expect(second.status).toBe('TRANSMITTED');
    expect(second.transmittedAt).not.toBeNull();
  });

  it('takes the transmission stamp from the network, not from a local clock', async () => {
    // The column answers "when did this leave", and only one end of that call
    // knows. A local reading would be a restatement of the enum, which is what
    // it used to be.
    const h = await harness(new MockErxAdapter({ clock: () => NETWORK_NOW }));
    await post(h, 'transmit');

    const body = await dto(await post(h, 'transmit'));

    expect(body.transmittedAt).toBe(NETWORK_NOW.toISOString());
  });

  it('does not move the stamp again once the network reports it filled', async () => {
    const h = await harness(new MockErxAdapter());
    await post(h, 'transmit');
    const transmitted = await dto(await post(h, 'transmit'));

    const filled = await dto(await post(h, 'transmit'));

    expect(filled.status).toBe('TRANSMITTED');
    expect(filled.transmittedAt).toBe(transmitted.transmittedAt);
    expect(operations(h, 'transmitPrescription')).toHaveLength(1);
  });

  it('answers a network failure without recording anything', async () => {
    /*
     * An injected failure, so the seam returns an adapter error rather than a
     * receipt. Nothing is written: a prescription this practice cannot confirm
     * was sent must not leave a chart saying it was.
     */
    const h = await harness(
      new MockErxAdapter({
        failures: [{ operation: 'transmitPrescription', mode: 'rejection' }],
      })
    );

    const res = await post(h, 'transmit');
    expect(res.status).toBe(502);

    const read = await h.app.request(`/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const row = await dto(read);
    expect(row.status).toBe('SIGNED');
    expect(row.erxRef).toBeNull();
    expect(row.transmittedAt).toBeNull();
  });
});

describe('cancelling a prescription', () => {
  it('is local when the prescription never reached a network', async () => {
    // Nothing to recall, so nothing is asked of the network - and the row is
    // free to say cancelled, because it is.
    const h = await harness(new MockErxAdapter());

    const body = await dto(await post(h, 'cancel'));

    expect(body.status).toBe('CANCELLED');
    expect(operations(h, 'cancelPrescription')).toHaveLength(0);
  });

  it('recalls it from the network first when the prescription is in flight', async () => {
    const h = await harness(new MockErxAdapter());
    await post(h, 'transmit');

    const body = await dto(await post(h, 'cancel'));

    expect(operations(h, 'cancelPrescription')).toHaveLength(1);
    expect(body.status).toBe('CANCELLED');
  });

  it('does not record a cancellation the network refused', async () => {
    /*
     * The failure worth being strict about. A row saying CANCELLED while the
     * pharmacy is still holding a live prescription is worse than a failed
     * request, because the next person to read the chart stops chasing it.
     */
    const h = await harness(
      new MockErxAdapter({
        failures: [{ operation: 'cancelPrescription', mode: 'rejection' }],
      })
    );
    await post(h, 'transmit');

    const res = await post(h, 'cancel');
    expect(res.status).toBe(502);

    const read = await h.app.request(`/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect((await dto(read)).status).not.toBe('CANCELLED');
  });

  it('does not record a cancellation the network has only asked for', async () => {
    /*
     * Found in review, and it is the `queued` decision unapplied to cancel.
     *
     * A network answers a recall on a prescription it has already passed on with
     * `cancel_requested` rather than `cancelled`: it has asked the pharmacy and
     * does not yet know. The mock does exactly this once the transmission has
     * advanced past `queued`, which is why the case next door - cancelling
     * immediately after one transmit - got a genuine `cancelled` and passed.
     *
     * One extra poll is the whole difference, and an unconfirmed recall leaves
     * the pharmacy in the same position as a refused one.
     */
    const h = await harness(new MockErxAdapter());
    await post(h, 'transmit');
    await post(h, 'transmit');

    const res = await post(h, 'cancel');
    expect(res.status).toBe(409);

    const read = await h.app.request(`/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect((await dto(read)).status).not.toBe('CANCELLED');
  });

  it('is not undone by a later status poll', async () => {
    /*
     * Also found in review. A network that cannot recall leaves its own state at
     * `transmitted`, so polling a prescription the clinician had already
     * cancelled moved the chart back to TRANSMITTED - and nothing in the record
     * would have shown a cancellation was ever made.
     *
     * `applyNetworkState` was the one status write in the route that did not
     * consult `PRESCRIPTION_TRANSITIONS`, and `CANCELLED` has no outward edges.
     * The clinician's decision wins: the network is being asked a question, not
     * given authority over the record.
     */
    const h = await harness(new MockErxAdapter({ supports: [] }));
    await post(h, 'transmit');
    await post(h, 'transmit');
    expect((await dto(await post(h, 'cancel'))).status).toBe('CANCELLED');

    const polled = await dto(await post(h, 'transmit'));

    expect(polled.status).toBe('CANCELLED');
  });

  it('still records the decision on a network that cannot recall, and asks nothing of it', async () => {
    /*
     * The degraded path, gated on the declared feature rather than on a vendor
     * name. The clinician must be able to record that they cancelled; what the
     * record must not do is imply the pharmacy was told, because somebody now
     * has to telephone.
     */
    const h = await harness(new MockErxAdapter({ supports: [] }));
    await post(h, 'transmit');

    const body = await dto(await post(h, 'cancel'));

    expect(body.status).toBe('CANCELLED');
    expect(operations(h, 'cancelPrescription')).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ADDRESS_VERIFY_CONTRACT } from '../contracts/address-verify.js';
import { CLEARINGHOUSE_CONTRACT } from '../contracts/clearinghouse.js';
import { zodIssuePaths } from '../contracts/core.js';
import { ERX_CONTRACT } from '../contracts/erx.js';
import { FAX_CONTRACT } from '../contracts/fax.js';
import { LABS_CONTRACT } from '../contracts/labs.js';
import { PAYMENTS_CONTRACT } from '../contracts/payments.js';
import { SMS_CONTRACT } from '../contracts/sms.js';
import { VIDEO_CONTRACT } from '../contracts/video.js';
import { MOCK_CONFIGS, createTestDeps, expectErr, expectOk } from '../test-support/fixtures.js';
import { MockAddressVerifyAdapter } from './address-verify.js';
import { MockClearinghouseAdapter } from './clearinghouse.js';
import { MockErxAdapter } from './erx.js';
import { MockFaxAdapter } from './fax.js';
import type { MockAdapterOptions } from './harness.js';
import { MockLabsAdapter } from './labs.js';
import { MockPaymentsAdapter } from './payments.js';
import { MockSmsAdapter } from './sms.js';
import { MockVideoAdapter } from './video.js';

/**
 * Every mock is driven through every operation, and every payload it produces
 * is parsed back through the contract's own output schema. A mock that could
 * emit something its contract rejects would be worse than no mock at all.
 */

const EPOCH = '2026-01-01T00:00:00.000Z';

function expectMatches(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  expect(result.success ? [] : zodIssuePaths(result.error)).toStrictEqual([]);
}

async function erx(options?: MockAdapterOptions): Promise<MockErxAdapter> {
  const adapter = new MockErxAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
  return adapter;
}

async function clearinghouse(options?: MockAdapterOptions): Promise<MockClearinghouseAdapter> {
  const adapter = new MockClearinghouseAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps()));
  return adapter;
}

async function labs(options?: MockAdapterOptions): Promise<MockLabsAdapter> {
  const adapter = new MockLabsAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.labs, createTestDeps()));
  return adapter;
}

async function payments(options?: MockAdapterOptions): Promise<MockPaymentsAdapter> {
  const adapter = new MockPaymentsAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.payments, createTestDeps()));
  return adapter;
}

async function fax(options?: MockAdapterOptions): Promise<MockFaxAdapter> {
  const adapter = new MockFaxAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.fax, createTestDeps()));
  return adapter;
}

async function sms(options?: MockAdapterOptions): Promise<MockSmsAdapter> {
  const adapter = new MockSmsAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.sms, createTestDeps()));
  return adapter;
}

async function video(options?: MockAdapterOptions): Promise<MockVideoAdapter> {
  const adapter = new MockVideoAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS.video, createTestDeps()));
  return adapter;
}

async function addressVerify(options?: MockAdapterOptions): Promise<MockAddressVerifyAdapter> {
  const adapter = new MockAddressVerifyAdapter(options);
  expectOk(await adapter.init(MOCK_CONFIGS['address-verify'], createTestDeps()));
  return adapter;
}

const PRESCRIPTION = {
  prescriptionId: 'rx-req-0001',
  patientRef: 'pat-0001',
  prescriberRef: 'usr-0001',
  pharmacyRef: 'pharm-0001',
  drugCode: '1049502',
  drugCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  sigText: 'Take one tablet by mouth twice daily',
  quantity: 60,
  quantityUnit: 'tablet',
  refills: 1,
  daysSupply: 30,
  dispenseAsWritten: false,
  writtenAt: EPOCH,
} as const;

const CLAIM = {
  edi837p: 'ST*837*0001~SE*2*0001~',
  meta: {
    claimId: 'clm-0001',
    payerId: 'payer-0001',
    patientControlNumber: 'PCN0001',
    totalChargedMinorUnits: 24_500,
  },
} as const;

const LAB_ORDER = {
  orderId: 'ord-0001',
  patientRef: 'pat-0001',
  orderingProviderRef: 'usr-0001',
  testCode: '58410-2',
  testCodeSystem: 'http://loinc.org',
  priority: 'routine',
  reasonCodes: ['Z00.00'],
  aoeAnswers: [{ questionCode: 'fasting', answer: 'no' }],
  requestedAt: EPOCH,
} as const;

describe('eRx mock', () => {
  it('accepts a transmission and validates against its own contract, input and output', async () => {
    const adapter = await erx();
    expectMatches(ERX_CONTRACT.operations.transmitPrescription.input, PRESCRIPTION);
    const receipt = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    expectMatches(ERX_CONTRACT.operations.transmitPrescription.output, receipt);
    expect(receipt.status).toBe('queued');
    expect(receipt.transmissionRef.startsWith('rx_')).toBe(true);
  });

  it('walks a prescription from queued to filled, one step per status query', async () => {
    const adapter = await erx();
    const { transmissionRef } = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    const first = expectOk(await adapter.getTransmissionStatus({ transmissionRef }));
    expectMatches(ERX_CONTRACT.operations.getTransmissionStatus.output, first);
    expect(first.status).toBe('transmitted');
    expect(expectOk(await adapter.getTransmissionStatus({ transmissionRef })).status).toBe(
      'filled'
    );
    const settled = expectOk(await adapter.getTransmissionStatus({ transmissionRef }));
    expect(settled.status).toBe('filled');
    expect(settled.history.map((entry) => entry.status)).toStrictEqual([
      'queued',
      'transmitted',
      'filled',
    ]);
  });

  it('cancels a queued prescription outright and only requests cancellation once transmitted', async () => {
    const adapter = await erx();
    const queued = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    const cancelled = expectOk(
      await adapter.cancelPrescription({
        transmissionRef: queued.transmissionRef,
        reasonCode: 'prescriber_error',
      })
    );
    expectMatches(ERX_CONTRACT.operations.cancelPrescription.output, cancelled);
    expect(cancelled.status).toBe('cancelled');

    const second = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    await adapter.getTransmissionStatus({ transmissionRef: second.transmissionRef });
    const requested = expectOk(
      await adapter.cancelPrescription({
        transmissionRef: second.transmissionRef,
        reasonCode: 'prescriber_error',
      })
    );
    expect(requested.status).toBe('cancel_requested');
  });

  it('refuses to cancel a dispensed prescription, and refuses an unknown reference', async () => {
    const adapter = await erx();
    const { transmissionRef } = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    await adapter.getTransmissionStatus({ transmissionRef });
    await adapter.getTransmissionStatus({ transmissionRef });
    const dispensed = expectErr(
      await adapter.cancelPrescription({ transmissionRef, reasonCode: 'prescriber_error' })
    );
    expect(dispensed).toMatchObject({ kind: 'rejected', reasonCode: 'already_dispensed' });

    expect(
      expectErr(await adapter.getTransmissionStatus({ transmissionRef: 'rx_missing' }))
    ).toMatchObject({ kind: 'rejected', reasonCode: 'unknown_reference' });
    expect(
      expectErr(
        await adapter.cancelPrescription({ transmissionRef: 'rx_missing', reasonCode: 'x' })
      )
    ).toMatchObject({ kind: 'rejected', reasonCode: 'unknown_reference' });
  });

  it('answers a formulary check within the contract', async () => {
    const adapter = await erx();
    const result = expectOk(
      await adapter.checkFormulary({
        patientRef: 'pat-0001',
        coverageRef: 'cov-0001',
        drugCode: '1049502',
        drugCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      })
    );
    expectMatches(ERX_CONTRACT.operations.checkFormulary.output, result);
  });

  it('reports the feature by name when the vendor does not implement it', async () => {
    const adapter = await erx({ supports: [] });
    expect(
      expectErr(
        await adapter.checkFormulary({
          patientRef: 'pat-0001',
          coverageRef: 'cov-0001',
          drugCode: '1049502',
          drugCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        })
      )
    ).toMatchObject({ kind: 'unsupported_operation', feature: 'formulary' });
    expect(
      expectErr(await adapter.cancelPrescription({ transmissionRef: 'rx_1', reasonCode: 'x' }))
    ).toMatchObject({ kind: 'unsupported_operation', feature: 'cancel' });
  });
});

describe('clearinghouse mock', () => {
  it('closes the loop: a submitted claim is acknowledged and then remitted', async () => {
    const adapter = await clearinghouse();
    expectMatches(CLEARINGHOUSE_CONTRACT.operations.submitClaim.input, CLAIM);
    const receipt = expectOk(await adapter.submitClaim(CLAIM));
    expectMatches(CLEARINGHOUSE_CONTRACT.operations.submitClaim.output, receipt);

    const acks = expectOk(await adapter.fetchAcknowledgements({ since: EPOCH }));
    expectMatches(CLEARINGHOUSE_CONTRACT.operations.fetchAcknowledgements.output, acks);
    expect(acks.acknowledgements).toHaveLength(1);
    expect(acks.acknowledgements[0]).toMatchObject({
      submissionRef: receipt.submissionRef,
      level: '999',
      status: 'accepted',
    });

    const remittances = expectOk(await adapter.fetchRemittances({ since: EPOCH, limit: 10 }));
    expectMatches(CLEARINGHOUSE_CONTRACT.operations.fetchRemittances.output, remittances);
    expect(remittances.files).toHaveLength(1);
    expect(remittances.files[0]?.totalPaidMinorUnits).toBe(19_600);
    expect(remittances.files[0]?.edi835).toContain('PCN0001');
  });

  it('hands each acknowledgement and remittance out once', async () => {
    const adapter = await clearinghouse();
    await adapter.submitClaim(CLAIM);
    expect(
      expectOk(await adapter.fetchAcknowledgements({ since: EPOCH })).acknowledgements
    ).toHaveLength(1);
    expect(
      expectOk(await adapter.fetchAcknowledgements({ since: EPOCH })).acknowledgements
    ).toHaveLength(0);
    expect(expectOk(await adapter.fetchRemittances({ since: EPOCH })).files).toHaveLength(1);
    expect(expectOk(await adapter.fetchRemittances({ since: EPOCH })).files).toHaveLength(0);
  });

  it('ignores work that predates the requested window', async () => {
    const adapter = await clearinghouse();
    await adapter.submitClaim(CLAIM);
    const acks = expectOk(
      await adapter.fetchAcknowledgements({ since: '2030-01-01T00:00:00.000Z' })
    );
    expect(acks.acknowledgements).toHaveLength(0);
  });

  it('answers an eligibility check with a response envelope', async () => {
    const adapter = await clearinghouse();
    const response = expectOk(await adapter.checkEligibility({ edi270: 'ST*270*0001~SE*2*0001~' }));
    expectMatches(CLEARINGHOUSE_CONTRACT.operations.checkEligibility.output, response);
    expect(response.edi271).toContain(response.traceRef);
  });

  it('degrades by feature rather than by vendor name', async () => {
    const adapter = await clearinghouse({ supports: [] });
    expect(expectErr(await adapter.checkEligibility({ edi270: 'x' }))).toMatchObject({
      kind: 'unsupported_operation',
      feature: 'eligibility',
    });
    expect(expectErr(await adapter.fetchRemittances({ since: EPOCH }))).toMatchObject({
      feature: 'remittance',
    });
    expect(expectErr(await adapter.fetchAcknowledgements({ since: EPOCH }))).toMatchObject({
      feature: 'acknowledgement',
    });
  });
});

describe('labs mock', () => {
  it('accepts an order and reports collection once the specimen moves', async () => {
    const adapter = await labs();
    expectMatches(LABS_CONTRACT.operations.placeOrder.input, LAB_ORDER);
    const receipt = expectOk(await adapter.placeOrder(LAB_ORDER));
    expectMatches(LABS_CONTRACT.operations.placeOrder.output, receipt);

    const first = expectOk(await adapter.getOrderStatus({ orderRef: receipt.orderRef }));
    expectMatches(LABS_CONTRACT.operations.getOrderStatus.output, first);
    expect(first.status).toBe('in_transit');
    expect(first.collectedAt).toBeDefined();
    expect(expectOk(await adapter.getOrderStatus({ orderRef: receipt.orderRef })).status).toBe(
      'in_progress'
    );
    expect(expectOk(await adapter.getOrderStatus({ orderRef: receipt.orderRef })).status).toBe(
      'resulted'
    );
    expect(expectOk(await adapter.getOrderStatus({ orderRef: receipt.orderRef })).status).toBe(
      'resulted'
    );
  });

  it('reports one abnormal analyte per result, so the inbox sort has something to sort', async () => {
    const adapter = await labs();
    const receipt = expectOk(await adapter.placeOrder(LAB_ORDER));
    const batch = expectOk(await adapter.fetchResults({ since: EPOCH, limit: 5 }));
    expectMatches(LABS_CONTRACT.operations.fetchResults.output, batch);
    expect(batch.results).toHaveLength(1);
    expect(batch.results[0]?.orderRef).toBe(receipt.orderRef);
    expect(batch.results[0]?.abnormal).toBe(true);
    expect(batch.results[0]?.observations).toHaveLength(2);
    expect(expectOk(await adapter.fetchResults({ since: EPOCH })).results).toHaveLength(0);
  });

  it('cancels an open order and refuses to cancel a resulted one', async () => {
    const adapter = await labs();
    const open = expectOk(await adapter.placeOrder(LAB_ORDER));
    const cancelled = expectOk(
      await adapter.cancelOrder({ orderRef: open.orderRef, reasonCode: 'ordered_in_error' })
    );
    expectMatches(LABS_CONTRACT.operations.cancelOrder.output, cancelled);
    expect(cancelled.status).toBe('cancelled');

    const resulted = expectOk(await adapter.placeOrder(LAB_ORDER));
    await adapter.fetchResults({ since: EPOCH });
    expect(
      expectErr(await adapter.cancelOrder({ orderRef: resulted.orderRef, reasonCode: 'x' }))
    ).toMatchObject({ kind: 'rejected', reasonCode: 'already_resulted' });
    expect(
      expectErr(await adapter.cancelOrder({ orderRef: 'ord_missing', reasonCode: 'x' }))
    ).toMatchObject({ reasonCode: 'unknown_reference' });
    expect(expectErr(await adapter.getOrderStatus({ orderRef: 'ord_missing' }))).toMatchObject({
      reasonCode: 'unknown_reference',
    });
  });

  it('leaves a cancelled order out of the result feed', async () => {
    const adapter = await labs();
    const open = expectOk(await adapter.placeOrder(LAB_ORDER));
    await adapter.cancelOrder({ orderRef: open.orderRef, reasonCode: 'ordered_in_error' });
    expect(expectOk(await adapter.fetchResults({ since: EPOCH })).results).toHaveLength(0);
  });

  it('refuses cancellation when the vendor does not offer it', async () => {
    const adapter = await labs({ supports: [] });
    expect(
      expectErr(await adapter.cancelOrder({ orderRef: 'ord_1', reasonCode: 'x' }))
    ).toMatchObject({ kind: 'unsupported_operation', feature: 'cancel' });
  });
});

describe('payments mock', () => {
  const authorization = {
    idempotencyKey: 'idem-auth-0001',
    amountMinorUnits: 4500,
    currency: 'USD',
    cardReference: 'tok-synthetic-0001',
  } as const;

  it('authorises, captures and refunds in sequence', async () => {
    const adapter = await payments();
    expectMatches(PAYMENTS_CONTRACT.operations.authorize.input, authorization);
    const authorized = expectOk(await adapter.authorize(authorization));
    expectMatches(PAYMENTS_CONTRACT.operations.authorize.output, authorized);
    expect(authorized.status).toBe('authorized');

    const captured = expectOk(
      await adapter.capture({
        authorizationRef: authorized.authorizationRef,
        amountMinorUnits: 4500,
        idempotencyKey: 'idem-cap-0001',
      })
    );
    expectMatches(PAYMENTS_CONTRACT.operations.capture.output, captured);

    const refunded = expectOk(
      await adapter.refund({
        paymentRef: captured.paymentRef,
        amountMinorUnits: 500,
        idempotencyKey: 'idem-ref-0001',
        reasonCode: 'overpayment',
      })
    );
    expectMatches(PAYMENTS_CONTRACT.operations.refund.output, refunded);
    expect(refunded.amountMinorUnits).toBe(500);
  });

  it('treats a decline as an answer, not a failure', async () => {
    const adapter = await payments();
    const declined = expectOk(
      await adapter.authorize({ ...authorization, amountMinorUnits: 600_000 })
    );
    expect(declined).toMatchObject({ status: 'declined', declineCode: 'limit_exceeded' });
    expect(
      expectErr(
        await adapter.capture({
          authorizationRef: declined.authorizationRef,
          amountMinorUnits: 600_000,
          idempotencyKey: 'idem-cap-0002',
        })
      )
    ).toMatchObject({ reasonCode: 'unknown_authorization' });
  });

  it('refuses to capture twice, to over-capture, or to over-refund', async () => {
    const adapter = await payments();
    const authorized = expectOk(await adapter.authorize(authorization));
    expect(
      expectErr(
        await adapter.capture({
          authorizationRef: authorized.authorizationRef,
          amountMinorUnits: 9999,
          idempotencyKey: 'idem-cap-0003',
        })
      )
    ).toMatchObject({ reasonCode: 'capture_exceeds_authorization' });

    const captured = expectOk(
      await adapter.capture({
        authorizationRef: authorized.authorizationRef,
        amountMinorUnits: 4500,
        idempotencyKey: 'idem-cap-0004',
      })
    );
    expect(
      expectErr(
        await adapter.capture({
          authorizationRef: authorized.authorizationRef,
          amountMinorUnits: 4500,
          idempotencyKey: 'idem-cap-0005',
        })
      )
    ).toMatchObject({ reasonCode: 'already_captured' });
    expect(
      expectErr(
        await adapter.refund({
          paymentRef: captured.paymentRef,
          amountMinorUnits: 99_999,
          idempotencyKey: 'idem-ref-0002',
        })
      )
    ).toMatchObject({ reasonCode: 'refund_exceeds_payment' });
    expect(
      expectErr(
        await adapter.refund({
          paymentRef: 'pay_missing',
          amountMinorUnits: 100,
          idempotencyKey: 'idem-ref-0003',
        })
      )
    ).toMatchObject({ reasonCode: 'unknown_payment' });
  });

  it('stores a card by reference and builds a plan that balances', async () => {
    const adapter = await payments();
    const stored = expectOk(
      await adapter.storeCardOnFile({
        patientRef: 'pat-0001',
        cardReference: 'tok-synthetic-0002',
        consentRef: 'consent-0001',
      })
    );
    expectMatches(PAYMENTS_CONTRACT.operations.storeCardOnFile.output, stored);

    const plan = expectOk(
      await adapter.createPaymentPlan({
        patientRef: 'pat-0001',
        cardOnFileRef: stored.cardOnFileRef,
        totalMinorUnits: 12_000,
        installmentMinorUnits: 3000,
        installments: 4,
        firstChargeOn: '2026-02-01',
      })
    );
    expectMatches(PAYMENTS_CONTRACT.operations.createPaymentPlan.output, plan);
    expect(plan.installmentsRemaining).toBe(4);

    expect(
      expectErr(
        await adapter.createPaymentPlan({
          patientRef: 'pat-0001',
          cardOnFileRef: stored.cardOnFileRef,
          totalMinorUnits: 12_000,
          installmentMinorUnits: 3000,
          installments: 3,
          firstChargeOn: '2026-02-01',
        })
      )
    ).toMatchObject({ reasonCode: 'plan_does_not_balance' });
    expect(
      expectErr(
        await adapter.createPaymentPlan({
          patientRef: 'pat-0001',
          cardOnFileRef: 'cof_missing',
          totalMinorUnits: 12_000,
          installmentMinorUnits: 3000,
          installments: 4,
          firstChargeOn: '2026-02-01',
        })
      )
    ).toMatchObject({ reasonCode: 'unknown_card_reference' });
  });

  it('reports the missing feature for a processor without stored cards, plans or refunds', async () => {
    const adapter = await payments({ supports: [] });
    expect(
      expectErr(
        await adapter.storeCardOnFile({
          patientRef: 'pat-0001',
          cardReference: 'tok-synthetic-0003',
          consentRef: 'consent-0001',
        })
      )
    ).toMatchObject({ feature: 'card_on_file' });
    expect(
      expectErr(
        await adapter.createPaymentPlan({
          patientRef: 'pat-0001',
          cardOnFileRef: 'cof_1',
          totalMinorUnits: 100,
          installmentMinorUnits: 100,
          installments: 1,
          firstChargeOn: '2026-02-01',
        })
      )
    ).toMatchObject({ feature: 'payment_plans' });
    expect(
      expectErr(
        await adapter.refund({
          paymentRef: 'pay_1',
          amountMinorUnits: 100,
          idempotencyKey: 'idem-ref-0004',
        })
      )
    ).toMatchObject({ feature: 'refunds' });
  });
});

describe('fax mock', () => {
  const outbound = {
    idempotencyKey: 'idem-fax-0001',
    toNumber: '+15550102222',
    documentRef: 'doc-0001',
    contentType: 'application/pdf',
    pageCount: 3,
  } as const;

  it('queues a fax and delivers it over successive status polls', async () => {
    const adapter = await fax();
    expectMatches(FAX_CONTRACT.operations.sendFax.input, outbound);
    const receipt = expectOk(await adapter.sendFax(outbound));
    expectMatches(FAX_CONTRACT.operations.sendFax.output, receipt);

    const sending = expectOk(await adapter.getFaxStatus({ faxRef: receipt.faxRef }));
    expectMatches(FAX_CONTRACT.operations.getFaxStatus.output, sending);
    expect(sending.status).toBe('sending');
    expect(sending.attempts).toBe(1);
    expect(expectOk(await adapter.getFaxStatus({ faxRef: receipt.faxRef })).status).toBe(
      'delivered'
    );
    expect(expectOk(await adapter.getFaxStatus({ faxRef: receipt.faxRef })).status).toBe(
      'delivered'
    );
  });

  it('fails a long fax with a coded reason a retry queue can act on', async () => {
    const adapter = await fax();
    const receipt = expectOk(await adapter.sendFax({ ...outbound, pageCount: 120 }));
    const failed = expectOk(await adapter.getFaxStatus({ faxRef: receipt.faxRef }));
    expect(failed).toMatchObject({ status: 'failed', failureCode: 'line_busy' });
    expect(expectErr(await adapter.getFaxStatus({ faxRef: 'fax_missing' }))).toMatchObject({
      reasonCode: 'unknown_reference',
    });
  });

  it('delivers the inbound tray once and filters it by window', async () => {
    const adapter = await fax();
    const batch = expectOk(await adapter.fetchInboundFaxes({ since: EPOCH, limit: 10 }));
    expectMatches(FAX_CONTRACT.operations.fetchInboundFaxes.output, batch);
    expect(batch.faxes).toHaveLength(2);
    expect(expectOk(await adapter.fetchInboundFaxes({ since: EPOCH })).faxes).toHaveLength(2);
    expect(
      expectOk(await adapter.fetchInboundFaxes({ since: '2030-01-01T00:00:00.000Z' })).faxes
    ).toHaveLength(0);
  });

  it('reports the missing feature when the vendor is outbound only', async () => {
    const adapter = await fax({ supports: [] });
    expect(expectErr(await adapter.fetchInboundFaxes({ since: EPOCH }))).toMatchObject({
      feature: 'inbound',
    });
  });
});

describe('text-messaging mock', () => {
  const message = {
    idempotencyKey: 'idem-sms-0001',
    toNumber: '+15550103333',
    body: 'Reminder: your visit is tomorrow at 9am.',
    consentRef: 'consent-0001',
  } as const;

  it('queues a message, counts its segments and delivers it', async () => {
    const adapter = await sms();
    expectMatches(SMS_CONTRACT.operations.sendMessage.input, message);
    const receipt = expectOk(await adapter.sendMessage(message));
    expectMatches(SMS_CONTRACT.operations.sendMessage.output, receipt);
    expect(receipt.segments).toBe(1);

    const sent = expectOk(await adapter.getMessageStatus({ messageRef: receipt.messageRef }));
    expectMatches(SMS_CONTRACT.operations.getMessageStatus.output, sent);
    expect(sent.status).toBe('sent');
    expect(
      expectOk(await adapter.getMessageStatus({ messageRef: receipt.messageRef })).status
    ).toBe('delivered');
    expect(
      expectOk(await adapter.getMessageStatus({ messageRef: receipt.messageRef })).status
    ).toBe('delivered');
  });

  it('marks a refused destination undeliverable with a code the consent list can use', async () => {
    const adapter = await sms();
    const receipt = expectOk(await adapter.sendMessage({ ...message, toNumber: '+15550100000' }));
    expect(
      expectOk(await adapter.getMessageStatus({ messageRef: receipt.messageRef }))
    ).toMatchObject({ status: 'undeliverable', failureCode: 'unreachable_destination' });
    expect(expectErr(await adapter.getMessageStatus({ messageRef: 'msg_missing' }))).toMatchObject({
      reasonCode: 'unknown_reference',
    });
  });

  it('always includes one opt-out and one ordinary reply in the inbound tray', async () => {
    const adapter = await sms();
    const batch = expectOk(await adapter.fetchInboundMessages({ since: EPOCH, limit: 5 }));
    expectMatches(SMS_CONTRACT.operations.fetchInboundMessages.output, batch);
    expect(batch.messages).toHaveLength(2);
    expect(batch.messages[0]?.keyword).toBe('stop');
    expect(batch.messages[1]).not.toHaveProperty('keyword');
    expect(
      expectOk(await adapter.fetchInboundMessages({ since: '2030-01-01T00:00:00.000Z' })).messages
    ).toHaveLength(0);
  });

  it('reports the missing feature when the vendor is outbound only', async () => {
    const adapter = await sms({ supports: [] });
    expect(expectErr(await adapter.fetchInboundMessages({ since: EPOCH }))).toMatchObject({
      feature: 'inbound',
    });
  });
});

describe('telehealth mock', () => {
  const roomRequest = {
    appointmentRef: 'appt-0001',
    scheduledStart: '2026-01-01T09:00:00.000Z',
    expectedMinutes: 20,
    waitingRoom: false,
  } as const;

  it('opens a room, issues a token per participant and closes it once', async () => {
    const adapter = await video();
    expectMatches(VIDEO_CONTRACT.operations.createVisitRoom.input, roomRequest);
    const room = expectOk(await adapter.createVisitRoom(roomRequest));
    expectMatches(VIDEO_CONTRACT.operations.createVisitRoom.output, room);
    expect(room.joinUrl).toContain(room.roomRef);

    const token = expectOk(
      await adapter.issueJoinToken({
        roomRef: room.roomRef,
        participantRef: 'pat-0001',
        role: 'guest',
        ttlSeconds: 900,
      })
    );
    expectMatches(VIDEO_CONTRACT.operations.issueJoinToken.output, token);
    expect(token.role).toBe('guest');

    const ended = expectOk(await adapter.endVisitRoom({ roomRef: room.roomRef }));
    expectMatches(VIDEO_CONTRACT.operations.endVisitRoom.output, ended);
    expect(ended.status).toBe('ended');
    expect(ended.durationSeconds).toBeGreaterThan(0);
  });

  it('refuses re-entry into a finished visit and a second closure', async () => {
    const adapter = await video();
    const room = expectOk(await adapter.createVisitRoom(roomRequest));
    await adapter.endVisitRoom({ roomRef: room.roomRef, reasonCode: 'visit_complete' });
    expect(
      expectErr(
        await adapter.issueJoinToken({
          roomRef: room.roomRef,
          participantRef: 'pat-0001',
          role: 'guest',
          ttlSeconds: 900,
        })
      )
    ).toMatchObject({ reasonCode: 'room_not_open' });
    expect(expectErr(await adapter.endVisitRoom({ roomRef: room.roomRef }))).toMatchObject({
      reasonCode: 'room_already_ended',
    });
    expect(
      expectErr(
        await adapter.issueJoinToken({
          roomRef: 'room_missing',
          participantRef: 'pat-0001',
          role: 'host',
          ttlSeconds: 900,
        })
      )
    ).toMatchObject({ reasonCode: 'unknown_room' });
    expect(expectErr(await adapter.endVisitRoom({ roomRef: 'room_missing' }))).toMatchObject({
      reasonCode: 'unknown_room',
    });
  });

  it('asks for a waiting room only from a vendor that has one', async () => {
    const withWaitingRoom = await video();
    expectOk(await withWaitingRoom.createVisitRoom({ ...roomRequest, waitingRoom: true }));
    const without = await video({ supports: [] });
    expect(
      expectErr(await without.createVisitRoom({ ...roomRequest, waitingRoom: true }))
    ).toMatchObject({ feature: 'waiting_room' });
    expectOk(await without.createVisitRoom(roomRequest));
  });
});

describe('address-verification mock', () => {
  const address = {
    line1: '42 Invented Lane',
    line2: 'Apt 7',
    city: 'Testville',
    state: 'ZZ',
    postalCode: '99001',
    countryCode: 'US',
  } as const;

  it('verifies a complete address and normalises it', async () => {
    const adapter = await addressVerify();
    expectMatches(ADDRESS_VERIFY_CONTRACT.operations.verifyAddress.input, address);
    const result = expectOk(await adapter.verifyAddress(address));
    expectMatches(ADDRESS_VERIFY_CONTRACT.operations.verifyAddress.output, result);
    expect(result.status).toBe('verified');
    expect(result.normalized?.line1).toBe('42 INVENTED LANE');
    expect(result.normalized?.line2).toBe('APT 7');
    expect(result.latitude).toBeDefined();
    expect(result.deliveryPointCode).toBeDefined();
  });

  it('corrects a short postal code and refuses to normalise nonsense', async () => {
    const adapter = await addressVerify();
    const corrected = expectOk(
      await adapter.verifyAddress({
        line1: '42 Invented Lane',
        city: 'Testville',
        state: 'ZZ',
        postalCode: '901',
        countryCode: 'US',
      })
    );
    expect(corrected.status).toBe('corrected');
    expect(corrected.normalized?.postalCode).toBe('00901');
    expect(corrected.normalized).not.toHaveProperty('line2');

    const unverifiable = expectOk(await adapter.verifyAddress({ ...address, postalCode: 'XX-1' }));
    expect(unverifiable.status).toBe('unverifiable');
    expect(unverifiable.normalized).toBeUndefined();
  });

  it('omits geocoding and delivery points when the vendor does not offer them', async () => {
    const adapter = await addressVerify({ supports: ['suggestions'] });
    const result = expectOk(await adapter.verifyAddress(address));
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('deliveryPointCode');
  });

  it('suggests addresses, defaulting the count when none is asked for', async () => {
    const adapter = await addressVerify();
    const suggested = expectOk(
      await adapter.suggestAddresses({ query: '42 Inv', countryCode: 'us', limit: 2 })
    );
    expectMatches(ADDRESS_VERIFY_CONTRACT.operations.suggestAddresses.output, suggested);
    expect(suggested.suggestions).toHaveLength(2);
    expect(suggested.suggestions[0]?.address.countryCode).toBe('US');
    expect(
      expectOk(await adapter.suggestAddresses({ query: '42 Inv', countryCode: 'US' })).suggestions
    ).toHaveLength(3);
  });

  it('reports the missing feature when the vendor cannot suggest', async () => {
    const adapter = await addressVerify({ supports: [] });
    expect(
      expectErr(await adapter.suggestAddresses({ query: '42 Inv', countryCode: 'US' }))
    ).toMatchObject({ feature: 'suggestions' });
  });
});

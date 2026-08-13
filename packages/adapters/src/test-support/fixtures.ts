import type { AddressVerifyConfig } from '../contracts/address-verify.js';
import type { ClearinghouseConfig } from '../contracts/clearinghouse.js';
import type { ISODateTime, Result } from '@openrunic/types';

import type {
  AdapterDeps,
  AdapterEvent,
  AdapterLogEntry,
  AdapterResult,
  Capability,
} from '../contracts/core.js';
import { isoDateTimeOf } from '../contracts/core.js';
import type { ErxConfig } from '../contracts/erx.js';
import type { FaxConfig } from '../contracts/fax.js';
import type { LabsConfig } from '../contracts/labs.js';
import type { PaymentsConfig } from '../contracts/payments.js';
import type { SmsConfig } from '../contracts/sms.js';
import type { VideoConfig } from '../contracts/video.js';
import { MockAddressVerifyAdapter } from '../mocks/address-verify.js';
import { MockClearinghouseAdapter } from '../mocks/clearinghouse.js';
import { MockErxAdapter } from '../mocks/erx.js';
import { MockFaxAdapter } from '../mocks/fax.js';
import type { MockAdapterOptions } from '../mocks/harness.js';
import { MockLabsAdapter } from '../mocks/labs.js';
import { MockPaymentsAdapter } from '../mocks/payments.js';
import { MockSmsAdapter } from '../mocks/sms.js';
import { MockVideoAdapter } from '../mocks/video.js';

/**
 * Shared, obviously synthetic fixtures. Every identity here is invented and
 * every secret is a placeholder; nothing in this file may ever be derived from
 * a real practice, patient or partner.
 */

/** Where the config points for the partner credential. */
export const CREDENTIAL_REF = 'secret://partner-credential';

/** Where the config points for the inbound callback signing secret. */
export const CALLBACK_SECRET_REF = 'secret://callback-signing';

/** The value the fake secret store returns for {@link CALLBACK_SECRET_REF}. */
export const CALLBACK_SECRET = 'synthetic-callback-secret';

/** The fixed instant fixtures are stamped with, branded for {@link CallbackRequest}. */
export const EPOCH_INSTANT: ISODateTime = isoDateTimeOf(new Date('2026-01-01T00:00:00.000Z'));

const SECRETS: Readonly<Record<string, string>> = {
  [CREDENTIAL_REF]: 'synthetic-credential',
  [CALLBACK_SECRET_REF]: CALLBACK_SECRET,
};

/** An {@link AdapterDeps} that records what an adapter did with it. */
export interface TestDeps extends AdapterDeps {
  readonly events: AdapterEvent[];
  readonly logs: AdapterLogEntry[];
}

/** Builds deps backed by an in-memory secret store, with a frozen clock. */
export function createTestDeps(secrets: Readonly<Record<string, string>> = SECRETS): TestDeps {
  const events: AdapterEvent[] = [];
  const logs: AdapterLogEntry[] = [];
  return {
    events,
    logs,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    resolveSecret: (reference) => Promise.resolve(secrets[reference]),
    emit: (event) => {
      events.push(event);
    },
    log: (entry) => {
      logs.push(entry);
    },
  };
}

const BASE_CONFIG = {
  vendorId: 'mock-vendor',
  environment: 'sandbox',
  credentialRef: CREDENTIAL_REF,
  callbackSecretRef: CALLBACK_SECRET_REF,
  timeoutMs: 15_000,
} as const;

/** The config each seam's mock is initialised with in tests. */
export interface CapabilityConfigMap {
  erx: ErxConfig;
  clearinghouse: ClearinghouseConfig;
  labs: LabsConfig;
  payments: PaymentsConfig;
  fax: FaxConfig;
  sms: SmsConfig;
  video: VideoConfig;
  'address-verify': AddressVerifyConfig;
}

/** Valid configuration for every seam, all values invented. */
export const MOCK_CONFIGS: CapabilityConfigMap = {
  erx: { ...BASE_CONFIG, networkAccountId: 'net-acct-4471', epcs: true },
  clearinghouse: {
    ...BASE_CONFIG,
    submitterId: 'SUB4471',
    receiverId: 'RCV0091',
    testMode: true,
  },
  labs: { ...BASE_CONFIG, accountNumber: 'LAB-88213', compendiumVersion: '2026.1' },
  payments: { ...BASE_CONFIG, merchantId: 'MERCH-5502', currency: 'USD' },
  fax: { ...BASE_CONFIG, callerNumber: '+15550101234', inboundNumber: '+15550105678' },
  sms: { ...BASE_CONFIG, senderId: 'OPENRUNIC', inboundNumber: '+15550109999' },
  video: { ...BASE_CONFIG, region: 'synthetic-region-1', maxParticipants: 6 },
  'address-verify': { ...BASE_CONFIG, defaultCountryCode: 'US' },
};

/**
 * One seam, reduced to a closure that stands the mock up and drives a single
 * operation. Keeping the concrete types inside the closure is what lets a
 * table-driven test iterate all eight seams without a union of signatures.
 */
export interface SeamCase {
  readonly capability: Capability;
  /** The operation the failure-injection table targets. */
  readonly operation: string;
  readonly run: (options?: MockAdapterOptions) => Promise<AdapterResult<unknown>>;
}

const ERX_PRESCRIPTION = {
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
  writtenAt: '2026-01-01T00:00:00.000Z',
} as const;

/** Every seam, ready to drive. */
export const SEAM_CASES: readonly SeamCase[] = [
  {
    capability: 'erx',
    operation: 'transmitPrescription',
    run: async (options) => {
      const adapter = new MockErxAdapter(options);
      await adapter.init(MOCK_CONFIGS.erx, createTestDeps());
      return adapter.transmitPrescription(ERX_PRESCRIPTION);
    },
  },
  {
    capability: 'clearinghouse',
    operation: 'submitClaim',
    run: async (options) => {
      const adapter = new MockClearinghouseAdapter(options);
      await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps());
      return adapter.submitClaim({
        edi837p: 'ST*837*0001~SE*2*0001~',
        meta: {
          claimId: 'clm-0001',
          payerId: 'payer-0001',
          patientControlNumber: 'PCN0001',
          totalChargedMinorUnits: 24_500,
        },
      });
    },
  },
  {
    capability: 'labs',
    operation: 'placeOrder',
    run: async (options) => {
      const adapter = new MockLabsAdapter(options);
      await adapter.init(MOCK_CONFIGS.labs, createTestDeps());
      return adapter.placeOrder({
        orderId: 'ord-0001',
        patientRef: 'pat-0001',
        orderingProviderRef: 'usr-0001',
        testCode: '58410-2',
        testCodeSystem: 'http://loinc.org',
        priority: 'routine',
        reasonCodes: ['Z00.00'],
        aoeAnswers: [{ questionCode: 'fasting', answer: 'no' }],
        requestedAt: '2026-01-01T00:00:00.000Z',
      });
    },
  },
  {
    capability: 'payments',
    operation: 'authorize',
    run: async (options) => {
      const adapter = new MockPaymentsAdapter(options);
      await adapter.init(MOCK_CONFIGS.payments, createTestDeps());
      return adapter.authorize({
        idempotencyKey: 'idem-auth-0001',
        amountMinorUnits: 4500,
        currency: 'USD',
        cardReference: 'tok-synthetic-0001',
      });
    },
  },
  {
    capability: 'fax',
    operation: 'sendFax',
    run: async (options) => {
      const adapter = new MockFaxAdapter(options);
      await adapter.init(MOCK_CONFIGS.fax, createTestDeps());
      return adapter.sendFax({
        idempotencyKey: 'idem-fax-0001',
        toNumber: '+15550102222',
        documentRef: 'doc-0001',
        contentType: 'application/pdf',
        pageCount: 3,
      });
    },
  },
  {
    capability: 'sms',
    operation: 'sendMessage',
    run: async (options) => {
      const adapter = new MockSmsAdapter(options);
      await adapter.init(MOCK_CONFIGS.sms, createTestDeps());
      return adapter.sendMessage({
        idempotencyKey: 'idem-sms-0001',
        toNumber: '+15550103333',
        body: 'Reminder: your visit is tomorrow at 9am.',
        consentRef: 'consent-0001',
      });
    },
  },
  {
    capability: 'video',
    operation: 'createVisitRoom',
    run: async (options) => {
      const adapter = new MockVideoAdapter(options);
      await adapter.init(MOCK_CONFIGS.video, createTestDeps());
      return adapter.createVisitRoom({
        appointmentRef: 'appt-0001',
        scheduledStart: '2026-01-01T09:00:00.000Z',
        expectedMinutes: 20,
        waitingRoom: false,
      });
    },
  },
  {
    capability: 'address-verify',
    operation: 'verifyAddress',
    run: async (options) => {
      const adapter = new MockAddressVerifyAdapter(options);
      await adapter.init(MOCK_CONFIGS['address-verify'], createTestDeps());
      return adapter.verifyAddress({
        line1: '42 Invented Lane',
        city: 'Testville',
        state: 'ZZ',
        postalCode: '99001',
        countryCode: 'US',
      });
    },
  },
];

/**
 * Unwraps the success arm. The failure description is the serialised error,
 * which is safe precisely because no error type in this package carries a
 * payload.
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Unwraps the failure arm, failing the test if the call succeeded. */
export function expectErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error('expected failure, got success');
  }
  return result.error;
}

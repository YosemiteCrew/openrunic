import { ok } from '@openrunic/types';
import { describe, expect, it } from 'vitest';

import type { AdapterResult, CallbackRequest } from '../contracts/core.js';
import { CALLBACK_SIGNATURE_HEADER } from '../contracts/core.js';
import { ERX_CONTRACT } from '../contracts/erx.js';
import type { ErxConfig } from '../contracts/erx.js';
import {
  CALLBACK_SECRET,
  CREDENTIAL_REF,
  EPOCH_INSTANT,
  MOCK_CONFIGS,
  createTestDeps,
  expectErr,
  expectOk,
} from '../test-support/fixtures.js';
import { MockErxAdapter } from './erx.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase, signCallbackBody } from './harness.js';

/**
 * The lifecycle and inbound-verification paths every seam inherits. They are
 * tested once, here, because they are identical by construction and a per-seam
 * copy of these assertions would rot into eight slightly different contracts.
 */

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
  dispenseAsWritten: false,
  writtenAt: '2026-01-01T00:00:00.000Z',
} as const;

/** Reaches the base class directly, to drive paths no seam can reach through its own interface. */
class ProbeAdapter extends MockAdapterBase<ErxConfig> {
  constructor(options: MockAdapterOptions = {}) {
    super(ERX_CONTRACT, options);
  }

  callUndocumentedOperation(): Promise<AdapterResult<unknown>> {
    return this.runOperation<unknown>('notInTheContract', ['item-1'], () => ok({}));
  }
}

function signedCallback(body: string, secret = CALLBACK_SECRET): CallbackRequest {
  return {
    headers: { [CALLBACK_SIGNATURE_HEADER]: signCallbackBody(secret, body) },
    rawBody: body,
    receivedAt: EPOCH_INSTANT,
  };
}

const VALID_EVENT = JSON.stringify({
  eventId: 'evt-0001',
  eventType: 'prescription.filled',
  occurredAt: '2026-01-01T00:00:00.000Z',
  data: { transmissionRef: 'rx_0001' },
});

describe('initialisation', () => {
  it('refuses a config that does not match the seam schema, reporting paths only', async () => {
    const adapter = new MockErxAdapter();
    const error = expectErr(
      await adapter.init({ ...MOCK_CONFIGS.erx, timeoutMs: -1 }, createTestDeps())
    );
    expect(error).toMatchObject({ kind: 'misconfigured', reason: 'schema', operation: 'init' });
    expect(JSON.stringify(error)).not.toContain('secret://');
  });

  it('refuses to start when a referenced secret does not resolve', async () => {
    const adapter = new MockErxAdapter();
    expect(expectErr(await adapter.init(MOCK_CONFIGS.erx, createTestDeps({})))).toMatchObject({
      reason: 'secret_unresolved',
      issuePaths: ['credentialRef'],
    });

    const callbackless = new MockErxAdapter();
    expect(
      expectErr(
        await callbackless.init(
          MOCK_CONFIGS.erx,
          createTestDeps({ [CREDENTIAL_REF]: 'synthetic-credential' })
        )
      )
    ).toMatchObject({ reason: 'secret_unresolved', issuePaths: ['callbackSecretRef'] });
  });

  it('logs a coded start-up line and nothing else', async () => {
    const adapter = new MockErxAdapter();
    const deps = createTestDeps();
    expectOk(await adapter.init(MOCK_CONFIGS.erx, deps));
    expect(deps.logs).toStrictEqual([
      { level: 'info', code: 'adapter.initialized', capability: 'erx' },
    ]);
  });

  it('emits one domain event per successful operation, carrying no payload', async () => {
    const adapter = new MockErxAdapter();
    const deps = createTestDeps();
    expectOk(await adapter.init(MOCK_CONFIGS.erx, deps));
    expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    expect(deps.events).toHaveLength(1);
    expect(deps.events[0]?.type).toBe('erx.transmitPrescription.succeeded');
    expect(JSON.stringify(deps.events)).not.toContain('pat-0001');
  });

  it('refuses every operation until it has been initialised', async () => {
    const adapter = new MockErxAdapter();
    expect(expectErr(await adapter.transmitPrescription(PRESCRIPTION))).toMatchObject({
      kind: 'misconfigured',
      reason: 'not_initialized',
      operation: 'transmitPrescription',
    });
  });
});

describe('health', () => {
  it('says why it is not ready before initialisation, and stops saying so afterwards', async () => {
    const adapter = new MockErxAdapter();
    expect(await adapter.healthCheck()).toMatchObject({
      state: 'healthy',
      detail: 'not_initialized',
    });
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    expect(await adapter.healthCheck()).not.toHaveProperty('detail');
    expect(await adapter.descriptor.healthCheck()).toMatchObject({ state: 'healthy' });
  });

  it('turns every operation into a retryable unavailable error while it is down', async () => {
    const adapter = new MockErxAdapter({ health: 'unavailable' });
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    expect(expectErr(await adapter.transmitPrescription(PRESCRIPTION))).toMatchObject({
      kind: 'unavailable',
      retryable: true,
      retryAfterMs: 30_000,
    });
  });

  it('reports a degraded partner without refusing work', async () => {
    const adapter = new MockErxAdapter({ health: 'degraded' });
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    expect(await adapter.healthCheck()).toMatchObject({ state: 'degraded' });
    expectOk(await adapter.transmitPrescription(PRESCRIPTION));
  });
});

describe('inbound callbacks', () => {
  it('verifies a signed envelope and hands the body on unread', async () => {
    const adapter = new MockErxAdapter();
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    const verified = expectOk(adapter.verifyCallback(signedCallback(VALID_EVENT)));
    expect(verified).toMatchObject({
      capability: 'erx',
      vendorId: 'mock-erx',
      eventId: 'evt-0001',
      eventType: 'prescription.filled',
    });
    expect(verified.payload).toStrictEqual({ transmissionRef: 'rx_0001' });
  });

  it('refuses an unsigned, a short and a wrong signature alike', async () => {
    const adapter = new MockErxAdapter();
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    const unsigned: CallbackRequest = {
      headers: {},
      rawBody: VALID_EVENT,
      receivedAt: EPOCH_INSTANT,
    };
    expect(expectErr(adapter.verifyCallback(unsigned))).toMatchObject({
      kind: 'unauthorized',
      reason: 'bad_signature',
    });
    expect(
      expectErr(
        adapter.verifyCallback({ ...unsigned, headers: { [CALLBACK_SIGNATURE_HEADER]: 'short' } })
      )
    ).toMatchObject({ kind: 'unauthorized' });
    expect(
      expectErr(adapter.verifyCallback(signedCallback(VALID_EVENT, 'the-wrong-secret')))
    ).toMatchObject({ kind: 'unauthorized' });
  });

  it('rejects a body that is not JSON, and one that is not an envelope', async () => {
    const adapter = new MockErxAdapter();
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    expect(expectErr(adapter.verifyCallback(signedCallback('not json at all')))).toMatchObject({
      kind: 'malformed_response',
      issuePaths: ['$'],
    });
    const wrongShape = expectErr(
      adapter.verifyCallback(signedCallback(JSON.stringify({ eventId: 'evt-1' })))
    );
    expect(wrongShape).toMatchObject({ kind: 'malformed_response' });
    expect(JSON.stringify(wrongShape)).not.toContain('evt-1');
  });

  it('refuses to verify before initialisation, and without a callback secret', async () => {
    const uninitialised = new MockErxAdapter();
    expect(expectErr(uninitialised.verifyCallback(signedCallback(VALID_EVENT)))).toMatchObject({
      reason: 'not_initialized',
    });

    const noCallbackSecret = new MockErxAdapter();
    const withoutCallback: ErxConfig = {
      vendorId: MOCK_CONFIGS.erx.vendorId,
      environment: MOCK_CONFIGS.erx.environment,
      credentialRef: MOCK_CONFIGS.erx.credentialRef,
      timeoutMs: MOCK_CONFIGS.erx.timeoutMs,
      networkAccountId: MOCK_CONFIGS.erx.networkAccountId,
      epcs: MOCK_CONFIGS.erx.epcs,
    };
    expectOk(await noCallbackSecret.init(withoutCallback, createTestDeps()));
    expect(expectErr(noCallbackSecret.verifyCallback(signedCallback(VALID_EVENT)))).toMatchObject({
      reason: 'secret_unresolved',
      issuePaths: ['callbackSecretRef'],
    });
  });
});

describe('undocumented operations', () => {
  it('refuses an operation the contract does not name, rather than running it unvalidated', async () => {
    const probe = new ProbeAdapter();
    expectOk(await probe.init(MOCK_CONFIGS.erx, createTestDeps()));
    expect(expectErr(await probe.callUndocumentedOperation())).toMatchObject({
      kind: 'unsupported_operation',
      feature: 'notInTheContract',
    });
  });
});

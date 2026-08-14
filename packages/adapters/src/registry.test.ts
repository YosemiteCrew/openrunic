import { describe, expect, it } from 'vitest';

import { CALLBACK_SIGNATURE_HEADER } from './contracts/core.js';
import type { ErxAdapter } from './contracts/erx.js';
import { MockErxAdapter } from './mocks/erx.js';
import { MOCK_EPOCH, signCallbackBody } from './mocks/harness.js';
import { createMockAdapter } from './mocks/index.js';
import { MockPaymentsAdapter } from './mocks/payments.js';
import { MockSmsAdapter } from './mocks/sms.js';
import type { AdapterCallRecord } from './registry.js';
import { AdapterRegistry } from './registry.js';
import {
  CALLBACK_SECRET,
  EPOCH_INSTANT,
  MOCK_CONFIGS,
  createTestDeps,
  expectErr,
  expectOk,
} from './test-support/fixtures.js';

/**
 * The registry is the only door to a partner, so it is the only place that can
 * promise version compatibility and a complete call record. Both promises are
 * asserted here, and the last test in this file is the one that matters most:
 * a call record may never contain a payload.
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
  writtenAt: MOCK_EPOCH,
} as const;

function createRegistry(records: AdapterCallRecord[]): AdapterRegistry {
  let tick = 0;
  let correlation = 0;
  return new AdapterRegistry({
    clock: () => new Date(Date.parse(MOCK_EPOCH) + tick++ * 5),
    record: (record) => records.push(record),
    correlationId: () => {
      correlation += 1;
      return `corr-${String(correlation)}`;
    },
  });
}

/** A hand-written adapter that delegates to a mock, so its descriptor can lie about its version. */
function delegatingErx(contractVersion: string, base = new MockErxAdapter()): ErxAdapter {
  return {
    descriptor: { ...base.descriptor, contractVersion },
    init: (config, deps) => base.init(config, deps),
    healthCheck: () => base.healthCheck(),
    verifyCallback: (request) => base.verifyCallback(request),
    transmitPrescription: (input) => base.transmitPrescription(input),
    checkFormulary: (input) => base.checkFormulary(input),
    getTransmissionStatus: (input) => base.getTransmissionStatus(input),
    cancelPrescription: (input) => base.cancelPrescription(input),
  };
}

describe('resolution', () => {
  it('returns the adapter it was given, typed as its own seam', async () => {
    const registry = new AdapterRegistry();
    const descriptor = expectOk(registry.register('erx', new MockErxAdapter()));
    expect(descriptor.capability).toBe('erx');

    const resolved = expectOk(registry.resolve('erx'));
    expectOk(await resolved.init(MOCK_CONFIGS.erx, createTestDeps()));
    expect(expectOk(await resolved.transmitPrescription(PRESCRIPTION)).status).toBe('queued');
  });

  it('reports an unregistered capability as a typed error rather than undefined', () => {
    const registry = new AdapterRegistry();
    expect(expectErr(registry.resolve('labs'))).toStrictEqual({
      kind: 'not_registered',
      capability: 'labs',
    });
  });

  it('refuses a second adapter for the same seam, naming the incumbent', () => {
    const registry = new AdapterRegistry();
    expectOk(registry.register('erx', new MockErxAdapter({ vendorId: 'first-erx' })));
    expect(expectErr(registry.register('erx', new MockErxAdapter()))).toStrictEqual({
      kind: 'already_registered',
      capability: 'erx',
      vendorId: 'first-erx',
    });
  });

  it('lists what the installation can do without calling anyone', () => {
    const registry = new AdapterRegistry();
    expectOk(registry.register('erx', new MockErxAdapter()));
    expectOk(registry.register('sms', new MockSmsAdapter()));
    expect(registry.descriptors().map((descriptor) => descriptor.capability)).toStrictEqual([
      'erx',
      'sms',
    ]);
    expect(registry.unregister('erx')).toBe(true);
    expect(registry.unregister('erx')).toBe(false);
    expect(registry.descriptors()).toHaveLength(1);
  });
});

describe('version compatibility', () => {
  it('accepts a higher minor, because a minor may only add', () => {
    const registry = new AdapterRegistry();
    expectOk(registry.register('erx', delegatingErx('1.9.3')));
  });

  it('accepts a lower minor, because everything we call is still there', () => {
    const registry = new AdapterRegistry({ requiredVersions: { erx: '1.4.0' } });
    expect(registry.requiredVersion('erx')).toBe('1.4.0');
    expectOk(registry.register('erx', delegatingErx('1.0.0')));
  });

  it('refuses a different major, and the seam then resolves to nothing', () => {
    const registry = new AdapterRegistry();
    expect(expectErr(registry.register('erx', delegatingErx('2.0.0')))).toStrictEqual({
      kind: 'incompatible_version',
      capability: 'erx',
      required: '1.0.0',
      offered: '2.0.0',
    });
    expect(expectErr(registry.resolve('erx')).kind).toBe('not_registered');
  });

  it('refuses a version string that is not a bare triple, on either side', () => {
    const registry = new AdapterRegistry();
    expect(expectErr(registry.register('erx', delegatingErx('v1.0')))).toStrictEqual({
      kind: 'malformed_version',
      capability: 'erx',
      side: 'offered',
      version: 'v1.0',
    });

    const misconfigured = new AdapterRegistry({ requiredVersions: { erx: 'one point oh' } });
    expect(expectErr(misconfigured.register('erx', new MockErxAdapter()))).toMatchObject({
      kind: 'malformed_version',
      side: 'required',
    });
  });

  it('refuses an adapter that does not implement every operation the contract names', () => {
    const registry = new AdapterRegistry();
    const base = new MockErxAdapter();
    const partial = {
      descriptor: base.descriptor,
      init: (config: Parameters<ErxAdapter['init']>[0], deps: Parameters<ErxAdapter['init']>[1]) =>
        base.init(config, deps),
      healthCheck: () => base.healthCheck(),
      transmitPrescription: (input: Parameters<ErxAdapter['transmitPrescription']>[0]) =>
        base.transmitPrescription(input),
    } as unknown as ErxAdapter;
    expect(expectErr(registry.register('erx', partial))).toStrictEqual({
      kind: 'incomplete_adapter',
      capability: 'erx',
      missing: ['checkFormulary', 'getTransmissionStatus', 'cancelPrescription', 'verifyCallback'],
    });
  });
});

describe('call recording', () => {
  it('records lifecycle, inbound verification and every operation, without being asked', async () => {
    const records: AdapterCallRecord[] = [];
    const registry = createRegistry(records);
    expectOk(registry.register('erx', new MockErxAdapter()));
    const adapter = expectOk(registry.resolve('erx'));

    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    await adapter.healthCheck();
    const body = JSON.stringify({
      eventId: 'evt-0001',
      eventType: 'prescription.filled',
      occurredAt: MOCK_EPOCH,
    });
    expectOk(
      adapter.verifyCallback({
        headers: { [CALLBACK_SIGNATURE_HEADER]: signCallbackBody(CALLBACK_SECRET, body) },
        rawBody: body,
        receivedAt: EPOCH_INSTANT,
      })
    );
    expectOk(await adapter.transmitPrescription(PRESCRIPTION));

    expect(records.map((record) => record.operation)).toStrictEqual([
      'init',
      'healthCheck',
      'verifyCallback',
      'transmitPrescription',
    ]);
    expect(records.every((record) => record.outcome === 'success')).toBe(true);
    expect(records[0]).toMatchObject({
      capability: 'erx',
      vendorId: 'mock-erx',
      contractVersion: '1.0.0',
      startedAt: MOCK_EPOCH,
      durationMs: 5,
      correlationId: 'corr-1',
    });
    expect(records.map((record) => record.correlationId)).toStrictEqual([
      'corr-1',
      'corr-2',
      'corr-3',
      'corr-4',
    ]);
  });

  it('records the coded error kind, never the error body', async () => {
    const records: AdapterCallRecord[] = [];
    const registry = createRegistry(records);
    expectOk(
      registry.register(
        'erx',
        new MockErxAdapter({ failures: [{ mode: 'rejection', reasonCode: 'payer_unreachable' }] })
      )
    );
    const adapter = expectOk(registry.resolve('erx'));
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    expectErr(await adapter.transmitPrescription(PRESCRIPTION));

    expect(records[1]).toMatchObject({ outcome: 'error', errorKind: 'rejected' });
    expect(JSON.stringify(records)).not.toContain('payer_unreachable');
  });

  it('records a call that threw, and lets the failure through untouched', async () => {
    const records: AdapterCallRecord[] = [];
    const registry = createRegistry(records);
    const broken: ErxAdapter = {
      ...delegatingErx('1.0.0'),
      transmitPrescription: () => Promise.reject(new Error('partner connection reset')),
    };
    expectOk(registry.register('erx', broken));
    const adapter = expectOk(registry.resolve('erx'));
    await expect(adapter.transmitPrescription(PRESCRIPTION)).rejects.toThrow(
      'partner connection reset'
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: 'error', operation: 'transmitPrescription' });
    expect(records[0]).not.toHaveProperty('errorKind');
  });

  it('discards records by default, so a registry is safe to build in a unit test', async () => {
    const registry = new AdapterRegistry();
    expectOk(registry.register('erx', new MockErxAdapter()));
    const adapter = expectOk(registry.resolve('erx'));
    expectOk(await adapter.init(MOCK_CONFIGS.erx, createTestDeps()));
    expectOk(await adapter.transmitPrescription(PRESCRIPTION));
  });
});

describe('call records never carry a payload', () => {
  /**
   * Values chosen to be unmistakable if they ever appear in a log. All invented.
   *
   * Deliberately worded as prose rather than shaped like the credentials they
   * stand in for. The earlier spelling - `tok-...` and `consent-...` followed by
   * digits - was the format a real card token takes, and secret scanners read
   * format and entropy rather than meaning, so every scan of this repository
   * reported two leaked secrets in a test whose entire purpose is proving
   * secrets do not leak. That is the worst possible place for a false positive:
   * it trains the reader to wave through exactly the file where a real
   * credential is most likely to be pasted by accident.
   *
   * A canary needs to be unique and greppable, not plausible. These are both,
   * and no detector can mistake them for anything issued by a payment processor.
   */
  const SENSITIVE = {
    patientName: 'Testina Patientsson',
    memberId: 'MEMBER-8827-SENSITIVE',
    messageBody: 'Testina Patientsson, your biopsy result is ready to discuss.',
    cardToken: 'invented-card-token-that-must-never-be-logged',
    consentRef: 'invented-consent-reference-that-must-never-be-logged',
    sigText: 'Take one tablet by mouth twice daily for anxiety',
  } as const;

  it('drives obviously sensitive values through three seams and finds none of them in the stream', async () => {
    const records: AdapterCallRecord[] = [];
    const registry = createRegistry(records);
    expectOk(registry.register('erx', new MockErxAdapter()));
    expectOk(registry.register('sms', new MockSmsAdapter()));
    expectOk(registry.register('payments', new MockPaymentsAdapter()));

    const erx = expectOk(registry.resolve('erx'));
    expectOk(await erx.init(MOCK_CONFIGS.erx, createTestDeps()));
    expectOk(
      await erx.transmitPrescription({
        ...PRESCRIPTION,
        patientRef: SENSITIVE.patientName,
        sigText: SENSITIVE.sigText,
      })
    );

    const sms = expectOk(registry.resolve('sms'));
    expectOk(await sms.init(MOCK_CONFIGS.sms, createTestDeps()));
    expectOk(
      await sms.sendMessage({
        idempotencyKey: 'idem-sms-0001',
        toNumber: '+15550104444',
        body: SENSITIVE.messageBody,
        consentRef: SENSITIVE.consentRef,
      })
    );

    const payments = expectOk(registry.resolve('payments'));
    expectOk(await payments.init(MOCK_CONFIGS.payments, createTestDeps()));
    const authorization = expectOk(
      await payments.authorize({
        idempotencyKey: 'idem-auth-0001',
        amountMinorUnits: 4500,
        currency: 'USD',
        cardReference: SENSITIVE.cardToken,
        patientRef: SENSITIVE.memberId,
      })
    );
    expectErr(
      await payments.capture({
        authorizationRef: 'auth_missing',
        amountMinorUnits: 4500,
        idempotencyKey: 'idem-cap-0001',
      })
    );

    expect(authorization.status).toBe('authorized');
    expect(records).toHaveLength(7);

    const stream = JSON.stringify(records);
    for (const value of Object.values(SENSITIVE)) {
      expect(stream, `record stream leaked ${value}`).not.toContain(value);
    }
    // The record's whole vocabulary: coded identifiers, timings, outcomes.
    for (const record of records) {
      expect(Object.keys(record).sort()).toStrictEqual(
        record.outcome === 'error'
          ? [
              'capability',
              'contractVersion',
              'correlationId',
              'durationMs',
              'errorKind',
              'operation',
              'outcome',
              'startedAt',
              'vendorId',
            ]
          : [
              'capability',
              'contractVersion',
              'correlationId',
              'durationMs',
              'operation',
              'outcome',
              'startedAt',
              'vendorId',
            ]
      );
    }
  });

  it('records the same fields for every seam the factory can build', async () => {
    const records: AdapterCallRecord[] = [];
    const registry = createRegistry(records);
    expectOk(registry.register('labs', createMockAdapter('labs')));
    const labs = expectOk(registry.resolve('labs'));
    expectOk(await labs.init(MOCK_CONFIGS.labs, createTestDeps()));
    expect(records[0]?.capability).toBe('labs');
  });
});

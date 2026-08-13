import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AdapterCallSite, AdapterError, Capability } from './core.js';
import {
  ADAPTER_ERROR_KINDS,
  CAPABILITIES,
  adapterConfigBase,
  callbackEnvelope,
  describeAdapterError,
  isCapability,
  isMajorCompatible,
  isoDateTime,
  isoDateTimeOf,
  malformedResponseError,
  misconfiguredError,
  moneyMinorUnits,
  opaqueRef,
  parseContractVersion,
  partialError,
  rejectedError,
  supportsFeature,
  timeoutError,
  unauthorizedError,
  unavailableError,
  unsupportedOperationError,
  zodIssuePaths,
} from './core.js';
import { CONTRACTS } from './index.js';

const site: AdapterCallSite = { capability: 'erx', operation: 'transmitPrescription' };

describe('capabilities', () => {
  it('names eight seams and guards the name at a boundary', () => {
    expect(CAPABILITIES).toHaveLength(8);
    expect(isCapability('clearinghouse')).toBe(true);
    expect(isCapability('billing')).toBe(false);
  });

  it('answers feature questions from the descriptor rather than from a vendor id', () => {
    expect(supportsFeature({ supports: ['epcs', 'cancel'] }, 'cancel')).toBe(true);
    expect(supportsFeature({ supports: ['epcs'] }, 'cancel')).toBe(false);
  });
});

describe('adapter errors', () => {
  it('marks only the failures a retry could clear as retryable', () => {
    expect(timeoutError(site, 15_000).retryable).toBe(true);
    expect(unavailableError(site, 30_000).retryable).toBe(true);
    expect(rejectedError(site, 'payer_unreachable').retryable).toBe(false);
    expect(misconfiguredError(site, 'not_initialized').retryable).toBe(false);
  });

  it('derives partial counts from the outcome list so the two cannot disagree', () => {
    const error = partialError(site, [
      { itemRef: 'rx-1', accepted: true },
      { itemRef: 'rx-2', accepted: false, reasonCode: 'invalid_identifier' },
      { itemRef: 'rx-3', accepted: false, reasonCode: 'invalid_identifier' },
    ]);
    expect(error.acceptedCount).toBe(1);
    expect(error.rejectedCount).toBe(2);
  });

  it('omits the backoff hint when the partner did not offer one', () => {
    expect(unavailableError(site)).not.toHaveProperty('retryAfterMs');
    expect(unavailableError(site, 5_000).retryAfterMs).toBe(5_000);
  });

  it('counts schema issues without carrying their values', () => {
    const error = malformedResponseError(site, ['status', 'items.0.amount']);
    expect(error.issueCount).toBe(2);
    expect(error.issuePaths).toStrictEqual(['status', 'items.0.amount']);
  });

  it('describes every kind from coded fields alone', () => {
    const errors: AdapterError[] = [
      timeoutError(site, 15_000),
      rejectedError(site, 'duplicate_submission'),
      partialError(site, [
        { itemRef: 'a', accepted: true },
        { itemRef: 'b', accepted: false },
      ]),
      malformedResponseError(site, ['status']),
      unauthorizedError(site, 'credentials_rejected'),
      unsupportedOperationError(site, 'cancel'),
      unavailableError(site),
      misconfiguredError(site, 'schema', ['timeoutMs']),
    ];
    const described = errors.map((error) => describeAdapterError(error));
    expect(errors.map((error) => error.kind)).toStrictEqual([...ADAPTER_ERROR_KINDS]);
    expect(described).toStrictEqual([
      'erx.transmitPrescription: timeout after 15000ms',
      'erx.transmitPrescription: rejected (duplicate_submission)',
      'erx.transmitPrescription: partial (1 accepted, 1 rejected)',
      'erx.transmitPrescription: malformed_response (1 issues)',
      'erx.transmitPrescription: unauthorized (credentials_rejected)',
      'erx.transmitPrescription: unsupported_operation (cancel)',
      'erx.transmitPrescription: unavailable',
      'erx.transmitPrescription: misconfigured (schema)',
    ]);
  });
});

describe('schema issue paths', () => {
  it('reports dotted paths and never the offending value', () => {
    const schema = z.strictObject({
      status: z.enum(['a']),
      items: z.array(z.strictObject({ amount: z.int() })),
    });
    const result = schema.safeParse({
      status: 'leaked-secret-value',
      items: [{ amount: 'leaked-secret-value' }],
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const paths = zodIssuePaths(result.error);
    expect(paths).toStrictEqual(['status', 'items.0.amount']);
    expect(JSON.stringify(paths)).not.toContain('leaked-secret-value');
  });

  it('reports a top-level issue as a dollar sign', () => {
    const result = z.strictObject({ a: z.string() }).safeParse({ a: 'x', unexpected: 1 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(zodIssuePaths(result.error)).toStrictEqual(['$']);
  });
});

describe('contract versions', () => {
  it('parses a bare semver triple', () => {
    expect(parseContractVersion('1.2.3')).toStrictEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('refuses anything that is not a bare triple', () => {
    for (const version of ['1.0', '1.0.0-rc.1', 'v1.0.0', '01.0.0', '', '1.0.0+build']) {
      expect(parseContractVersion(version)).toBeUndefined();
    }
  });

  it('compares on the major only', () => {
    const required = { major: 1, minor: 2, patch: 0 };
    expect(isMajorCompatible(required, { major: 1, minor: 9, patch: 4 })).toBe(true);
    expect(isMajorCompatible(required, { major: 1, minor: 0, patch: 0 })).toBe(true);
    expect(isMajorCompatible(required, { major: 2, minor: 0, patch: 0 })).toBe(false);
  });
});

describe('shared schemas', () => {
  it('brands an instant without a runtime check', () => {
    expect(isoDateTimeOf(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
    expect(isoDateTime.safeParse('2026-01-01T00:00:00+02:00').success).toBe(true);
    expect(isoDateTime.safeParse('2026-01-01').success).toBe(false);
  });

  it('keeps money in integer minor units and references opaque', () => {
    expect(moneyMinorUnits.safeParse(2450).success).toBe(true);
    expect(moneyMinorUnits.safeParse(24.5).success).toBe(false);
    expect(moneyMinorUnits.safeParse(-1).success).toBe(false);
    expect(opaqueRef.safeParse('').success).toBe(false);
    expect(opaqueRef.safeParse('sub_0a1b').success).toBe(true);
  });

  it('accepts a config that references secrets and refuses one that inlines a key', () => {
    const config = {
      vendorId: 'mock-vendor',
      environment: 'sandbox',
      credentialRef: 'secret://partner-credential',
      timeoutMs: 15_000,
    };
    expect(adapterConfigBase.safeParse(config).success).toBe(true);
    expect(adapterConfigBase.safeParse({ ...config, apiKey: 'inline' }).success).toBe(false);
    expect(adapterConfigBase.safeParse({ ...config, timeoutMs: 0 }).success).toBe(false);
  });

  it('requires an idempotency key and a type on every callback', () => {
    expect(
      callbackEnvelope.safeParse({
        eventId: 'evt-1',
        eventType: 'prescription.filled',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      callbackEnvelope.safeParse({ eventType: 'x', occurredAt: '2026-01-01T00:00:00.000Z' }).success
    ).toBe(false);
  });
});

describe('contract registry', () => {
  it('registers every capability exactly once, under its own name', () => {
    expect(Object.keys(CONTRACTS)).toStrictEqual([...CAPABILITIES]);
    for (const capability of CAPABILITIES) {
      const contract = CONTRACTS[capability];
      expect(contract.capability).toBe(capability);
      expect(parseContractVersion(contract.contractVersion)).toBeDefined();
      expect(Object.keys(contract.operations).length).toBeGreaterThan(0);
      expect(new Set(contract.features).size).toBe(contract.features.length);
    }
  });

  it('refuses an unrecognised key in every operation output, which is what makes corruption detectable', () => {
    for (const capability of CAPABILITIES) {
      for (const [operation, schema] of Object.entries(CONTRACTS[capability].operations)) {
        const result = schema.output.safeParse({ corrupted: true });
        expect(result.success, `${capability}.${operation} accepted a corrupt payload`).toBe(false);
      }
    }
  });

  it('keeps the capability union and the contract map in step', () => {
    const capabilities: readonly Capability[] = CAPABILITIES;
    expect(capabilities.every((capability) => capability in CONTRACTS)).toBe(true);
  });
});

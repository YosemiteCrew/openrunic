import { describe, expect, it } from 'vitest';

import { CAPABILITIES } from '../contracts/core.js';
import { CONTRACTS } from '../contracts/index.js';
import { MOCK_CONFIGS, createTestDeps, expectOk } from '../test-support/fixtures.js';
import { MockClearinghouseAdapter } from './clearinghouse.js';
import { MockErxAdapter } from './erx.js';
import { MOCK_EPOCH } from './harness.js';
import { createMockAdapter } from './index.js';
import { mulberry32, randomHex, randomInt, randomPick } from './random.js';

/**
 * Determinism is the property the whole mock layer is built on: a demo script,
 * a CI seam loop and a developer's laptop must all see the same fixtures, or
 * the fixtures cannot be asserted on.
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

const CLAIM = {
  edi837p: 'ST*837*0001~SE*2*0001~',
  meta: {
    claimId: 'clm-0001',
    payerId: 'payer-0001',
    patientControlNumber: 'PCN0001',
    totalChargedMinorUnits: 24_500,
  },
} as const;

async function erxScript(seed: number): Promise<unknown[]> {
  const adapter = new MockErxAdapter({ seed });
  await adapter.init(MOCK_CONFIGS.erx, createTestDeps());
  const receipt = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
  const status = await adapter.getTransmissionStatus({ transmissionRef: receipt.transmissionRef });
  const formulary = await adapter.checkFormulary({
    patientRef: 'pat-0001',
    coverageRef: 'cov-0001',
    drugCode: '1049502',
    drugCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  });
  return [receipt, status, formulary];
}

async function claimScript(seed: number): Promise<unknown[]> {
  const adapter = new MockClearinghouseAdapter({ seed });
  await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps());
  const receipt = await adapter.submitClaim(CLAIM);
  const acks = await adapter.fetchAcknowledgements({ since: MOCK_EPOCH });
  const remittances = await adapter.fetchRemittances({ since: MOCK_EPOCH });
  return [receipt, acks, remittances];
}

describe('deterministic mocks', () => {
  it('replays the same call sequence identically for the same seed', async () => {
    expect(await erxScript(7)).toStrictEqual(await erxScript(7));
    expect(await claimScript(7)).toStrictEqual(await claimScript(7));
  });

  it('produces different references for a different seed', async () => {
    expect(await erxScript(7)).not.toStrictEqual(await erxScript(8));
  });

  it('starts from a fixed epoch and never reads the system clock', async () => {
    const adapter = new MockErxAdapter();
    await adapter.init(MOCK_CONFIGS.erx, createTestDeps());
    const receipt = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    expect(receipt.acceptedAt).toBe(MOCK_EPOCH);
  });

  it('honours an injected clock, so a fixture can pin its own timestamps', async () => {
    const adapter = new MockErxAdapter({ clock: () => new Date('2030-06-01T12:00:00.000Z') });
    await adapter.init(MOCK_CONFIGS.erx, createTestDeps());
    const receipt = expectOk(await adapter.transmitPrescription(PRESCRIPTION));
    expect(receipt.acceptedAt).toBe('2030-06-01T12:00:00.000Z');
  });

  it('names the vendor and the supported features it was built with', async () => {
    const adapter = new MockErxAdapter({ vendorId: 'demo-erx', displayName: 'Placeholder eRx' });
    await adapter.init(MOCK_CONFIGS.erx, createTestDeps());
    expect(adapter.descriptor).toMatchObject({
      vendorId: 'demo-erx',
      displayName: 'Placeholder eRx',
      supports: CONTRACTS.erx.features,
    });
  });
});

describe('mock factory', () => {
  it('builds every seam, each describing itself as its own capability', () => {
    for (const capability of CAPABILITIES) {
      const adapter = createMockAdapter(capability, { seed: 1 });
      expect(adapter.descriptor.capability).toBe(capability);
      expect(adapter.descriptor.contractVersion).toBe(CONTRACTS[capability].contractVersion);
      expect(adapter.descriptor.vendorId).toBe(`mock-${capability}`);
    }
  });
});

describe('seeded generator', () => {
  it('replays a stream from a seed and diverges from a different one', () => {
    const first = Array.from({ length: 5 }, mulberry32(42));
    const second = Array.from({ length: 5 }, mulberry32(42));
    const other = Array.from({ length: 5 }, mulberry32(43));
    expect(first).toStrictEqual(second);
    expect(first).not.toStrictEqual(other);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('mints hex of the requested length and picks from a non-empty catalogue', () => {
    const next = mulberry32(1);
    expect(randomHex(next, 12)).toHaveLength(12);
    expect(randomHex(next, 3)).toMatch(/^[0-9a-f]{3}$/);
    expect(['a', 'b', 'c']).toContain(randomPick(mulberry32(2), ['a', 'b', 'c']));
    expect(randomInt(mulberry32(3), 5)).toBeLessThan(5);
  });
});

import { describe, expect, it } from 'vitest';

import { MOCK_CONFIGS, SEAM_CASES, createTestDeps, expectErr } from '../test-support/fixtures.js';
import { MockClearinghouseAdapter } from './clearinghouse.js';
import { MockErxAdapter } from './erx.js';
import { FAILURE_MODES } from './harness.js';

/**
 * Failure injection is the reason these mocks exist, so it is tested as a table
 * across all eight seams: every mode must surface as its documented error
 * variant everywhere, or a service that handles timeouts correctly at one seam
 * will silently mishandle them at another.
 */

const EPOCH = '2026-01-01T00:00:00.000Z';

const CLAIM = {
  edi837p: 'ST*837*0001~SE*2*0001~',
  meta: {
    claimId: 'clm-0001',
    payerId: 'payer-0001',
    patientControlNumber: 'PCN0001',
    totalChargedMinorUnits: 24_500,
  },
} as const;

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
  writtenAt: EPOCH,
} as const;

describe('every mode maps onto its documented error at every seam', () => {
  it('covers the whole catalogue', () => {
    expect(FAILURE_MODES).toStrictEqual([
      'timeout',
      'rejection',
      'partial_success',
      'malformed_response',
    ]);
    expect(SEAM_CASES).toHaveLength(8);
  });

  for (const seam of SEAM_CASES) {
    describe(seam.capability, () => {
      it('reports an injected timeout as a retryable timeout carrying the configured budget', async () => {
        const error = expectErr(await seam.run({ failures: [{ mode: 'timeout' }] }));
        expect(error).toMatchObject({
          kind: 'timeout',
          capability: seam.capability,
          operation: seam.operation,
          retryable: true,
          elapsedMs: 15_000,
        });
      });

      it('reports an injected rejection with the partner reason code', async () => {
        const error = expectErr(
          await seam.run({ failures: [{ mode: 'rejection', reasonCode: 'payer_unreachable' }] })
        );
        expect(error).toMatchObject({
          kind: 'rejected',
          capability: seam.capability,
          operation: seam.operation,
          retryable: false,
          reasonCode: 'payer_unreachable',
        });
      });

      it('reports an injected partial success as a per-item verdict list', async () => {
        const error = expectErr(await seam.run({ failures: [{ mode: 'partial_success' }] }));
        expect(error).toMatchObject({ kind: 'partial', capability: seam.capability });
        if (error.kind !== 'partial') {
          return;
        }
        expect(error.outcomes).toHaveLength(1);
        expect(error.acceptedCount + error.rejectedCount).toBe(error.outcomes.length);
        expect(error.outcomes[0]?.reasonCode).toBe('item_rejected');
      });

      it('catches an injected malformed payload at the seam, reporting paths only', async () => {
        const error = expectErr(await seam.run({ failures: [{ mode: 'malformed_response' }] }));
        expect(error).toMatchObject({
          kind: 'malformed_response',
          capability: seam.capability,
          operation: seam.operation,
          retryable: false,
        });
        if (error.kind !== 'malformed_response') {
          return;
        }
        expect(error.issueCount).toBeGreaterThan(0);
        expect(error.issuePaths).toContain('$');
      });
    });
  }
});

describe('targeting', () => {
  it('rejects only the nominated call, and lets the others through', async () => {
    const adapter = new MockClearinghouseAdapter({
      failures: [{ mode: 'rejection', operation: 'submitClaim', callIndex: 3 }],
    });
    await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps());
    expect((await adapter.submitClaim(CLAIM)).ok).toBe(true);
    expect((await adapter.submitClaim(CLAIM)).ok).toBe(true);
    expect(expectErr(await adapter.submitClaim(CLAIM))).toMatchObject({ kind: 'rejected' });
    expect((await adapter.submitClaim(CLAIM)).ok).toBe(true);
  });

  it('counts calls per operation, so a rule aimed elsewhere never fires', async () => {
    const adapter = new MockClearinghouseAdapter({
      failures: [{ mode: 'timeout', operation: 'fetchRemittances', callIndex: 2 }],
    });
    await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps());
    expect((await adapter.submitClaim(CLAIM)).ok).toBe(true);
    expect((await adapter.submitClaim(CLAIM)).ok).toBe(true);
    expect((await adapter.fetchRemittances({ since: EPOCH })).ok).toBe(true);
    expect(expectErr(await adapter.fetchRemittances({ since: EPOCH }))).toMatchObject({
      kind: 'timeout',
    });
  });

  it('invents a partner reason code when the rule does not name one', async () => {
    const adapter = new MockErxAdapter({ failures: [{ mode: 'rejection' }] });
    await adapter.init(MOCK_CONFIGS.erx, createTestDeps());
    const error = expectErr(await adapter.transmitPrescription(PRESCRIPTION));
    expect(error).toMatchObject({ kind: 'rejected' });
    if (error.kind !== 'rejected') {
      return;
    }
    expect(error.reasonCode.length).toBeGreaterThan(0);
  });

  it('accepts the first item of a batch and refuses the rest', async () => {
    const adapter = new MockClearinghouseAdapter({
      failures: [{ mode: 'partial_success', operation: 'fetchAcknowledgements' }],
    });
    await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps());
    await adapter.submitClaim(CLAIM);
    await adapter.submitClaim(CLAIM);
    await adapter.submitClaim(CLAIM);
    const error = expectErr(await adapter.fetchAcknowledgements({ since: EPOCH }));
    expect(error.kind).toBe('partial');
    if (error.kind !== 'partial') {
      return;
    }
    expect(error.outcomes).toHaveLength(3);
    expect(error.acceptedCount).toBe(1);
    expect(error.rejectedCount).toBe(2);
    expect(error.outcomes[0]).toStrictEqual({
      itemRef: error.outcomes[0]?.itemRef,
      accepted: true,
    });
    expect(error.outcomes[1]?.accepted).toBe(false);
  });

  it('leaves state untouched when the call never reached the partner', async () => {
    const adapter = new MockClearinghouseAdapter({
      failures: [{ mode: 'timeout', operation: 'submitClaim', callIndex: 1 }],
    });
    await adapter.init(MOCK_CONFIGS.clearinghouse, createTestDeps());
    expect(expectErr(await adapter.submitClaim(CLAIM)).kind).toBe('timeout');
    const acks = await adapter.fetchAcknowledgements({ since: EPOCH });
    expect(acks.ok && acks.value.acknowledgements).toStrictEqual([]);
  });
});

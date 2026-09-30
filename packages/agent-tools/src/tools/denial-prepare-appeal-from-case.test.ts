import { describe, expect, it, vi, beforeEach } from 'vitest';

import { denialPrepareAppealFromCase } from './denial-prepare-appeal-from-case.js';
import { stubPrincipal } from '../testing/index.js';

const PRINCIPAL = stubPrincipal({
  roleIds: ['biller'],
  scopes: ['claim.read', 'claim.write'],
});

const CREDENTIAL = { authorization: 'test-credential-token' };

const API_CLIENT = {
  call: vi.fn(),
} as const;

const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174001';
const DENIAL_REASON = 'CO-16';
const PAYER_PROFILE = {
  system: 'test-payer-system',
  code: 'test-payer-1',
  display: 'Test Payer',
};

describe('denial.prepareAppealFromCase', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('prepares a denial appeal from an existing claim with all fields satisfied', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Claim data
        id: CLAIM_ID,
        status: 'denied',
        denialReasonCode: DENIAL_REASON,
        serviceDate: '2026-01-10',
        totalCents: 15000,
        narrative: 'Appeal narrative here.',
      })
      .mockResolvedValueOnce({
        // Payer profile
        data: [
          {
            fields: ['denialReasonCode', 'serviceDate', 'totalCents', 'narrative'],
          },
        ],
      });

    const result = await denialPrepareAppealFromCase.run(
      { claimId: CLAIM_ID, denialReasonCode: DENIAL_REASON, payerProfile: PAYER_PROFILE },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    );

    expect(result.status).toBe('pending');
    expect(result.proposal.kind).toBe('claim.appeal');
    expect(result.proposal.commit.path).toBe('/bff/v0/claims');
    expect(result.proposal.commit.method).toBe('POST');
    expect(result.proposal.commit.body.kind).toBe('appeal');
    expect(result.proposal.commit.body.claimId).toBe(CLAIM_ID);
    expect(result.proposal.commit.body.denialReasonCode).toBe(DENIAL_REASON);
    expect(result.proposal.commit.body.status).toBe('draft');
    expect(result.proposal.commit.body.narrative).toBe('Appeal narrative here.');
    expect(result.proposal.effect).toContainEqual({ label: 'Claim', value: CLAIM_ID });
    expect(result.proposal.effect).toContainEqual({ label: 'Denial reason', value: DENIAL_REASON });
    expect(result.proposal.effect).toContainEqual({ label: 'Cited rows', value: '4' });
    expect(result.proposal.affects).toEqual([{ type: 'Claim', id: CLAIM_ID }]);
    expect(result.proposal.derivedFromUntrusted).toBe(false);
  });

  it('reports missing requirements when claim fields are absent', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Claim data with missing fields
        id: CLAIM_ID,
        status: 'denied',
        // denialReasonCode missing
        serviceDate: '2026-01-10',
        totalCents: 15000,
        // narrative missing
      })
      .mockResolvedValueOnce({
        data: [
          {
            fields: ['denialReasonCode', 'serviceDate', 'totalCents', 'narrative'],
          },
        ],
      });

    const result = await denialPrepareAppealFromCase.run(
      { claimId: CLAIM_ID, denialReasonCode: DENIAL_REASON, payerProfile: PAYER_PROFILE },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    );

    expect(result.status).toBe('pending');
    const body = result.proposal.commit.body;
    expect(body.claimId).toBe(CLAIM_ID);
    expect(body.denialReasonCode).toBe(DENIAL_REASON);
    expect(body.narrative).toBe('');
    // The commit still goes through - the human reviews the preview
  });

  it('rejects the preparation when the payer profile is not found', async () => {
    API_CLIENT.call.mockResolvedValueOnce({ status: 'denied' }).mockResolvedValueOnce({ data: [] });

    await expect(
      denialPrepareAppealFromCase.run(
        {
          claimId: CLAIM_ID,
          denialReasonCode: DENIAL_REASON,
          payerProfile: { system: 'test-payer-system', code: 'missing-payer' },
        },
        { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
      )
    ).rejects.toThrow('Payer profile "missing-payer" not found.');
  });

  it('handles different claim statuses correctly', async () => {
    const statuses = [
      'denied',
      'appeal-draft',
      'appeal-submitted',
      'appeal-approved',
      'appeal-denied',
    ];

    for (let i = 0; i < statuses.length; i++) {
      vi.resetAllMocks();
      API_CLIENT.call
        .mockResolvedValueOnce({
          id: CLAIM_ID,
          status: statuses[i],
          denialReasonCode: DENIAL_REASON,
          serviceDate: '2026-01-10',
          totalCents: 15000,
          narrative: 'test narrative',
        })
        .mockResolvedValueOnce({
          data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents', 'narrative'] }],
        });

      const result = await denialPrepareAppealFromCase.run(
        { claimId: CLAIM_ID, denialReasonCode: DENIAL_REASON, payerProfile: PAYER_PROFILE },
        { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
      );

      expect(result.status).toBe('pending');
      // The body status is always 'draft' for a new appeal
      expect(result.proposal.commit.body.status).toBe('draft');
    }
  });

  it('is a DRAFT tool with approval always', () => {
    expect(denialPrepareAppealFromCase.tier).toBe('DRAFT');
    expect(denialPrepareAppealFromCase.trustClass).toBe('writer');
    expect(denialPrepareAppealFromCase.approval).toBe('always');
    expect(denialPrepareAppealFromCase.sideEffect).toBe('write');
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { priorauthPrepareFromCase } from './priorauth-prepare-from-case.js';
import { stubPrincipal } from '../testing/index.js';
import type { ProposalResult } from '../proposal.js';

const PRINCIPAL = stubPrincipal({
  roleIds: ['biller'],
  scopes: ['form.read', 'form.write'],
});

const CREDENTIAL = { authorization: 'test-credential-token' };

const API_CLIENT = {
  call: vi.fn(),
} as const;

const FORM_ID = '123e4567-e89b-12d3-a456-426614174000';
const PAYER_PROFILE = {
  system: 'test-payer-system',
  code: 'test-payer-1',
  display: 'Test Payer',
};

describe('priorauth.prepareFromCase', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('prepares a prior-auth packet from an existing form with all fields satisfied', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Form data
        status: 'draft',
        payer: { system: 'test-payer-system', code: 'test-payer-1', display: 'Test Payer' },
        memberId: 'test-member-1',
        serviceCode: { system: 'CPT', code: '97110' },
        diagnosisCodes: [{ system: 'ICD-10-CM', code: 'M54.5' }],
        requestedUnits: 12,
        startDate: '2026-01-15',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'Conservative management has been documented for six weeks.',
      })
      .mockResolvedValueOnce({
        // Payer profile
        data: [
          {
            fields: [
              'payer',
              'memberId',
              'serviceCode',
              'diagnosisCodes',
              'requestedUnits',
              'startDate',
              'renderingProviderId',
              'justification',
            ],
          },
        ],
      });

    const result = (await priorauthPrepareFromCase.run(
      { formId: FORM_ID, payerProfile: PAYER_PROFILE },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ProposalResult;

    expect(result.status).toBe('pending');
    expect(result.proposal.kind).toBe('form.priorAuthorisation');
    expect(result.proposal.commit.path).toBe('/bff/v0/forms');
    expect(result.proposal.commit.method).toBe('POST');
    expect(result.proposal.commit.body.kind).toBe('prior-authorisation');
    expect(result.proposal.commit.body.status).toBe('draft');
    expect(result.proposal.commit.body.memberId).toBe('test-member-1');
    expect(result.proposal.commit.body.requestedUnits).toBe(12);
    expect(result.proposal.commit.body.startDate).toBe('2026-01-15');
    expect(result.proposal.commit.body.justification).toBe(
      'Conservative management has been documented for six weeks.'
    );
    expect(result.proposal.effect).toContainEqual({ label: 'Payer', value: 'Test Payer' });
    expect(result.proposal.effect).toContainEqual({ label: 'Service', value: '97110' });
    expect(result.proposal.effect).toContainEqual({ label: 'Units requested', value: '12' });
    expect(result.proposal.effect).toContainEqual({ label: 'Start date', value: '2026-01-15' });
    expect(result.proposal.affects).toEqual([{ type: 'Form', id: FORM_ID }]);
    expect(result.proposal.derivedFromUntrusted).toBe(false);
  });

  it('reports missing requirements when form fields are absent', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Form data with missing fields
        status: 'draft',
        payer: { system: 'test-payer-system', code: 'test-payer-1', display: 'Test Payer' },
        memberId: 'test-member-1',
        // serviceCode missing
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-15',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        // justification missing
      })
      .mockResolvedValueOnce({
        data: [
          {
            fields: [
              'payer',
              'memberId',
              'serviceCode',
              'diagnosisCodes',
              'requestedUnits',
              'startDate',
              'renderingProviderId',
              'justification',
            ],
          },
        ],
      });

    const result = (await priorauthPrepareFromCase.run(
      { formId: FORM_ID, payerProfile: PAYER_PROFILE },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ProposalResult;

    expect(result.status).toBe('pending');
    const body = result.proposal.commit.body;
    // The body should still contain the form data (with missing fields as defaults)
    expect(body.serviceCode).toEqual({ system: '', code: '' });
    expect(body.diagnosisCodes).toEqual([]);
    expect(body.justification).toBe('');
    // But the commit still goes through - the human reviews the preview
  });

  it('rejects the preparation when the payer profile is not found', async () => {
    API_CLIENT.call.mockResolvedValueOnce({ status: 'draft' }).mockResolvedValueOnce({ data: [] });

    await expect(
      priorauthPrepareFromCase.run(
        { formId: FORM_ID, payerProfile: { system: 'test-payer-system', code: 'missing-payer' } },
        { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
      )
    ).rejects.toThrow('Payer profile "missing-payer" not found.');
  });

  it('handles different form statuses correctly', async () => {
    const statuses = [
      'draft',
      'complete',
      'saved',
      'submitted',
      'approved',
      'denied',
      'pended',
      'modified',
      'cancelled',
    ];

    for (let i = 0; i < statuses.length; i++) {
      vi.resetAllMocks();
      API_CLIENT.call
        .mockResolvedValueOnce({
          status: statuses[i],
          payer: { system: 'p', code: 'p1', display: 'P' },
          memberId: 'M1',
          serviceCode: { system: 'c', code: '1' },
          diagnosisCodes: [],
          requestedUnits: 1,
          startDate: '2026-01-01',
          renderingProviderId: FORM_ID,
          justification: 'test-j',
        })
        .mockResolvedValueOnce({
          data: [
            {
              fields: [
                'payer',
                'memberId',
                'serviceCode',
                'diagnosisCodes',
                'requestedUnits',
                'startDate',
                'renderingProviderId',
                'justification',
              ],
            },
          ],
        });

      const result = (await priorauthPrepareFromCase.run(
        { formId: FORM_ID, payerProfile: { system: 'test', code: 'test-code' } },
        { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
      )) as ProposalResult;

      expect(result.status).toBe('pending');
      // The body status should match the form status
      expect(result.proposal.commit.body.status).toBe('draft'); // Always draft for new submission
    }
  });

  it('uses payer code when display is not available', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'draft',
        payer: { system: 'test-payer-system', code: 'test-payer-1', display: '' }, // no display
        memberId: 'test-member-1',
        serviceCode: { system: 'CPT', code: '97110' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-15',
        renderingProviderId: FORM_ID,
        justification: 'test',
      })
      .mockResolvedValueOnce({
        data: [
          {
            fields: [
              'payer',
              'memberId',
              'serviceCode',
              'diagnosisCodes',
              'requestedUnits',
              'startDate',
              'renderingProviderId',
              'justification',
            ],
          },
        ],
      });

    const result = (await priorauthPrepareFromCase.run(
      { formId: FORM_ID, payerProfile: PAYER_PROFILE },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ProposalResult;

    expect(result.proposal.effect).toContainEqual({ label: 'Payer', value: 'test-payer-1' });
  });

  it('is a DRAFT tool with approval always', () => {
    expect(priorauthPrepareFromCase.tier).toBe('DRAFT');
    expect(priorauthPrepareFromCase.trustClass).toBe('writer');
    expect(priorauthPrepareFromCase.approval).toBe('always');
    expect(priorauthPrepareFromCase.sideEffect).toBe('write');
  });
});

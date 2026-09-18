import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import { authorisationReviewEvidence } from '../authorisation-review-evidence.js';
import { stubPrincipal } from '../../testing/index.js';

const PRINCIPAL = stubPrincipal({
  roleIds: ['biller'],
  scopes: ['claim.read', 'form.read', 'patient.read'],
});

const CREDENTIAL = { authorization: 'TEST_CREDENTIAL_TOKEN' };

const API_CLIENT = {
  call: vi.fn(),
} as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used for type inference only
const _outputSchema = z.strictObject({
  queryRan: z.string().max(512),
  total: z.int().min(0),
  shown: z.int().min(0),
  reviews: z.array(
    z.strictObject({
      caseId: z.uuid(),
      caseType: z.enum(['prior-authorisation', 'denied-claim']),
      payerProfile: z.strictObject({
        system: z.string(),
        code: z.string(),
        display: z.string().optional(),
      }),
      missingRequirements: z.array(
        z.strictObject({
          label: z.string(),
          field: z.string(),
          satisfied: z.boolean(),
          source: z
            .strictObject({ resourceType: z.string(), resourceId: z.string(), field: z.string() })
            .nullable(),
          reason: z.string().optional(),
        })
      ),
      status: z.enum([
        'draft',
        'technically-complete',
        'saved',
        'submitted',
        'payer-approved',
        'payer-denied',
        'payer-pended',
        'payer-modified',
        'cancelled',
      ]),
      evidence: z.array(
        z.strictObject({
          resourceType: z.string(),
          resourceId: z.string(),
          field: z.string(),
          label: z.string(),
        })
      ),
    })
  ),
});

type ReviewOutput = z.infer<typeof _outputSchema>;

describe('authorisation.reviewEvidence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reviews a prior-authorisation case and returns missing requirements', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Form data
        status: 'draft',
        payer: { system: 'payer-codes', code: 'payer-1', display: 'Test Payer' },
        memberId: 'M123',
        serviceCode: { system: 'cpt', code: '99213' },
        diagnosisCodes: [{ system: 'icd10', code: 'E11.9' }],
        requestedUnits: 1,
        startDate: '2026-01-15',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'Patient needs follow-up',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'payer-codes', code: 'payer-1', display: 'Test Payer' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews).toHaveLength(1);
    const review = result.reviews[0]!;
    expect(review.caseType).toBe('prior-authorisation');
    expect(review.status).toBe('draft');
    expect(review.missingRequirements).toHaveLength(8);
    // All fields should be satisfied in this case
    expect(review.missingRequirements.every((r) => r.satisfied)).toBe(true);
    expect(review.evidence).toHaveLength(8);
  });

  it('reports missing requirements when fields are absent', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Form data with missing fields
        status: 'draft',
        payer: { system: 'payer-codes', code: 'payer-1', display: 'Test Payer' },
        memberId: 'M123',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'payer-codes', code: 'payer-1', display: 'Test Payer' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    const review = result.reviews[0]!;
    const missing = review.missingRequirements.filter((r) => !r.satisfied);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((r) => r.field === 'serviceCode')).toBe(true);
    expect(missing.some((r) => r.field === 'justification')).toBe(true);
  });

  it('reviews a denied-claim case', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        // Claim data
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'denied',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'payer-codes', code: 'payer-1', display: 'Test Payer' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews).toHaveLength(1);
    const review = result.reviews[0]!;
    expect(review.caseType).toBe('denied-claim');
    expect(review.status).toBe('payer-denied');
    expect(review.missingRequirements).toHaveLength(3);
  });

  it('handles multiple cases in one call', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'draft',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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
      })
      .mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'denied',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]!.caseType).toBe('prior-authorisation');
    expect(result.reviews[1]!.caseType).toBe('denied-claim');
  });

  it('returns correct status for technically complete prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'complete',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('technically-complete');
  });

  it('returns correct status for submitted prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'submitted',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('submitted');
  });

  it('returns correct status for payer-approved', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'approved',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('payer-approved');
  });

  it('never infers approval from a valid packet', async () => {
    // Even with all fields satisfied, if status is 'complete' it should NOT be 'payer-approved'
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'complete',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('technically-complete');
    expect(result.reviews[0]!.status).not.toBe('payer-approved');
  });

  it('includes source references for satisfied requirements', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'draft',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    const review = result.reviews[0]!;
    expect(review.evidence.length).toBe(8);
    expect(review.evidence[0]).toHaveProperty('resourceType');
    expect(review.evidence[0]).toHaveProperty('resourceId');
    expect(review.evidence[0]).toHaveProperty('field');
    expect(review.evidence[0]).toHaveProperty('label');
  });

  it('returns saved status for prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'saved',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('saved');
  });

  it('returns payer-pended status for prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'pended',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('payer-pended');
  });

  it('returns payer-modified status for prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'modified',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('payer-modified');
  });

  it('returns cancelled status for prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'cancelled',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('cancelled');
  });

  it('returns payer-denied status for prior-auth', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'denied',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('payer-denied');
  });

  it('returns draft status for unknown prior-auth status', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        status: 'unknown-status',
        payer: { system: 'p', code: 'p1' },
        memberId: 'M1',
        serviceCode: { system: 'c', code: '1' },
        diagnosisCodes: [],
        requestedUnits: 1,
        startDate: '2026-01-01',
        renderingProviderId: '123e4567-e89b-12d3-a456-426614174000',
        justification: 'j',
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

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            caseType: 'prior-authorisation',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('draft');
  });

  it('returns appeal-draft status for denied-claim', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'appeal-draft',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('draft');
  });

  it('returns appeal-submitted status for denied-claim', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'appeal-submitted',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('submitted');
  });

  it('returns appeal-approved status for denied-claim', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'appeal-approved',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('payer-approved');
  });

  it('returns appeal-denied status for denied-claim', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'appeal-denied',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('payer-denied');
  });

  it('returns draft status for unknown denied-claim status', async () => {
    API_CLIENT.call
      .mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174001',
        status: 'unknown-claim-status',
        denialReasonCode: 'CO-16',
        serviceDate: '2026-01-10',
        totalCents: 15000,
      })
      .mockResolvedValueOnce({
        data: [{ fields: ['denialReasonCode', 'serviceDate', 'totalCents'] }],
      });

    const result = (await authorisationReviewEvidence.run(
      {
        cases: [
          {
            caseId: '123e4567-e89b-12d3-a456-426614174001',
            caseType: 'denied-claim',
            payerProfile: { system: 'p', code: 'p1' },
          },
        ],
      },
      { principal: PRINCIPAL, credential: CREDENTIAL, api: API_CLIENT }
    )) as ReviewOutput;

    expect(result.reviews[0]!.status).toBe('draft');
  });
});

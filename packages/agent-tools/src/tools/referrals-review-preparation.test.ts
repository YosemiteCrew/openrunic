import { describe, expect, it } from 'vitest';

import { createV1Registry } from '../catalogue.js';
import { ToolError } from '../errors.js';
import { resolveTools } from '../resolve.js';
import {
  TEST_PATIENT_ID,
  recordingApiClient,
  stubPrincipal,
  stubToolContext,
} from '../testing/index.js';
import type { ApiRequest } from '../api-client.js';

import {
  referralsReviewPreparation,
  type ReferralPreparation,
} from './referrals-review-preparation.js';

const REFERRAL_ID = '018f2b40-0000-7000-8000-00000000a001';
const DOCUMENT_ID = '018f2b40-0000-7000-8000-00000000d001';
const CLINICIAN_ID = '018f2b40-0000-7000-8000-00000000c001';

/** A sent referral with every preparation item recorded and no report yet. */
function referral(overrides: Record<string, unknown> = {}) {
  return {
    id: REFERRAL_ID,
    patientId: TEST_PATIENT_ID,
    encounterId: null,
    referredById: CLINICIAN_ID,
    status: 'SENT',
    priority: 'ROUTINE',
    specialtyCode: 'cardiology',
    specialtyDisplay: 'Cardiology',
    receivingPractice: 'Example Heart Clinic',
    receivingNpi: '1234567893',
    receivingPhone: null,
    reasonCodes: ['I10'],
    reasonText: null,
    note: null,
    authorisationNumber: 'AUTH-EXAMPLE',
    sentAt: '2026-09-01T10:00:00.000Z',
    scheduledFor: null,
    seenAt: null,
    reportReceivedAt: null,
    reportDocumentId: null,
    declinedReason: null,
    awaiting: 'an appointment',
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function refuse(status: number): never {
  throw new ToolError('AGENT_TOOL_FAILED', `The openrunic API answered ${String(status)}.`, {
    status,
  });
}

async function review(
  row: Record<string, unknown>,
  document: (request: ApiRequest) => unknown = () => ({
    id: DOCUMENT_ID,
    patientId: TEST_PATIENT_ID,
    status: 'FILED',
  })
) {
  const api = recordingApiClient((request) =>
    request.path.startsWith('/bff/v0/documents/') ? document(request) : row
  );
  const context = stubToolContext({
    api,
    principal: stubPrincipal({ compartment: { patientId: TEST_PATIENT_ID } }),
  });
  const result = (await referralsReviewPreparation.run(
    { referralId: REFERRAL_ID },
    context
  )) as ReferralPreparation;
  return { result, api };
}

function checklistState(
  result: Awaited<ReturnType<typeof review>>['result'],
  name: string
): string | undefined {
  return result.checklist.find((entry) => entry.item === name)?.state;
}

describe('referrals.reviewPreparation', () => {
  it('reads the referral the caller selected, with the caller credential, and nothing else', async () => {
    const { api } = await review(referral());
    expect(api.calls.map((call) => call.request)).toEqual([
      { method: 'GET', path: `/bff/v0/referrals/${REFERRAL_ID}` },
    ]);
    expect(api.calls[0]?.context.credential.authorization).toBe('Bearer test-token');
  });

  it('says a sent referral is sent, not received and not completed', async () => {
    const { result } = await review(referral());
    expect(result.lifecycle.map(({ fact, recorded, at }) => ({ fact, recorded, at }))).toEqual([
      { fact: 'sent', recorded: true, at: '2026-09-01T10:00:00.000Z' },
      { fact: 'scheduled', recorded: false, at: null },
      { fact: 'seen', recorded: false, at: null },
      { fact: 'report-received', recorded: false, at: null },
      { fact: 'completed', recorded: false, at: null },
    ]);
    expect(result.lifecycle.map((entry) => entry.source.field)).toEqual([
      'sentAt',
      'scheduledFor',
      'seenAt',
      'reportReceivedAt',
      'status',
    ]);
    expect(result.nextOwner).toEqual({
      party: 'receiving-practice',
      staffId: null,
      practice: 'Example Heart Clinic',
      source: { resourceType: 'Referral', resourceId: REFERRAL_ID, field: 'receivingPractice' },
    });
  });

  it('counts completed from the status, never from a report date alone', async () => {
    const received = await review(
      referral({ status: 'SEEN', reportReceivedAt: '2026-09-10T10:00:00.000Z' })
    );
    const completedFact = received.result.lifecycle.find((entry) => entry.fact === 'completed');
    expect(completedFact?.recorded).toBe(false);

    const closed = await review(
      referral({
        status: 'COMPLETED',
        seenAt: '2026-09-08T10:00:00.000Z',
        reportReceivedAt: '2026-09-10T10:00:00.000Z',
        reportDocumentId: DOCUMENT_ID,
        awaiting: null,
      })
    );
    expect(closed.result.lifecycle.find((entry) => entry.fact === 'completed')?.recorded).toBe(
      true
    );
    expect(closed.result.nextOwner.party).toBe('none');
    expect(closed.result.allPresent).toBe(true);
  });

  it('marks a partial case partial and names each missing item', async () => {
    const { result } = await review(
      referral({ reasonCodes: [], receivingNpi: null, authorisationNumber: null })
    );
    expect(result.allPresent).toBe(false);
    expect(result.checklist.map(({ item, state }) => ({ item, state }))).toEqual([
      { item: 'reason-codes', state: 'missing' },
      { item: 'receiving-contact', state: 'missing' },
      { item: 'authorisation-number', state: 'missing' },
      { item: 'specialist-report', state: 'missing' },
    ]);
    expect(result.checklist.every((entry) => entry.reason !== null)).toBe(true);
  });

  it('accepts a phone number as the receiving contact and cites it', async () => {
    const { result } = await review(referral({ receivingNpi: null, receivingPhone: '555-0100' }));
    const contact = result.checklist.find((entry) => entry.item === 'receiving-contact');
    expect(contact?.state).toBe('present');
    expect(contact?.reason).toBeNull();
    expect(contact?.source?.field).toBe('receivingPhone');
  });

  it('says a report recorded as received but never filed is missing, not present', async () => {
    const { result } = await review(
      referral({ status: 'COMPLETED', reportReceivedAt: '2026-09-10T10:00:00.000Z' })
    );
    const report = result.checklist.find((entry) => entry.item === 'specialist-report');
    expect(report?.state).toBe('missing');
    expect(report?.reason).toContain('no document is filed');
  });

  it('reads the report document and calls a filed one present, citing the document', async () => {
    const { result, api } = await review(referral({ reportDocumentId: DOCUMENT_ID }));
    expect(api.calls[1]?.request).toEqual({
      method: 'GET',
      path: `/bff/v0/documents/${DOCUMENT_ID}`,
    });
    const report = result.checklist.find((entry) => entry.item === 'specialist-report');
    expect(report).toEqual({
      item: 'specialist-report',
      state: 'present',
      reason: null,
      source: { resourceType: 'Document', resourceId: DOCUMENT_ID, field: 'status' },
    });
  });

  it.each([
    ['INBOX', 'has not been filed'],
    ['SUPERSEDED', 'superseded or entered in error'],
    ['ENTERED_IN_ERROR', 'superseded or entered in error'],
  ])('never calls a %s report present', async (status, reason) => {
    const { result } = await review(referral({ reportDocumentId: DOCUMENT_ID }), () => ({
      id: DOCUMENT_ID,
      patientId: TEST_PATIENT_ID,
      status,
    }));
    const report = result.checklist.find((entry) => entry.item === 'specialist-report');
    expect(report?.state).toBe('missing');
    expect(report?.reason).toContain(reason);
    expect(result.allPresent).toBe(false);
  });

  it.each([403, 404])(
    'calls a report the caller cannot read (%i) unavailable, never present',
    async (status) => {
      const { result } = await review(referral({ reportDocumentId: DOCUMENT_ID }), () =>
        refuse(status)
      );
      expect(checklistState(result, 'specialist-report')).toBe('unavailable');
      expect(result.allPresent).toBe(false);
      const report = result.checklist.find((entry) => entry.item === 'specialist-report');
      expect(report?.source?.field).toBe('reportDocumentId');
    }
  );

  it.each([
    ['another chart', '018f2b40-0000-7000-8000-0000000000aa'],
    ['no chart', null],
  ])('calls a filed report on %s unavailable, never present', async (_label, patientId) => {
    const { result } = await review(referral({ reportDocumentId: DOCUMENT_ID }), () => ({
      id: DOCUMENT_ID,
      patientId,
      status: 'FILED',
    }));
    expect(checklistState(result, 'specialist-report')).toBe('unavailable');
  });

  it('raises any other document failure instead of answering', async () => {
    await expect(
      review(referral({ reportDocumentId: DOCUMENT_ID }), () => refuse(500))
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_FAILED', status: 500 });
    await expect(
      review(referral({ reportDocumentId: DOCUMENT_ID }), () => {
        throw new Error('network');
      })
    ).rejects.toThrow('network');
  });

  it.each([
    ['DRAFT', 'referring-clinician'],
    ['DECLINED', 'referring-clinician'],
    ['SENT', 'receiving-practice'],
    ['ACCEPTED', 'receiving-practice'],
    ['SCHEDULED', 'receiving-practice'],
    ['SEEN', 'receiving-practice'],
    ['COMPLETED', 'none'],
    ['CANCELLED', 'none'],
    ['ENTERED_IN_ERROR', 'none'],
  ])('gives a %s referral to %s next', async (status, party) => {
    const { result } = await review(referral({ status }));
    expect(result.nextOwner.party).toBe(party);
    expect(result.status).toBe(status);
    if (party === 'referring-clinician') {
      expect(result.nextOwner.staffId).toBe(CLINICIAN_ID);
      expect(result.nextOwner.practice).toBeNull();
      expect(result.nextOwner.source.field).toBe('referredById');
    }
    if (party === 'none') {
      expect(result.nextOwner).toMatchObject({ staffId: null, practice: null });
      expect(result.nextOwner.source.field).toBe('status');
    }
  });

  it('carries the referral version so a stale answer can be dropped', async () => {
    const { result } = await review(referral({ updatedAt: '2026-09-12T08:00:00.000Z' }));
    expect(result.sourceVersion).toBe('2026-09-12T08:00:00.000Z');
    expect(result.awaiting).toBe('an appointment');
    expect(result.referralId).toBe(REFERRAL_ID);
  });

  it('refuses to read with no chart bound to the turn', async () => {
    const api = recordingApiClient(() => referral());
    await expect(
      referralsReviewPreparation.run(
        { referralId: REFERRAL_ID },
        stubToolContext({ api, principal: stubPrincipal({ compartment: {} }) })
      )
    ).rejects.toMatchObject({ code: 'AGENT_COMPARTMENT_VIOLATION' });
    expect(api.calls).toHaveLength(0);
  });

  it('aborts when the referral belongs to a chart other than the open one', async () => {
    await expect(
      review(referral({ patientId: '018f2b40-0000-7000-8000-0000000000aa' }))
    ).rejects.toMatchObject({ code: 'AGENT_COMPARTMENT_VIOLATION' });
  });

  it('is a read with no approval step, so it can change nothing', () => {
    expect(referralsReviewPreparation).toMatchObject({
      tier: 'READ',
      trustClass: 'reader',
      approval: 'never',
      sideEffect: 'read',
    });
  });

  it('reaches a clinician holding the referral and document reads, and no other role', () => {
    const registry = createV1Registry();
    const scopes = ['order.read', 'document.read'];
    const ids = (roleIds: string[], held: string[]) =>
      resolveTools(registry, stubPrincipal({ roleIds, scopes: held })).map((tool) => tool.id);

    expect(ids(['clinician'], scopes)).toContain('referrals.reviewPreparation');
    expect(ids(['clinician'], ['order.read'])).not.toContain('referrals.reviewPreparation');
    for (const role of ['front-desk', 'biller', 'admin']) {
      expect(ids([role], scopes)).not.toContain('referrals.reviewPreparation');
    }
  });
});

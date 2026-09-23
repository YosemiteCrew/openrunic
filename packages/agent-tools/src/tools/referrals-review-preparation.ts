import { z } from 'zod';

import { isToolError } from '../errors.js';
import { defineTool, type ToolContext } from '../registry.js';

import { assertChartBound } from './patient-shared.js';
import { sourceRefSchema, type SourceRef } from './shared.js';

/**
 * Reads back one referral's preparation checklist, its recorded lifecycle and
 * who has to act next, for the care coordinator who would otherwise open the
 * referral screen to find out.
 *
 * Everything here is computed from stored fields by code. The model chooses
 * which referral to ask about and nothing else: it does not decide what is
 * missing, whether a date counts, or whose turn it is. A spoken answer and a
 * typed one therefore come from the same function over the same row, which is
 * the only way they can agree.
 *
 * It reads and only reads. Sending, scheduling, recording a report and closing
 * a referral stay on the referral screen's own buttons; none of them is
 * reachable from here, and nothing here ranks urgency - the recorded priority
 * is the practice's, and this tool does not restate it.
 *
 * A document the caller cannot read is `unavailable`, never `present`. The
 * report is the one thing a referral is waiting for, and describing a report
 * as filed because an id is set on the row - when the caller has no right to
 * see it, or it was struck out - is the error that makes a loop look closed.
 */

const CHECKLIST_STATES = ['present', 'missing', 'unavailable'] as const;
const OWNER_PARTIES = ['referring-clinician', 'receiving-practice', 'none'] as const;
const LIFECYCLE_FACTS = ['sent', 'scheduled', 'seen', 'report-received', 'completed'] as const;

/** Statuses after which nobody owes the referral anything. */
const CLOSED_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED', 'ENTERED_IN_ERROR'];

const referralSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  referredById: z.string(),
  status: z.string(),
  receivingPractice: z.string(),
  receivingNpi: z.string().nullable(),
  receivingPhone: z.string().nullable(),
  reasonCodes: z.array(z.string()),
  authorisationNumber: z.string().nullable(),
  sentAt: z.string().nullable(),
  scheduledFor: z.string().nullable(),
  seenAt: z.string().nullable(),
  reportReceivedAt: z.string().nullable(),
  reportDocumentId: z.string().nullable(),
  awaiting: z.string().nullable(),
  updatedAt: z.string(),
});

type Referral = z.infer<typeof referralSchema>;

const documentSchema = z.object({
  id: z.string(),
  patientId: z.string().nullable(),
  status: z.string(),
});

const checklistItemSchema = z.strictObject({
  item: z.enum(['reason-codes', 'receiving-contact', 'authorisation-number', 'specialist-report']),
  state: z.enum(CHECKLIST_STATES),
  /** Why the item is not present, in words a coordinator would use. */
  reason: z.string().max(256).nullable(),
  /** Where the answer was read from. Null only when there is nothing to point at. */
  source: sourceRefSchema.nullable(),
});

type ChecklistItem = z.infer<typeof checklistItemSchema>;

const lifecycleFactSchema = z.strictObject({
  fact: z.enum(LIFECYCLE_FACTS),
  recorded: z.boolean(),
  /** As stored. Formatting an instant needs the reader's timezone, which is not here. */
  at: z.string().nullable(),
  source: sourceRefSchema,
});

const outputSchema = z.strictObject({
  queryRan: z.string().max(512),
  referralId: z.string(),
  patientId: z.string(),
  /**
   * The referral's `updatedAt`. A surface that asked about version A drops an
   * answer that comes back for version B, so a late result from before a
   * report arrived can never be read out after it.
   */
  sourceVersion: z.string(),
  status: z.string().max(32),
  lifecycle: z.array(lifecycleFactSchema).length(LIFECYCLE_FACTS.length),
  checklist: z.array(checklistItemSchema).max(8),
  /** True only when every item is present. A partial case is said to be partial. */
  allPresent: z.boolean(),
  awaiting: z.string().max(64).nullable(),
  nextOwner: z.strictObject({
    party: z.enum(OWNER_PARTIES),
    /** The referring clinician's staff id, when they are the next owner. */
    staffId: z.string().nullable(),
    /** The receiving practice as recorded, when it is the next owner. */
    practice: z.string().max(200).nullable(),
    source: sourceRefSchema,
  }),
});

export type ReferralPreparation = z.infer<typeof outputSchema>;

export const referralsReviewPreparation = defineTool({
  id: 'referrals.reviewPreparation',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['order.read', 'document.read'],
  surfaces: ['staff'],
  summary:
    "Reads a referral's preparation checklist, what has been recorded so far, and who acts next.",
  activityLabel: 'Checking the referral',
  maxResultRows: 1,
  compartmentBound: true,
  input: z.strictObject({ referralId: z.uuid() }),
  output: outputSchema,

  async execute(input, context) {
    assertChartBound(context, 'referrals.reviewPreparation');

    const referral = referralSchema.parse(
      await context.api.call(
        { method: 'GET', path: `/bff/v0/referrals/${input.referralId}` },
        context
      )
    );

    return reviewPreparation(referral, await reportState(referral, context));
  },
});

/** Pure: the whole answer, from the referral and what the report read found. */
export function reviewPreparation(referral: Referral, report: ChecklistItem): ReferralPreparation {
  const checklist: ChecklistItem[] = [
    item(
      'reason-codes',
      referral.reasonCodes.length > 0,
      'No reason code is recorded.',
      ref(referral, 'reasonCodes')
    ),
    item(
      'receiving-contact',
      referral.receivingNpi !== null || referral.receivingPhone !== null,
      'Neither an NPI nor a phone number is recorded for the receiving practice.',
      ref(referral, referral.receivingNpi === null ? 'receivingPhone' : 'receivingNpi')
    ),
    item(
      'authorisation-number',
      referral.authorisationNumber !== null,
      'No authorisation number is recorded.',
      ref(referral, 'authorisationNumber')
    ),
    report,
  ];

  return {
    queryRan: `referral preparation for ${referral.id}`,
    referralId: referral.id,
    patientId: referral.patientId,
    sourceVersion: referral.updatedAt,
    status: referral.status,
    lifecycle: [
      fact(referral, 'sent', referral.sentAt, 'sentAt'),
      fact(referral, 'scheduled', referral.scheduledFor, 'scheduledFor'),
      fact(referral, 'seen', referral.seenAt, 'seenAt'),
      fact(referral, 'report-received', referral.reportReceivedAt, 'reportReceivedAt'),
      // No completion timestamp is stored, so the fact is the status and
      // nothing is inferred from the report date standing next to it.
      {
        fact: 'completed',
        recorded: referral.status === 'COMPLETED',
        at: null,
        source: ref(referral, 'status'),
      },
    ],
    checklist,
    allPresent: checklist.every((entry) => entry.state === 'present'),
    awaiting: referral.awaiting,
    nextOwner: nextOwner(referral),
  };
}

/**
 * Whose move it is, from the same timestamps `awaiting` reads.
 *
 * The receiving practice owns everything between sending and the report: it
 * schedules, it sees the patient, it sends the report back. Before sending and
 * after a decline, the referral is the referring clinician's to move.
 */
function nextOwner(referral: Referral): ReferralPreparation['nextOwner'] {
  const source = ref(referral, 'status');
  if (CLOSED_STATUSES.includes(referral.status)) {
    return { party: 'none', staffId: null, practice: null, source };
  }
  if (referral.status === 'DRAFT' || referral.status === 'DECLINED') {
    return {
      party: 'referring-clinician',
      staffId: referral.referredById,
      practice: null,
      source: ref(referral, 'referredById'),
    };
  }
  return {
    party: 'receiving-practice',
    staffId: null,
    practice: referral.receivingPractice,
    source: ref(referral, 'receivingPractice'),
  };
}

/**
 * The specialist report, read with the caller's own credential.
 *
 * A 403 or 404 is `unavailable`: the id is on the referral, but this caller
 * cannot see the document, and saying so is different from saying it is
 * missing and different again from saying it is there. Any other failure is
 * the API's and is raised, not papered over.
 */
async function reportState(referral: Referral, context: ToolContext): Promise<ChecklistItem> {
  const documentId = referral.reportDocumentId;
  if (documentId === null) {
    return item(
      'specialist-report',
      false,
      referral.reportReceivedAt === null
        ? 'No report has been received.'
        : 'A report was recorded as received but no document is filed against it.',
      null
    );
  }

  let document: z.infer<typeof documentSchema>;
  try {
    document = documentSchema.parse(
      await context.api.call({ method: 'GET', path: `/bff/v0/documents/${documentId}` }, context)
    );
  } catch (error) {
    if (isToolError(error) && (error.status === 403 || error.status === 404)) {
      return unavailable(referral);
    }
    throw error;
  }

  // A document filed to another chart is not this patient's report, whatever
  // id the referral carries, so it is not vouched for either.
  if (document.patientId !== referral.patientId) return unavailable(referral);

  const source: SourceRef = { resourceType: 'Document', resourceId: document.id, field: 'status' };
  if (document.status === 'FILED') return item('specialist-report', true, '', source);
  return item(
    'specialist-report',
    false,
    document.status === 'INBOX'
      ? 'The report is in the inbox and has not been filed.'
      : 'The report document was superseded or entered in error.',
    source
  );
}

function unavailable(referral: Referral): ChecklistItem {
  return {
    item: 'specialist-report',
    state: 'unavailable',
    reason: 'The report document cannot be read with your access.',
    source: ref(referral, 'reportDocumentId'),
  };
}

function item(
  name: ChecklistItem['item'],
  present: boolean,
  reason: string,
  source: SourceRef | null
): ChecklistItem {
  return present
    ? { item: name, state: 'present', reason: null, source }
    : { item: name, state: 'missing', reason, source };
}

function fact(
  referral: Referral,
  name: (typeof LIFECYCLE_FACTS)[number],
  at: string | null,
  field: string
): z.infer<typeof lifecycleFactSchema> {
  return { fact: name, recorded: at !== null, at, source: ref(referral, field) };
}

function ref(referral: Referral, field: string): SourceRef {
  return { resourceType: 'Referral', resourceId: referral.id, field };
}

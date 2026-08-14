import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, moneyMinorUnits, opaqueRef } from './core.js';

/**
 * The claims seam: pushing X12 out and pulling X12 back.
 *
 * Openrunic builds and parses the transaction sets itself, in `@openrunic/x12`,
 * so this seam moves opaque envelopes and never interprets them. That is the
 * whole point: a practice that changes clearinghouse keeps its scrub rules, its
 * claim ledger and its remittance posting untouched, because none of that
 * knowledge ever lived on the far side of the boundary.
 */

/** Semver of this seam. */
export const CLEARINGHOUSE_CONTRACT_VERSION = '1.0.0';

/** Which acknowledgement layer an inbound response belongs to: syntax (`999`) or claim status (`277`). */
export const acknowledgementLevel = z.enum(['999', '277']);

/** Inferred shape of {@link acknowledgementLevel}. */
export type AcknowledgementLevel = z.infer<typeof acknowledgementLevel>;

const submitClaimInput = z.strictObject({
  /** The 837P envelope, built by `@openrunic/x12`. The seam does not read it. */
  edi837p: z.string().min(1),
  meta: z.strictObject({
    claimId: opaqueRef,
    payerId: opaqueRef,
    /** Our control number, echoed in every acknowledgement so matching needs no fuzzy logic. */
    patientControlNumber: z.string().min(1).max(38),
    totalChargedMinorUnits: moneyMinorUnits,
    /** Set when the submission is a correction or a void of an earlier claim. */
    replacesSubmissionRef: opaqueRef.optional(),
  }),
});

const submissionReceipt = z.strictObject({
  submissionRef: opaqueRef,
  acceptedAt: isoDateTime,
  /** Claims inside the envelope. One today, but batching is why this is a count and not a boolean. */
  claimCount: z.int().positive(),
});

const checkEligibilityInput = z.strictObject({
  /** The 270 request envelope. */
  edi270: z.string().min(1),
});

const eligibilityResponse = z.strictObject({
  /** The 271 response envelope, parsed by `@openrunic/x12` on our side of the seam. */
  edi271: z.string().min(1),
  checkedAt: isoDateTime,
  /** The clearinghouse's trace handle, for support tickets that reference a specific check. */
  traceRef: opaqueRef,
});

const fetchSinceInput = z.strictObject({
  /** Exclusive lower bound on the partner's received timestamp. */
  since: isoDateTime,
  limit: z.int().positive().max(500).optional(),
});

const remittanceBatch = z.strictObject({
  files: z
    .array(
      z.strictObject({
        remittanceRef: opaqueRef,
        /** The 835 envelope. Posting happens on our side, against our ledger. */
        edi835: z.string().min(1),
        receivedAt: isoDateTime,
        totalPaidMinorUnits: moneyMinorUnits,
        payerId: opaqueRef,
      })
    )
    .readonly(),
});

const acknowledgementBatch = z.strictObject({
  acknowledgements: z
    .array(
      z.strictObject({
        acknowledgementRef: opaqueRef,
        submissionRef: opaqueRef,
        level: acknowledgementLevel,
        status: z.enum(['accepted', 'rejected', 'pending']),
        receivedAt: isoDateTime,
        /** Present only on `rejected`; the payer's or clearinghouse's own code. */
        reasonCode: z.string().min(1).max(64).optional(),
      })
    )
    .readonly(),
});

/**
 * Configuration for a clearinghouse adapter. The submitter and receiver ids are
 * trading-partner identifiers that belong in the envelope, not credentials;
 * the credential itself is behind `credentialRef`.
 */
export const clearinghouseConfig = z.strictObject({
  ...adapterConfigBase.shape,
  submitterId: z.string().min(1).max(64),
  receiverId: z.string().min(1).max(64),
  /** Sends with the test indicator set, so a sandbox run can never reach a payer as a live claim. */
  testMode: z.boolean(),
});

/** Inferred shape of {@link clearinghouseConfig}. */
export type ClearinghouseConfig = z.infer<typeof clearinghouseConfig>;

/** Optional features a clearinghouse vendor may implement. */
export const CLEARINGHOUSE_FEATURES = [
  'eligibility',
  'remittance',
  'acknowledgement',
  'attachments',
] as const;

/** Input of `submitClaim`. */
export type SubmitClaimInput = z.infer<typeof submitClaimInput>;
/** Output of `submitClaim`. */
export type SubmissionReceipt = z.infer<typeof submissionReceipt>;
/** Input of `checkEligibility`. */
export type CheckEligibilityInput = z.infer<typeof checkEligibilityInput>;
/** Output of `checkEligibility`. */
export type EligibilityResponse = z.infer<typeof eligibilityResponse>;
/** Input of `fetchRemittances` and `fetchAcknowledgements`. */
export type FetchSinceInput = z.infer<typeof fetchSinceInput>;
/** Output of `fetchRemittances`. */
export type RemittanceBatch = z.infer<typeof remittanceBatch>;
/** Output of `fetchAcknowledgements`. */
export type AcknowledgementBatch = z.infer<typeof acknowledgementBatch>;

/** The clearinghouse seam as data. */
export const CLEARINGHOUSE_CONTRACT = {
  capability: 'clearinghouse',
  contractVersion: CLEARINGHOUSE_CONTRACT_VERSION,
  config: clearinghouseConfig,
  features: CLEARINGHOUSE_FEATURES,
  operations: {
    submitClaim: { input: submitClaimInput, output: submissionReceipt },
    checkEligibility: { input: checkEligibilityInput, output: eligibilityResponse },
    fetchRemittances: { input: fetchSinceInput, output: remittanceBatch },
    fetchAcknowledgements: { input: fetchSinceInput, output: acknowledgementBatch },
  },
} as const satisfies CapabilityContract;

/**
 * Everything a clearinghouse vendor must implement. Both fetch operations are
 * pull-shaped even for partners that push, because a pull can be replayed after
 * an outage and a missed push cannot.
 */
export interface ClearinghouseAdapter extends Adapter<ClearinghouseConfig> {
  submitClaim(input: SubmitClaimInput): Promise<AdapterResult<SubmissionReceipt>>;
  /** Requires the `eligibility` feature. */
  checkEligibility(input: CheckEligibilityInput): Promise<AdapterResult<EligibilityResponse>>;
  /** Requires the `remittance` feature. */
  fetchRemittances(input: FetchSinceInput): Promise<AdapterResult<RemittanceBatch>>;
  /** Requires the `acknowledgement` feature. */
  fetchAcknowledgements(input: FetchSinceInput): Promise<AdapterResult<AcknowledgementBatch>>;
}

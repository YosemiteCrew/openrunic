import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, opaqueRef } from './core.js';

/**
 * The fax seam, which healthcare still runs on.
 *
 * Documents cross this boundary by reference, never as bytes. The vendor
 * fetches the content out of band from object storage using a short-lived
 * signed reference, which keeps a scanned chart out of the adapter's arguments
 * and therefore out of every stack trace, retry buffer and call record between
 * here and the wire.
 */

/** Semver of this seam. */
export const FAX_CONTRACT_VERSION = '1.0.0';

/** Delivery state of an outbound fax. `failed` is terminal after the vendor's own retries. */
export const faxStatus = z.enum(['queued', 'sending', 'delivered', 'failed']);

/** Inferred shape of {@link faxStatus}. */
export type FaxStatus = z.infer<typeof faxStatus>;

const sendFaxInput = z.strictObject({
  idempotencyKey: z.string().min(8).max(128),
  /** Destination in E.164. */
  toNumber: z.string().min(4).max(20),
  /** Object-storage reference the vendor resolves; the adapter never reads the document. */
  documentRef: opaqueRef,
  contentType: z.string().min(1).max(128),
  pageCount: z.int().positive().max(500),
  /** Cover-page note. Requires the `cover_page` feature. */
  coverNote: z.string().min(1).max(500).optional(),
});

const faxReceipt = z.strictObject({
  faxRef: opaqueRef,
  status: faxStatus,
  pageCount: z.int().positive(),
  queuedAt: isoDateTime,
});

const getFaxStatusInput = z.strictObject({ faxRef: opaqueRef });

const faxStatusReport = z.strictObject({
  faxRef: opaqueRef,
  status: faxStatus,
  /** Vendor-side retries so far; a rising count on a busy line is not yet a failure. */
  attempts: z.int().nonnegative(),
  updatedAt: isoDateTime,
  /** Present only on `failed`; coded, so a queue can retry `busy` and escalate `no_answer`. */
  failureCode: z.string().min(1).max(64).optional(),
});

const fetchInboundFaxesInput = z.strictObject({
  since: isoDateTime,
  limit: z.int().positive().max(200).optional(),
});

const inboundFaxBatch = z.strictObject({
  faxes: z
    .array(
      z.strictObject({
        faxRef: opaqueRef,
        fromNumber: z.string().min(1).max(20),
        receivedAt: isoDateTime,
        pageCount: z.int().positive(),
        /** Where the vendor placed the received document, for the owning service to file. */
        documentRef: opaqueRef,
        contentType: z.string().min(1).max(128),
      })
    )
    .readonly(),
});

/** Configuration for a fax adapter. */
export const faxConfig = z.strictObject({
  ...adapterConfigBase.shape,
  /** The practice's outbound caller identifier, in E.164. */
  callerNumber: z.string().min(4).max(20),
  /** The number inbound faxes arrive on. Requires the `inbound` feature to be useful. */
  inboundNumber: z.string().min(4).max(20).optional(),
});

/** Inferred shape of {@link faxConfig}. */
export type FaxConfig = z.infer<typeof faxConfig>;

/** Optional features a fax vendor may implement. */
export const FAX_FEATURES = ['inbound', 'cover_page', 'status_callback'] as const;

/** Input of `sendFax`. */
export type SendFaxInput = z.infer<typeof sendFaxInput>;
/** Output of `sendFax`. */
export type FaxReceipt = z.infer<typeof faxReceipt>;
/** Input of `getFaxStatus`. */
export type GetFaxStatusInput = z.infer<typeof getFaxStatusInput>;
/** Output of `getFaxStatus`. */
export type FaxStatusReport = z.infer<typeof faxStatusReport>;
/** Input of `fetchInboundFaxes`. */
export type FetchInboundFaxesInput = z.infer<typeof fetchInboundFaxesInput>;
/** Output of `fetchInboundFaxes`. */
export type InboundFaxBatch = z.infer<typeof inboundFaxBatch>;

/** The fax seam as data. */
export const FAX_CONTRACT = {
  capability: 'fax',
  contractVersion: FAX_CONTRACT_VERSION,
  config: faxConfig,
  features: FAX_FEATURES,
  operations: {
    sendFax: { input: sendFaxInput, output: faxReceipt },
    getFaxStatus: { input: getFaxStatusInput, output: faxStatusReport },
    fetchInboundFaxes: { input: fetchInboundFaxesInput, output: inboundFaxBatch },
  },
} as const satisfies CapabilityContract;

/** Everything a fax vendor must implement. */
export interface FaxAdapter extends Adapter<FaxConfig> {
  sendFax(input: SendFaxInput): Promise<AdapterResult<FaxReceipt>>;
  getFaxStatus(input: GetFaxStatusInput): Promise<AdapterResult<FaxStatusReport>>;
  /** Requires the `inbound` feature. */
  fetchInboundFaxes(input: FetchInboundFaxesInput): Promise<AdapterResult<InboundFaxBatch>>;
}

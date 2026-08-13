import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, opaqueRef } from './core.js';

/**
 * The diagnostics seam: placing an order with a performing laboratory and
 * collecting the result.
 *
 * Results cross this boundary as structured observations rather than as a raw
 * message, because every laboratory's dialect of the same message standard
 * differs and that translation is exactly the work an adapter exists to absorb.
 * The owning service receives the same shape from every vendor and can build
 * one flowsheet, one abnormal-first inbox and one sign-off path.
 */

/** Semver of this seam. */
export const LABS_CONTRACT_VERSION = '1.0.0';

/** Where an order stands with the performing laboratory. */
export const labOrderStatus = z.enum([
  'received',
  'in_transit',
  'in_progress',
  'resulted',
  'cancelled',
]);

/** Inferred shape of {@link labOrderStatus}. */
export type LabOrderStatus = z.infer<typeof labOrderStatus>;

/** Interpretation flag on a single analyte, using the customary abbreviations. */
export const abnormalFlag = z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high']);

/** Inferred shape of {@link abnormalFlag}. */
export type AbnormalFlag = z.infer<typeof abnormalFlag>;

const placeOrderInput = z.strictObject({
  /** Our ServiceRequest id, echoed back so an inbound result needs no fuzzy matching. */
  orderId: opaqueRef,
  patientRef: opaqueRef,
  orderingProviderRef: opaqueRef,
  testCode: z.string().min(1).max(64),
  testCodeSystem: z.string().min(1).max(128),
  priority: z.enum(['routine', 'urgent', 'stat']),
  specimenTypeCode: z.string().min(1).max(64).optional(),
  /** Diagnosis codes justifying medical necessity. Repeating by definition. */
  reasonCodes: z.array(z.string().min(1).max(16)).readonly(),
  /** Ask-at-order-entry answers, already collected by the form engine. */
  aoeAnswers: z
    .array(
      z.strictObject({
        questionCode: z.string().min(1).max(64),
        answer: z.string().min(1).max(512),
      })
    )
    .readonly(),
  requestedAt: isoDateTime,
});

const orderReceipt = z.strictObject({
  orderRef: opaqueRef,
  /** Printed on the requisition the patient carries to the draw site. */
  requisitionNumber: z.string().min(1).max(64),
  status: labOrderStatus,
  acceptedAt: isoDateTime,
});

const cancelOrderInput = z.strictObject({
  orderRef: opaqueRef,
  reasonCode: z.string().min(1).max(64),
});

const cancelOrderResult = z.strictObject({
  orderRef: opaqueRef,
  status: labOrderStatus,
  cancelledAt: isoDateTime,
});

const getOrderStatusInput = z.strictObject({ orderRef: opaqueRef });

const orderStatusReport = z.strictObject({
  orderRef: opaqueRef,
  status: labOrderStatus,
  updatedAt: isoDateTime,
  /** Set once a specimen has been collected; drives the outstanding-orders report. */
  collectedAt: isoDateTime.optional(),
});

const fetchResultsInput = z.strictObject({
  since: isoDateTime,
  limit: z.int().positive().max(500).optional(),
});

const resultBatch = z.strictObject({
  results: z
    .array(
      z.strictObject({
        resultRef: opaqueRef,
        orderRef: opaqueRef,
        /** `corrected` exists because a laboratory may restate a value the practice already acted on. */
        status: z.enum(['preliminary', 'final', 'corrected']),
        reportedAt: isoDateTime,
        /** True when any observation is flagged; lets the inbox sort abnormal-first without a scan. */
        abnormal: z.boolean(),
        observations: z
          .array(
            z.strictObject({
              code: z.string().min(1).max(64),
              codeSystem: z.string().min(1).max(128),
              display: z.string().min(1).max(256),
              valueNumber: z.number().optional(),
              valueText: z.string().min(1).max(1000).optional(),
              unit: z.string().min(1).max(32).optional(),
              referenceRange: z.string().min(1).max(64).optional(),
              flag: abnormalFlag,
            })
          )
          .readonly(),
      })
    )
    .readonly(),
});

/** Configuration for a laboratory adapter. */
export const labsConfig = z.strictObject({
  ...adapterConfigBase.shape,
  /** The practice's account with the performing laboratory. */
  accountNumber: z.string().min(1).max(64),
  /** Which compendium revision the order catalogue was imported from; a mismatch is a scheduled re-import. */
  compendiumVersion: z.string().min(1).max(32),
});

/** Inferred shape of {@link labsConfig}. */
export type LabsConfig = z.infer<typeof labsConfig>;

/** Optional features a laboratory vendor may implement. */
export const LABS_FEATURES = ['aoe', 'cancel', 'pdf_report', 'reflex'] as const;

/** Input of `placeOrder`. */
export type PlaceOrderInput = z.infer<typeof placeOrderInput>;
/** Output of `placeOrder`. */
export type OrderReceipt = z.infer<typeof orderReceipt>;
/** Input of `cancelOrder`. */
export type CancelOrderInput = z.infer<typeof cancelOrderInput>;
/** Output of `cancelOrder`. */
export type CancelOrderResult = z.infer<typeof cancelOrderResult>;
/** Input of `getOrderStatus`. */
export type GetOrderStatusInput = z.infer<typeof getOrderStatusInput>;
/** Output of `getOrderStatus`. */
export type OrderStatusReport = z.infer<typeof orderStatusReport>;
/** Input of `fetchResults`. */
export type FetchResultsInput = z.infer<typeof fetchResultsInput>;
/** Output of `fetchResults`. */
export type ResultBatch = z.infer<typeof resultBatch>;

/** The laboratory seam as data. */
export const LABS_CONTRACT = {
  capability: 'labs',
  contractVersion: LABS_CONTRACT_VERSION,
  config: labsConfig,
  features: LABS_FEATURES,
  operations: {
    placeOrder: { input: placeOrderInput, output: orderReceipt },
    cancelOrder: { input: cancelOrderInput, output: cancelOrderResult },
    fetchResults: { input: fetchResultsInput, output: resultBatch },
    getOrderStatus: { input: getOrderStatusInput, output: orderStatusReport },
  },
} as const satisfies CapabilityContract;

/** Everything a laboratory vendor must implement. */
export interface LabsAdapter extends Adapter<LabsConfig> {
  placeOrder(input: PlaceOrderInput): Promise<AdapterResult<OrderReceipt>>;
  /** Requires the `cancel` feature; some laboratories only accept cancellation by telephone. */
  cancelOrder(input: CancelOrderInput): Promise<AdapterResult<CancelOrderResult>>;
  fetchResults(input: FetchResultsInput): Promise<AdapterResult<ResultBatch>>;
  getOrderStatus(input: GetOrderStatusInput): Promise<AdapterResult<OrderStatusReport>>;
}

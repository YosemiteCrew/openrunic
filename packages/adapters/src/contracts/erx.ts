import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, moneyMinorUnits, opaqueRef } from './core.js';

/**
 * The prescribing seam: handing a finished prescription to an eRx network and
 * learning what became of it.
 *
 * The seam is deliberately narrower than the prescribing workflow. Drug
 * selection, interaction checking and the sig builder are Openrunic's, because
 * they are clinical surface a practice must be able to trust and audit. What
 * crosses this boundary is a completed order and the network's answer about
 * delivery, which is the only part a network is actually better at.
 */

/** Semver of this seam. A major bump means product code must be rebuilt against the new shapes. */
export const ERX_CONTRACT_VERSION = '1.0.0';

/**
 * Where a prescription has got to on the network. Terminal states are `filled`,
 * `cancelled` and `rejected`; everything else may still advance, which is why
 * the owning service polls or waits for a callback rather than assuming.
 */
export const prescriptionTransmissionStatus = z.enum([
  'queued',
  'transmitted',
  'filled',
  'cancel_requested',
  'cancelled',
  'rejected',
]);

/** Inferred shape of {@link prescriptionTransmissionStatus}. */
export type PrescriptionTransmissionStatus = z.infer<typeof prescriptionTransmissionStatus>;

const transmitPrescriptionInput = z.strictObject({
  /** Our own MedicationRequest id, echoed back so a callback can be matched without a lookup table. */
  prescriptionId: opaqueRef,
  patientRef: opaqueRef,
  prescriberRef: opaqueRef,
  /** Pharmacy directory entry chosen by the prescriber. */
  pharmacyRef: opaqueRef,
  drugCode: z.string().min(1).max(64),
  drugCodeSystem: z.string().min(1).max(128),
  /** Rendered sig text; the structured sig stays in the chart, since networks flatten it anyway. */
  sigText: z.string().min(1).max(1000),
  quantity: z.number().positive(),
  quantityUnit: z.string().min(1).max(32),
  refills: z.int().nonnegative().max(99),
  daysSupply: z.int().positive().max(365).optional(),
  dispenseAsWritten: z.boolean(),
  /** Controlled substance schedule as a coded string; jurisdictional, so never an enum. */
  controlledSchedule: z.string().min(1).max(8).optional(),
  writtenAt: isoDateTime,
});

const transmissionReceipt = z.strictObject({
  /** The network's handle for this transmission. Every later call names it. */
  transmissionRef: opaqueRef,
  status: prescriptionTransmissionStatus,
  acceptedAt: isoDateTime,
});

const checkFormularyInput = z.strictObject({
  patientRef: opaqueRef,
  coverageRef: opaqueRef,
  drugCode: z.string().min(1).max(64),
  drugCodeSystem: z.string().min(1).max(128),
});

const formularyResult = z.strictObject({
  status: z.enum(['on_formulary', 'off_formulary', 'unknown']),
  /** Plan tier when the benefit publishes one; absent is common and not an error. */
  tier: z.int().positive().max(9).optional(),
  priorAuthRequired: z.boolean(),
  /** Copay in integer minor units, when the benefit is specific enough to quote one. */
  copayMinorUnits: moneyMinorUnits.optional(),
  alternatives: z
    .array(
      z.strictObject({
        drugCode: z.string().min(1).max(64),
        drugCodeSystem: z.string().min(1).max(128),
        display: z.string().min(1).max(256),
        tier: z.int().positive().max(9).optional(),
      })
    )
    .readonly(),
});

const getTransmissionStatusInput = z.strictObject({ transmissionRef: opaqueRef });

const transmissionStatusReport = z.strictObject({
  transmissionRef: opaqueRef,
  status: prescriptionTransmissionStatus,
  updatedAt: isoDateTime,
  /** Every state the network reported, oldest first, so an audit can reconstruct the timeline. */
  history: z
    .array(z.strictObject({ status: prescriptionTransmissionStatus, at: isoDateTime }))
    .readonly(),
});

const cancelPrescriptionInput = z.strictObject({
  transmissionRef: opaqueRef,
  reasonCode: z.string().min(1).max(64),
});

const cancelPrescriptionResult = z.strictObject({
  transmissionRef: opaqueRef,
  status: prescriptionTransmissionStatus,
  requestedAt: isoDateTime,
});

/**
 * Configuration for an eRx adapter. `epcs` is config rather than a feature flag
 * because a network may support controlled substances while a given
 * installation is not enrolled, and the practice must be able to say so.
 */
export const erxConfig = z.strictObject({
  ...adapterConfigBase.shape,
  networkAccountId: z.string().min(1).max(64),
  epcs: z.boolean(),
});

/** Inferred shape of {@link erxConfig}. */
export type ErxConfig = z.infer<typeof erxConfig>;

/** Optional features an eRx vendor may implement. Callers gate on these, never on a vendor id. */
export const ERX_FEATURES = ['epcs', 'cancel', 'formulary'] as const;

/** Input of `transmitPrescription`. */
export type TransmitPrescriptionInput = z.infer<typeof transmitPrescriptionInput>;
/** Output of `transmitPrescription`. */
export type TransmissionReceipt = z.infer<typeof transmissionReceipt>;
/** Input of `checkFormulary`. */
export type CheckFormularyInput = z.infer<typeof checkFormularyInput>;
/** Output of `checkFormulary`. */
export type FormularyResult = z.infer<typeof formularyResult>;
/** Input of `getTransmissionStatus`. */
export type GetTransmissionStatusInput = z.infer<typeof getTransmissionStatusInput>;
/** Output of `getTransmissionStatus`. */
export type TransmissionStatusReport = z.infer<typeof transmissionStatusReport>;
/** Input of `cancelPrescription`. */
export type CancelPrescriptionInput = z.infer<typeof cancelPrescriptionInput>;
/** Output of `cancelPrescription`. */
export type CancelPrescriptionResult = z.infer<typeof cancelPrescriptionResult>;

/**
 * The eRx seam as data. The registry validates outputs through these schemas,
 * so a vendor cannot widen a field without the seam noticing.
 */
export const ERX_CONTRACT = {
  capability: 'erx',
  contractVersion: ERX_CONTRACT_VERSION,
  config: erxConfig,
  features: ERX_FEATURES,
  operations: {
    transmitPrescription: { input: transmitPrescriptionInput, output: transmissionReceipt },
    checkFormulary: { input: checkFormularyInput, output: formularyResult },
    getTransmissionStatus: {
      input: getTransmissionStatusInput,
      output: transmissionStatusReport,
    },
    cancelPrescription: { input: cancelPrescriptionInput, output: cancelPrescriptionResult },
  },
} as const satisfies CapabilityContract;

/** Everything an eRx vendor must implement. Product code depends on this interface and nothing below it. */
export interface ErxAdapter extends Adapter<ErxConfig> {
  transmitPrescription(
    input: TransmitPrescriptionInput
  ): Promise<AdapterResult<TransmissionReceipt>>;
  /** Requires the `formulary` feature. */
  checkFormulary(input: CheckFormularyInput): Promise<AdapterResult<FormularyResult>>;
  getTransmissionStatus(
    input: GetTransmissionStatusInput
  ): Promise<AdapterResult<TransmissionStatusReport>>;
  /** Requires the `cancel` feature; a network without it forces a phone call to the pharmacy. */
  cancelPrescription(
    input: CancelPrescriptionInput
  ): Promise<AdapterResult<CancelPrescriptionResult>>;
}

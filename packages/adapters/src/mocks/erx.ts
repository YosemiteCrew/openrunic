import { ok } from '@openrunic/types';

import type { AdapterResult } from '../contracts/core.js';
import { ERX_CONTRACT } from '../contracts/erx.js';
import type {
  CancelPrescriptionInput,
  CancelPrescriptionResult,
  CheckFormularyInput,
  ErxAdapter,
  ErxConfig,
  FormularyResult,
  GetTransmissionStatusInput,
  PrescriptionTransmissionStatus,
  TransmissionReceipt,
  TransmissionStatusReport,
  TransmitPrescriptionInput,
} from '../contracts/erx.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';
import { randomInt, randomPick } from './random.js';

/**
 * An in-process eRx network.
 *
 * It models the one thing that makes prescribing hard to test against a real
 * network: a transmission does not finish when the call returns. Each status
 * query advances the prescription one step along the same path a network walks,
 * so the refill queue, the status column and the cancel-too-late path can all
 * be driven end to end without a single controlled substance leaving the
 * building.
 */

/** Where a prescription goes next each time its status is polled. Terminal states map to themselves. */
const NEXT_STATUS: Readonly<
  Record<PrescriptionTransmissionStatus, PrescriptionTransmissionStatus>
> = {
  queued: 'transmitted',
  transmitted: 'filled',
  filled: 'filled',
  cancel_requested: 'cancelled',
  cancelled: 'cancelled',
  rejected: 'rejected',
};

const FORMULARY_STATUSES = ['on_formulary', 'off_formulary', 'unknown'] as const;

interface TransmissionState {
  status: PrescriptionTransmissionStatus;
  history: { status: PrescriptionTransmissionStatus; at: string }[];
}

/** The deterministic eRx mock. Default for development, demos and the seam loop in CI. */
export class MockErxAdapter extends MockAdapterBase<ErxConfig> implements ErxAdapter {
  private readonly transmissions = new Map<string, TransmissionState>();

  constructor(options: MockAdapterOptions = {}) {
    super(ERX_CONTRACT, options);
  }

  transmitPrescription(
    input: TransmitPrescriptionInput
  ): Promise<AdapterResult<TransmissionReceipt>> {
    return this.runOperation<TransmissionReceipt>(
      'transmitPrescription',
      [input.prescriptionId],
      () => {
        const transmissionRef = this.mintRef('rx');
        const acceptedAt = this.nowIso();
        this.transmissions.set(transmissionRef, {
          status: 'queued',
          history: [{ status: 'queued', at: acceptedAt }],
        });
        return ok({ transmissionRef, status: 'queued', acceptedAt });
      }
    );
  }

  checkFormulary(input: CheckFormularyInput): Promise<AdapterResult<FormularyResult>> {
    const gate = this.featureGate('checkFormulary', 'formulary');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<FormularyResult>('checkFormulary', [input.drugCode], () => {
      const status = randomPick(this.nextRandom, FORMULARY_STATUSES);
      const alternativeCount = randomInt(this.nextRandom, 3);
      return ok({
        status,
        tier: randomInt(this.nextRandom, 4) + 1,
        priorAuthRequired: status === 'off_formulary',
        copayMinorUnits: randomInt(this.nextRandom, 40) * 100,
        alternatives: Array.from({ length: alternativeCount }, (_unused, index) => ({
          drugCode: `ALT-${String(index + 1)}`,
          drugCodeSystem: input.drugCodeSystem,
          display: `Synthetic alternative ${String(index + 1)}`,
          tier: index + 1,
        })),
      });
    });
  }

  getTransmissionStatus(
    input: GetTransmissionStatusInput
  ): Promise<AdapterResult<TransmissionStatusReport>> {
    return this.runOperation<TransmissionStatusReport>(
      'getTransmissionStatus',
      [input.transmissionRef],
      () => {
        const state = this.transmissions.get(input.transmissionRef);
        if (state === undefined) {
          return this.reject('getTransmissionStatus', 'unknown_reference');
        }
        const updatedAt = this.nowIso();
        const next = NEXT_STATUS[state.status];
        if (next !== state.status) {
          state.status = next;
          state.history.push({ status: next, at: updatedAt });
        }
        return ok({
          transmissionRef: input.transmissionRef,
          status: state.status,
          updatedAt,
          history: [...state.history],
        });
      }
    );
  }

  cancelPrescription(
    input: CancelPrescriptionInput
  ): Promise<AdapterResult<CancelPrescriptionResult>> {
    const gate = this.featureGate('cancelPrescription', 'cancel');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<CancelPrescriptionResult>(
      'cancelPrescription',
      [input.transmissionRef],
      () => {
        const state = this.transmissions.get(input.transmissionRef);
        if (state === undefined) {
          return this.reject('cancelPrescription', 'unknown_reference');
        }
        if (state.status === 'filled') {
          // The pharmacy has already dispensed: cancelling is now a telephone
          // call, and pretending otherwise would hide that from the prescriber.
          return this.reject('cancelPrescription', 'already_dispensed');
        }
        const requestedAt = this.nowIso();
        state.status = state.status === 'queued' ? 'cancelled' : 'cancel_requested';
        state.history.push({ status: state.status, at: requestedAt });
        return ok({
          transmissionRef: input.transmissionRef,
          status: state.status,
          requestedAt,
        });
      }
    );
  }
}

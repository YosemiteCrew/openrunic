import { ok } from '@openrunic/types';

import { CLEARINGHOUSE_CONTRACT } from '../contracts/clearinghouse.js';
import type {
  AcknowledgementBatch,
  CheckEligibilityInput,
  ClearinghouseAdapter,
  ClearinghouseConfig,
  EligibilityResponse,
  FetchSinceInput,
  RemittanceBatch,
  SubmissionReceipt,
  SubmitClaimInput,
} from '../contracts/clearinghouse.js';
import type { AdapterResult } from '../contracts/core.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';

/**
 * An in-process clearinghouse.
 *
 * The whole revenue cycle is a loop with days of latency in it: a claim goes
 * out, an acknowledgement comes back, then a remittance, then a secondary
 * claim. This mock closes that loop in milliseconds - a submitted claim appears
 * in the next acknowledgement fetch, and an acknowledged claim appears in the
 * next remittance fetch - which is what makes auto-posting, exception handling
 * and the secondary cascade testable at all.
 *
 * The envelopes it produces are deliberately minimal and obviously synthetic.
 * They exist to be carried, not to be diagnostic fixtures; `@openrunic/x12`
 * owns realistic corpora.
 */

const DEFAULT_FETCH_LIMIT = 100;

/** Fraction of the charged amount a payer pays in the synthetic remittance. */
const MOCK_ALLOWED_RATE = 0.8;

interface SubmissionState {
  readonly submissionRef: string;
  readonly patientControlNumber: string;
  readonly payerId: string;
  readonly totalChargedMinorUnits: number;
  readonly submittedAt: string;
  acknowledged: boolean;
  remitted: boolean;
}

function minorUnitsToAmount(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

/** The deterministic clearinghouse mock. */
export class MockClearinghouseAdapter
  extends MockAdapterBase<ClearinghouseConfig>
  implements ClearinghouseAdapter
{
  private readonly submissions: SubmissionState[] = [];

  constructor(options: MockAdapterOptions = {}) {
    super(CLEARINGHOUSE_CONTRACT, options);
  }

  submitClaim(input: SubmitClaimInput): Promise<AdapterResult<SubmissionReceipt>> {
    return this.runOperation<SubmissionReceipt>('submitClaim', [input.meta.claimId], () => {
      const submissionRef = this.mintRef('sub');
      const acceptedAt = this.nowIso();
      this.submissions.push({
        submissionRef,
        patientControlNumber: input.meta.patientControlNumber,
        payerId: input.meta.payerId,
        totalChargedMinorUnits: input.meta.totalChargedMinorUnits,
        submittedAt: acceptedAt,
        acknowledged: false,
        remitted: false,
      });
      return ok({ submissionRef, acceptedAt, claimCount: 1 });
    });
  }

  checkEligibility(input: CheckEligibilityInput): Promise<AdapterResult<EligibilityResponse>> {
    const gate = this.featureGate('checkEligibility', 'eligibility');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<EligibilityResponse>(
      'checkEligibility',
      [String(input.edi270.length)],
      () => {
        const traceRef = this.mintRef('trace');
        return ok({
          traceRef,
          checkedAt: this.nowIso(),
          edi271: ['ST*271*0001~', `TRN*2*${traceRef}*9SYNTHETIC~`, 'EB*1**30~', 'SE*4*0001~'].join(
            ''
          ),
        });
      }
    );
  }

  fetchRemittances(input: FetchSinceInput): Promise<AdapterResult<RemittanceBatch>> {
    const gate = this.featureGate('fetchRemittances', 'remittance');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    const pending = this.pending(input, (state) => state.acknowledged && !state.remitted);
    return this.runOperation<RemittanceBatch>(
      'fetchRemittances',
      pending.map((state) => state.submissionRef),
      () =>
        ok({
          files: pending.map((state) => {
            state.remitted = true;
            const paid = Math.round(state.totalChargedMinorUnits * MOCK_ALLOWED_RATE);
            return {
              remittanceRef: this.mintRef('era'),
              payerId: state.payerId,
              receivedAt: this.nowIso(),
              totalPaidMinorUnits: paid,
              edi835: [
                'ST*835*0001~',
                `CLP*${state.patientControlNumber}*1*${minorUnitsToAmount(state.totalChargedMinorUnits)}*${minorUnitsToAmount(paid)}~`,
                'SE*3*0001~',
              ].join(''),
            };
          }),
        })
    );
  }

  fetchAcknowledgements(input: FetchSinceInput): Promise<AdapterResult<AcknowledgementBatch>> {
    const gate = this.featureGate('fetchAcknowledgements', 'acknowledgement');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    const pending = this.pending(input, (state) => !state.acknowledged);
    return this.runOperation<AcknowledgementBatch>(
      'fetchAcknowledgements',
      pending.map((state) => state.submissionRef),
      () =>
        ok({
          acknowledgements: pending.map((state) => {
            state.acknowledged = true;
            return {
              acknowledgementRef: this.mintRef('ack'),
              submissionRef: state.submissionRef,
              level: '999' as const,
              status: 'accepted' as const,
              receivedAt: this.nowIso(),
            };
          }),
        })
    );
  }

  /**
   * Selects the submissions a fetch would return, before the fetch runs. The
   * selection is named up front so `partial_success` injection can report a
   * verdict per submission rather than per call.
   */
  private pending(
    input: FetchSinceInput,
    predicate: (state: SubmissionState) => boolean
  ): SubmissionState[] {
    const since = Date.parse(input.since);
    return this.submissions
      .filter((state) => predicate(state) && Date.parse(state.submittedAt) >= since)
      .slice(0, input.limit ?? DEFAULT_FETCH_LIMIT);
  }
}

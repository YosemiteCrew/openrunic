import { ok } from '@openrunic/types';

import type { AdapterResult } from '../contracts/core.js';
import { FAX_CONTRACT } from '../contracts/fax.js';
import type {
  FaxAdapter,
  FaxConfig,
  FaxReceipt,
  FaxStatus,
  FaxStatusReport,
  FetchInboundFaxesInput,
  GetFaxStatusInput,
  InboundFaxBatch,
  SendFaxInput,
} from '../contracts/fax.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';
import { randomInt } from './random.js';

/**
 * An in-process fax vendor.
 *
 * Fax is the one channel where failure is routine rather than exceptional, so
 * the mock makes failure reachable without configuration: a fax longer than
 * {@link MOCK_FAX_PAGE_LIMIT} pages fails on its first status poll with a coded
 * reason, which is what a retry queue and an escalation task need to be tested
 * against.
 */

const DEFAULT_FETCH_LIMIT = 100;

/** Faxes longer than this fail in the mock, so the failure path needs no special setup. */
const MOCK_FAX_PAGE_LIMIT = 50;

/** How many inbound faxes the mock delivers, once, on the first inbound fetch. */
const MOCK_INBOUND_COUNT = 2;

interface FaxState {
  status: FaxStatus;
  attempts: number;
  readonly doomed: boolean;
}

interface InboundFax {
  readonly faxRef: string;
  readonly fromNumber: string;
  readonly receivedAt: string;
  readonly pageCount: number;
  readonly documentRef: string;
  readonly contentType: string;
}

/** The deterministic fax mock. */
export class MockFaxAdapter extends MockAdapterBase<FaxConfig> implements FaxAdapter {
  private readonly faxes = new Map<string, FaxState>();
  private readonly inbound: InboundFax[] = [];
  private inboundSeeded = false;

  constructor(options: MockAdapterOptions = {}) {
    super(FAX_CONTRACT, options);
  }

  sendFax(input: SendFaxInput): Promise<AdapterResult<FaxReceipt>> {
    return this.runOperation<FaxReceipt>('sendFax', [input.idempotencyKey], () => {
      const faxRef = this.mintRef('fax');
      this.faxes.set(faxRef, {
        status: 'queued',
        attempts: 0,
        doomed: input.pageCount > MOCK_FAX_PAGE_LIMIT,
      });
      return ok({
        faxRef,
        status: 'queued',
        pageCount: input.pageCount,
        queuedAt: this.nowIso(),
      });
    });
  }

  getFaxStatus(input: GetFaxStatusInput): Promise<AdapterResult<FaxStatusReport>> {
    return this.runOperation<FaxStatusReport>('getFaxStatus', [input.faxRef], () => {
      const state = this.faxes.get(input.faxRef);
      if (state === undefined) {
        return this.reject('getFaxStatus', 'unknown_reference');
      }
      state.status = this.advance(state);
      state.attempts += 1;
      return ok({
        faxRef: input.faxRef,
        status: state.status,
        attempts: state.attempts,
        updatedAt: this.nowIso(),
        ...(state.status === 'failed' ? { failureCode: 'line_busy' } : {}),
      });
    });
  }

  fetchInboundFaxes(input: FetchInboundFaxesInput): Promise<AdapterResult<InboundFaxBatch>> {
    const gate = this.featureGate('fetchInboundFaxes', 'inbound');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    this.seedInbound();
    const since = Date.parse(input.since);
    const pending = this.inbound
      .filter((fax) => Date.parse(fax.receivedAt) >= since)
      .slice(0, input.limit ?? DEFAULT_FETCH_LIMIT);
    return this.runOperation<InboundFaxBatch>(
      'fetchInboundFaxes',
      pending.map((fax) => fax.faxRef),
      () => ok({ faxes: pending })
    );
  }

  private advance(state: FaxState): FaxStatus {
    if (state.status === 'queued') {
      return state.doomed ? 'failed' : 'sending';
    }
    if (state.status === 'sending') {
      return 'delivered';
    }
    return state.status;
  }

  /**
   * Materialises the inbound tray once, so repeated polling does not grow an
   * unbounded queue the way a naive generator would and a demo can show the
   * same two faxes on every run.
   */
  private seedInbound(): void {
    if (this.inboundSeeded) {
      return;
    }
    this.inboundSeeded = true;
    for (let index = 0; index < MOCK_INBOUND_COUNT; index += 1) {
      this.inbound.push({
        faxRef: this.mintRef('infax'),
        fromNumber: `+1555010${String(randomInt(this.nextRandom, 9000) + 1000)}`,
        receivedAt: this.nowIso(),
        pageCount: randomInt(this.nextRandom, 4) + 1,
        documentRef: this.mintRef('doc'),
        contentType: 'application/pdf',
      });
    }
  }
}

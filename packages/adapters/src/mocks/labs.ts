import { ok } from '@openrunic/types';

import type { AdapterResult } from '../contracts/core.js';
import { LABS_CONTRACT } from '../contracts/labs.js';
import type {
  CancelOrderInput,
  CancelOrderResult,
  FetchResultsInput,
  GetOrderStatusInput,
  LabOrderStatus,
  LabsAdapter,
  LabsConfig,
  OrderReceipt,
  OrderStatusReport,
  PlaceOrderInput,
  ResultBatch,
} from '../contracts/labs.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';
import { randomInt } from './random.js';

/**
 * An in-process laboratory.
 *
 * An order does not resolve in one call in real life, so it does not here
 * either: each status poll walks the order one step from received through
 * collection to resulted, and the first fetch after that produces the report.
 * That is enough state to drive the results inbox, the abnormal-first sort, the
 * cumulative flowsheet and the outstanding-orders report without a laboratory
 * interface.
 */

const DEFAULT_FETCH_LIMIT = 100;

/** Where an order goes next each time it is polled. Terminal states map to themselves. */
const NEXT_STATUS: Readonly<Record<LabOrderStatus, LabOrderStatus>> = {
  received: 'in_transit',
  in_transit: 'in_progress',
  in_progress: 'resulted',
  resulted: 'resulted',
  cancelled: 'cancelled',
};

/**
 * Two obviously synthetic analytes. The first always reports inside its range
 * and the second always above it, so every fixture carries one normal and one
 * abnormal value and the inbox's abnormal-first path is exercised by default.
 */
const MOCK_ANALYTES = [
  { code: '718-7', display: 'Hemoglobin', unit: 'g/dL', floor: 12, range: '12.0-17.0' },
  { code: '2345-7', display: 'Glucose', unit: 'mg/dL', floor: 130, range: '70-110' },
] as const;

const LOINC_SYSTEM = 'http://loinc.org';

interface OrderState {
  readonly orderRef: string;
  status: LabOrderStatus;
  readonly placedAt: string;
  collectedAt: string | undefined;
  resultReleased: boolean;
}

/** The deterministic laboratory mock. */
export class MockLabsAdapter extends MockAdapterBase<LabsConfig> implements LabsAdapter {
  private readonly orders = new Map<string, OrderState>();

  constructor(options: MockAdapterOptions = {}) {
    super(LABS_CONTRACT, options);
  }

  placeOrder(input: PlaceOrderInput): Promise<AdapterResult<OrderReceipt>> {
    return this.runOperation<OrderReceipt>('placeOrder', [input.orderId], () => {
      const orderRef = this.mintRef('ord');
      const acceptedAt = this.nowIso();
      this.orders.set(orderRef, {
        orderRef,
        status: 'received',
        placedAt: acceptedAt,
        collectedAt: undefined,
        resultReleased: false,
      });
      return ok({
        orderRef,
        requisitionNumber: `REQ-${String(randomInt(this.nextRandom, 900_000) + 100_000)}`,
        status: 'received',
        acceptedAt,
      });
    });
  }

  cancelOrder(input: CancelOrderInput): Promise<AdapterResult<CancelOrderResult>> {
    const gate = this.featureGate('cancelOrder', 'cancel');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<CancelOrderResult>('cancelOrder', [input.orderRef], () => {
      const state = this.orders.get(input.orderRef);
      if (state === undefined) {
        return this.reject('cancelOrder', 'unknown_reference');
      }
      if (state.status === 'resulted') {
        // The specimen has already been run and billed; a cancellation now
        // would leave a result in the chart with no order behind it.
        return this.reject('cancelOrder', 'already_resulted');
      }
      state.status = 'cancelled';
      return ok({ orderRef: input.orderRef, status: state.status, cancelledAt: this.nowIso() });
    });
  }

  fetchResults(input: FetchResultsInput): Promise<AdapterResult<ResultBatch>> {
    const since = Date.parse(input.since);
    const pending = [...this.orders.values()]
      .filter(
        (state) =>
          !state.resultReleased &&
          state.status !== 'cancelled' &&
          Date.parse(state.placedAt) >= since
      )
      .slice(0, input.limit ?? DEFAULT_FETCH_LIMIT);
    return this.runOperation<ResultBatch>(
      'fetchResults',
      pending.map((state) => state.orderRef),
      () =>
        ok({
          results: pending.map((state) => {
            state.resultReleased = true;
            state.status = 'resulted';
            const observations = MOCK_ANALYTES.map((analyte, index) => ({
              code: analyte.code,
              codeSystem: LOINC_SYSTEM,
              display: analyte.display,
              valueNumber: analyte.floor + randomInt(this.nextRandom, 20) / 10,
              unit: analyte.unit,
              referenceRange: analyte.range,
              flag: index === 0 ? ('normal' as const) : ('high' as const),
            }));
            return {
              resultRef: this.mintRef('res'),
              orderRef: state.orderRef,
              status: 'final' as const,
              reportedAt: this.nowIso(),
              abnormal: observations.some((observation) => observation.flag !== 'normal'),
              observations,
            };
          }),
        })
    );
  }

  getOrderStatus(input: GetOrderStatusInput): Promise<AdapterResult<OrderStatusReport>> {
    return this.runOperation<OrderStatusReport>('getOrderStatus', [input.orderRef], () => {
      const state = this.orders.get(input.orderRef);
      if (state === undefined) {
        return this.reject('getOrderStatus', 'unknown_reference');
      }
      const updatedAt = this.nowIso();
      state.status = NEXT_STATUS[state.status];
      if (state.status === 'in_transit') {
        state.collectedAt = updatedAt;
      }
      return ok({
        orderRef: input.orderRef,
        status: state.status,
        updatedAt,
        ...(state.collectedAt === undefined ? {} : { collectedAt: state.collectedAt }),
      });
    });
  }
}

import { describe, expect, it } from 'vitest';

import {
  fromIsoDate,
  movementColumns,
  statusOf,
  toIsoDate,
  toLot,
  toMovement,
  toStockItem,
  todayAt,
} from '../inventory/marshal.js';
import type { ScopedRow } from '../repositories/rows.js';

import { DEMO_FACILITY_A, storageColumns, testId } from './support.js';

/**
 * The seam where a stored row becomes something `@openrunic/inventory` accepts.
 *
 * Two things can go wrong here and neither of them throws. A date read in the
 * wrong timezone expires a lot a day early or a day late; a `null` passed
 * through where the package expects an absence turns "never flag this item" into
 * "flag it at zero", or takes a balance read down with a `RangeError` on a
 * column that is legitimately empty. So the cases below are all about days and
 * about absence.
 */

const ITEM = testId(10);
const LOT = testId(20);

function lotRow(overrides: Partial<ScopedRow<'StockLot'>> = {}): ScopedRow<'StockLot'> {
  return {
    ...storageColumns(LOT),
    itemId: ITEM,
    facilityId: DEMO_FACILITY_A,
    lotNumber: 'LOT-A',
    status: 'AVAILABLE',
    expiresOn: null,
    openedOn: null,
    beyondUseDays: null,
    manufacturer: null,
    ndcCode: null,
    receivedOn: new Date('2026-01-05T00:00:00.000Z'),
    ...overrides,
  };
}

function itemRow(overrides: Partial<ScopedRow<'StockItem'>> = {}): ScopedRow<'StockItem'> {
  return {
    ...storageColumns(ITEM),
    sku: 'AMOX-500',
    name: 'Amoxicillin 500 mg capsule',
    unit: 'capsule',
    rxnormCode: null,
    ndcCode: null,
    cvxCode: null,
    packSize: null,
    reorderLevel: null,
    controlled: false,
    controlledSchedule: null,
    active: true,
    ...overrides,
  };
}

function movementRow(
  overrides: Partial<ScopedRow<'StockMovement'>> = {}
): ScopedRow<'StockMovement'> {
  return {
    ...storageColumns(testId(30)),
    postingId: testId(40),
    lotId: LOT,
    itemId: ITEM,
    facilityId: DEMO_FACILITY_A,
    kind: 'RECEIPT',
    quantity: 100,
    occurredOn: new Date('2026-01-05T00:00:00.000Z'),
    actorId: testId(951),
    reason: null,
    correctsMovementId: null,
    lotSeq: 1,
    ...overrides,
  };
}

describe('reading a day column', () => {
  /**
   * A `@db.Date` column comes back as midnight UTC. Reading it with the local
   * fields would render it as the previous day anywhere west of Greenwich, and
   * the package compares dates lexicographically - so the lot would read as
   * expiring a day early on every screen that showed it.
   */
  it('reads midnight UTC as the day it is, not the day it is locally', () => {
    expect(toIsoDate(new Date('2026-08-17T00:00:00.000Z'))).toBe('2026-08-17');
  });

  it('makes a round trip that compares equal to what Postgres would hand back', () => {
    expect(fromIsoDate('2026-08-17').toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(toIsoDate(fromIsoDate('2028-02-29'))).toBe('2028-02-29');
  });
});

describe('today, where the stock physically is', () => {
  it('is the UTC day for a facility that keeps UTC', () => {
    expect(todayAt('UTC', new Date('2026-08-17T23:59:00.000Z'))).toBe('2026-08-17');
  });

  /**
   * The case the whole function exists for. Nine in the evening in Los Angeles
   * is already tomorrow in UTC, and judging a beyond-use window against tomorrow
   * retires a vial a day early.
   */
  it('is still today for a west-coast clinic that UTC has already carried into tomorrow', () => {
    expect(todayAt('America/Los_Angeles', new Date('2026-08-18T04:00:00.000Z'))).toBe('2026-08-17');
  });

  /**
   * A fixed offset would get this wrong. On the day the clocks go back, Los
   * Angeles is still on PDT (UTC-7) until two in the morning, so local midnight
   * fell at 07:00 UTC rather than at 08:00; assuming PST here would report the
   * previous day for the next hour.
   */
  it('uses the offset in force on the day, not a fixed one', () => {
    expect(todayAt('America/Los_Angeles', new Date('2026-11-01T07:30:00.000Z'))).toBe('2026-11-01');
    expect(todayAt('America/Los_Angeles', new Date('2026-11-01T06:30:00.000Z'))).toBe('2026-10-31');
  });

  it('runs ahead of UTC where the timezone does', () => {
    expect(todayAt('Pacific/Kiritimati', new Date('2026-08-17T11:00:00.000Z'))).toBe('2026-08-18');
  });
});

describe('a stored lot, as the package reads one', () => {
  /**
   * `null` is not passed through. `assertIsoDate(null)` throws a `RangeError`
   * out of `lastUsableDay`, which every balance read and every allocation goes
   * through - so one legitimately undated carton would take the whole item's
   * ledger offline.
   */
  it('omits the dates a lot does not have rather than carrying null', () => {
    const lot = toLot(lotRow());

    expect(lot).toEqual({
      id: LOT,
      itemId: ITEM,
      lotNumber: 'LOT-A',
      status: 'AVAILABLE',
      receivedOn: '2026-01-05',
    });
    expect('expiresOn' in lot).toBe(false);
    expect('openedOn' in lot).toBe(false);
    expect('beyondUseDays' in lot).toBe(false);
  });

  it('carries both clocks when the carton has both', () => {
    const lot = toLot(
      lotRow({
        expiresOn: new Date('2027-06-30T00:00:00.000Z'),
        openedOn: new Date('2026-08-01T00:00:00.000Z'),
        beyondUseDays: 28,
      })
    );

    expect(lot.expiresOn).toBe('2027-06-30');
    expect(lot.openedOn).toBe('2026-08-01');
    expect(lot.beyondUseDays).toBe(28);
  });
});

/**
 * The status a listing renders, which has to be one of the four.
 *
 * `statusAt` returns a plain string because it must never throw: a history it
 * cannot order comes back as a sentinel, and the package's own callers have
 * fail-closed branches to take. A list has no such branch - every row it renders
 * carries a status - so the sentinel has to be turned back into something the
 * contract allows before it reaches a response.
 */
describe('the status a listing reports', () => {
  const lot = (
    status: string,
    history?: { status: string; effectiveOn: string }[]
  ): Parameters<typeof statusOf>[0] =>
    ({
      id: LOT,
      itemId: ITEM,
      lotNumber: 'LOT-A',
      status,
      receivedOn: '2026-01-05',
      ...(history === undefined ? {} : { statusHistory: history }),
    }) as Parameters<typeof statusOf>[0];

  it('resolves the day from the recorded history', () => {
    const held = lot('RECALLED', [
      { status: 'AVAILABLE', effectiveOn: '2026-01-05' },
      { status: 'RECALLED', effectiveOn: '2026-03-10' },
    ]);

    expect(statusOf(held, '2026-03-01')).toBe('AVAILABLE');
    expect(statusOf(held, '2026-03-10')).toBe('RECALLED');
  });

  it('reads the column when nothing is recorded', () => {
    expect(statusOf(lot('QUARANTINED'), '2026-03-01')).toBe('QUARANTINED');
  });

  /**
   * The fallback the route cannot reach: `effectiveOn` is a date column rendered
   * canonically, and `asOf` is either validated by the schema or produced by
   * `todayAt`. It is here because the parameter type says `string`, and the next
   * caller will have no reason to know that.
   */
  it('falls back to the column when the history cannot be ordered', () => {
    // Unpadded, and the dangerous case rather than obvious garbage: every
    // comparison in the package is lexicographic, so `'2026-3-10'` sorts after
    // `'2026-09-01'` and a recall would read as not yet in force.
    const corrupt = lot('AVAILABLE', [{ status: 'RECALLED', effectiveOn: '2026-3-10' }]);

    expect(statusOf(corrupt, '2026-04-01')).toBe('AVAILABLE');
  });
});

describe('a stored catalogue item, as the package reads one', () => {
  /**
   * The sharpest of the null conversions. `reorderLevel: null` means "never flag
   * this item"; passed through as null it compares `<= null` as `<= 0`, so an
   * item nobody wanted flagged is flagged the moment it empties - and an item
   * that genuinely reorders at zero is indistinguishable from it.
   */
  it('omits an absent reorder level rather than turning it into zero', () => {
    const item = toStockItem(itemRow());

    expect('reorderLevel' in item).toBe(false);
    expect('packSize' in item).toBe(false);
    expect(item).toEqual({
      id: ITEM,
      name: 'Amoxicillin 500 mg capsule',
      unit: 'capsule',
      controlled: false,
    });
  });

  it('carries a pack size and a reorder level when the item has them', () => {
    const item = toStockItem(itemRow({ packSize: 20, reorderLevel: 0, controlled: true }));

    expect(item.packSize).toBe(20);
    expect(item.reorderLevel).toBe(0);
    expect(item.controlled).toBe(true);
  });
});

describe('a stored ledger line, as the package reads one', () => {
  it('omits the reason and the correction link when the row carries neither', () => {
    const movement = toMovement(movementRow());

    expect(movement).toEqual({
      id: testId(30),
      lotId: LOT,
      itemId: ITEM,
      kind: 'RECEIPT',
      quantity: 100,
      occurredOn: '2026-01-05',
      actorId: testId(951),
    });
  });

  it('carries them when it does', () => {
    const movement = toMovement(
      movementRow({ reason: 'broken vial', correctsMovementId: testId(31) })
    );

    expect(movement.reason).toBe('broken vial');
    expect(movement.correctsMovementId).toBe(testId(31));
  });
});

describe('a package movement, as the columns of a row', () => {
  /**
   * The mirror image, and load-bearing for the same reason: a spec returns the
   * whole row so the two storage implementations cannot disagree about a
   * default, and an absent key would leave the in-memory row without the column
   * while Postgres wrote a null.
   */
  it('writes null back for what the package left absent', () => {
    const columns = movementColumns(
      {
        id: testId(30),
        lotId: LOT,
        itemId: ITEM,
        kind: 'DISPENSE',
        quantity: 20,
        occurredOn: '2026-08-17',
        actorId: testId(951),
      },
      { postingId: testId(40), facilityId: DEMO_FACILITY_A, lotSeq: 4 }
    );

    expect(columns).toEqual({
      postingId: testId(40),
      lotId: LOT,
      itemId: ITEM,
      facilityId: DEMO_FACILITY_A,
      kind: 'DISPENSE',
      quantity: 20,
      occurredOn: new Date('2026-08-17T00:00:00.000Z'),
      actorId: testId(951),
      reason: null,
      correctsMovementId: null,
      lotSeq: 4,
    });
  });

  it('takes the site and the sequence from the placement, not from the movement', () => {
    const columns = movementColumns(
      {
        id: testId(30),
        lotId: LOT,
        itemId: ITEM,
        kind: 'WASTE',
        quantity: 1,
        occurredOn: '2026-08-17',
        actorId: testId(951),
        reason: 'drawn and not used',
      },
      { postingId: testId(41), facilityId: DEMO_FACILITY_A, lotSeq: 9 }
    );

    expect(columns.facilityId).toBe(DEMO_FACILITY_A);
    expect(columns.lotSeq).toBe(9);
    expect(columns.reason).toBe('drawn and not used');
  });
});

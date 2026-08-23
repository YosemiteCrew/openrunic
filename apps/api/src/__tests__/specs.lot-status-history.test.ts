import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';
import { inventorySpecs } from '../repositories/specs/inventory.js';

import { FIXED_NOW, testId } from './support.js';

/**
 * The lot status history, as the two ports and the write door see it.
 *
 * The table exists because `StockLot.status` was one mutable value, so every
 * as-of question was answered with today's answer: a lot retired on the 10th
 * dropped out of a query about the 1st, and a reconciliation of the 1st then
 * came up short against a shelf that had been correct.
 *
 * `repositories.port-agreement.test.ts` already asserts that `matches` and
 * `where` agree for this spec, including with `lotId` and `lotIds` in conflict.
 * What is left, and what these cover, is the half a differential test cannot
 * reach: what a row is built from, what a patch may change, and how a history
 * is ordered.
 */
const spec = inventorySpecs.stockLotStatusChanges;

const LOT = testId(700);
const ACTOR = testId(900);

const paged = { page: 1, pageSize: 25, order: 'asc' } as const;

describe('writing a lot status change', () => {
  it('records who acted, when it took effect and why', () => {
    const row = spec.newRow(
      {
        lotId: LOT,
        status: 'RECALLED',
        effectiveOn: new Date('2026-09-10T00:00:00.000Z'),
        lotSeq: 2,
        reason: 'Manufacturer recall R-2026-114',
        actorId: ACTOR,
      },
      { tenantId: testId(1), now: FIXED_NOW, nextId: () => testId(2) }
    );

    expect(row).toEqual({
      lotId: LOT,
      status: 'RECALLED',
      effectiveOn: new Date('2026-09-10T00:00:00.000Z'),
      lotSeq: 2,
      reason: 'Manufacturer recall R-2026-114',
      actorId: ACTOR,
    });
  });

  /**
   * Both are nullable, and the nullability is load bearing rather than lax.
   * Backfilled rows describe transitions that predate the table: there is
   * nobody to name and no reason on file, and inventing either would be a fact
   * the record never stated.
   */
  it('leaves the actor and the reason null when there is nobody and nothing to name', () => {
    const row = spec.newRow(
      { lotId: LOT, status: 'AVAILABLE', effectiveOn: FIXED_NOW, lotSeq: 1 },
      { tenantId: testId(1), now: FIXED_NOW, nextId: () => testId(2) }
    );

    expect(row.actorId).toBeNull();
    expect(row.reason).toBeNull();
  });

  /**
   * A transition that was recorded happened, and a record of it that can be
   * edited is not a record of anything. The type says so too - the patch is
   * `Record<string, never>` - and the migration revokes UPDATE and DELETE from
   * the application role, so this is the third of three doors rather than the
   * only one.
   */
  it('accepts no amendment at all', () => {
    const row = { lotId: LOT } as unknown as ScopedRow<'StockLotStatusChange'>;

    expect(
      spec.patchData({}, row, { tenantId: testId(1), now: FIXED_NOW, nextId: () => testId(2) })
    ).toEqual({});
  });
});

describe('reading a lot history in order', () => {
  const change = (over: Partial<ScopedRow<'StockLotStatusChange'>>) =>
    ({
      id: testId(10),
      lotId: LOT,
      status: 'AVAILABLE',
      effectiveOn: new Date('2026-08-01T00:00:00.000Z'),
      lotSeq: 1,
      createdAt: FIXED_NOW,
      ...over,
    }) as ScopedRow<'StockLotStatusChange'>;

  it('sorts by the day it took effect by default', () => {
    expect(spec.sortValue(change({}), 'effectiveOn')).toBe(
      new Date('2026-08-01T00:00:00.000Z').getTime()
    );
  });

  it('sorts by sequence, which is what separates two changes on one day', () => {
    expect(spec.sortValue(change({ lotSeq: 7 }), 'lotSeq')).toBe(7);
  });

  it('sorts by when the row was written, for an audit view', () => {
    expect(spec.sortValue(change({}), 'createdAt')).toBe(FIXED_NOW.getTime());
  });

  /**
   * The tie-break is `lotSeq` and not `id`. A recall and the quarantine it
   * followed can share a day, and ordering them by whichever uuid sorted first
   * would put the history in an order nothing did.
   */
  it('breaks a same-day tie by sequence rather than by id', () => {
    expect(spec.orderBy({ ...paged, sort: 'effectiveOn' })).toEqual([
      { effectiveOn: 'asc' },
      { lotSeq: 'asc' },
    ]);
  });

  it('orders by sequence and by written-at when asked for those', () => {
    expect(spec.orderBy({ ...paged, sort: 'lotSeq' })).toEqual([{ lotSeq: 'asc' }, { id: 'asc' }]);
    expect(spec.orderBy({ ...paged, sort: 'createdAt', order: 'desc' })).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });
});

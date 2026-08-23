import { describe, expect, it } from 'vitest';

import { isApiError, type FieldIssue } from '../errors.js';
import { causeText } from '../inventory/posting.js';
import type { RowContext } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import {
  stockItemSpec,
  stockLotSpec,
  stockMovementSpec,
  stockPostingSpec,
} from '../repositories/specs/inventory.js';

import { DEMO_FACILITY_A, DEMO_TENANT_A, FIXED_NOW, storageColumns, testId } from './support.js';

/**
 * The parts of the four specs that no route can reach.
 *
 * Everything else in these specs is exercised through HTTP by
 * `routes.inventory.test.ts`, which is the right way round: a spec is a
 * description of behaviour that both storage implementations read, and driving
 * it through the app proves the description was read. What is left over is the
 * three refusals that exist precisely so no route can do the thing - the ledger
 * has no PATCH, so `patchData` is unreachable, and the write door is unreachable
 * with an invalid line because the routes build their lines from the package's
 * own output.
 */

const ITEM = testId(10);
const LOT = testId(20);
const POSTING = testId(40);

const CONTEXT: RowContext = {
  tenantId: DEMO_TENANT_A,
  now: FIXED_NOW,
  nextId: () => testId(99),
};

function postingRow(): ScopedRow<'StockPosting'> {
  return {
    ...storageColumns(POSTING),
    kind: 'WASTAGE',
    facilityId: DEMO_FACILITY_A,
    patientId: null,
    encounterId: null,
    prescriptionId: null,
    immunizationId: null,
    occurredOn: new Date('2026-08-17T00:00:00.000Z'),
    postedById: testId(951),
    witnessedById: null,
    reference: null,
    note: null,
  };
}

/**
 * A posting whose one line is a WASTE with no reason.
 *
 * The package requires a reason on a waste, on both count variances and on any
 * correction, because a quantity that changed for a reason nobody wrote down is
 * the entry an auditor asks about and nobody can answer.
 */
function reasonlessWaste(): Parameters<NonNullable<typeof stockPostingSpec.childRows>>[0] {
  return {
    kind: 'WASTAGE',
    facilityId: DEMO_FACILITY_A,
    occurredOn: new Date('2026-08-17T00:00:00.000Z'),
    postedById: testId(951),
    lines: [
      {
        movement: {
          id: testId(30),
          lotId: LOT,
          itemId: ITEM,
          kind: 'WASTE',
          quantity: 2,
          occurredOn: '2026-08-17',
          actorId: testId(951),
        },
        lotSeq: 3,
      },
    ],
  };
}

describe('the write door', () => {
  /**
   * The package's own sentence reaches the client, addressed to the line it was
   * about. A generic "invalid movement" would leave a stockroom clerk with a
   * screenful of lines and no idea which one to fix.
   */
  it('refuses the whole posting when one of its lines is not valid, naming the line', () => {
    const refusal = refusalFrom(() =>
      stockPostingSpec.childRows?.(reasonlessWaste(), postingRow(), CONTEXT)
    );

    expect(refusal.status).toBe(422);
    expect(refusal.issues).toEqual([
      { path: 'lines.0', message: 'A WASTE movement must say why.' },
    ]);
  });

  /**
   * A receipt of a carton number this site has never seen writes the lot and its
   * first movement together, in that order, because the movement's foreign key
   * names the lot. Two calls would leave a carton that exists and holds nothing.
   */
  it('writes a new lot before the movement that references it', () => {
    const input = reasonlessWaste();
    const batches = stockPostingSpec.childRows?.(
      {
        ...input,
        kind: 'RECEIPT',
        newLots: [
          {
            id: LOT,
            itemId: ITEM,
            facilityId: DEMO_FACILITY_A,
            lotNumber: 'LOT-NEW',
            receivedOn: new Date('2026-08-17T00:00:00.000Z'),
          },
        ],
        lines: [
          {
            movement: {
              id: testId(30),
              lotId: LOT,
              itemId: ITEM,
              kind: 'RECEIPT',
              quantity: 40,
              occurredOn: '2026-08-17',
              actorId: testId(951),
            },
            lotSeq: 1,
          },
        ],
      },
      postingRow(),
      CONTEXT
    );

    // Order is the contract: the lot exists before the row that names it, and
    // before the movement that references it.
    expect(batches?.map((batch) => batch.model)).toEqual([
      'StockLot',
      'StockLotStatusChange',
      'StockMovement',
    ]);
    expect(batches?.[0]?.rows[0]).toMatchObject({
      id: LOT,
      lotNumber: 'LOT-NEW',
      status: 'AVAILABLE',
    });
    expect(batches?.[2]?.rows[0]).toMatchObject({ postingId: POSTING, lotSeq: 1, quantity: 40 });
  });

  /**
   * A lot minted here starts its history in the same transaction.
   *
   * Without the opening entry the first recorded change would also be the
   * earliest one, and `statusAt` takes the earliest entry as the state before
   * it. A carton received in August and recalled in September would read as
   * recalled in August too - the fail-safe direction, but not what happened,
   * and a back-dated reconciliation would come up short by a carton that was
   * genuinely on the shelf.
   */
  it('opens a status history for every lot it mints', () => {
    const input = reasonlessWaste();
    const receivedOn = new Date('2026-08-17T00:00:00.000Z');
    const batches = stockPostingSpec.childRows?.(
      {
        ...input,
        kind: 'RECEIPT',
        newLots: [
          {
            id: LOT,
            itemId: ITEM,
            facilityId: DEMO_FACILITY_A,
            lotNumber: 'LOT-NEW',
            receivedOn,
          },
        ],
        lines: [],
      },
      postingRow(),
      CONTEXT
    );

    const openings = batches?.find((batch) => batch.model === 'StockLotStatusChange');

    expect(openings?.rows).toHaveLength(1);
    expect(openings?.rows[0]).toMatchObject({
      lotId: LOT,
      status: 'AVAILABLE',
      effectiveOn: receivedOn,
      lotSeq: 1,
      // The person who booked the delivery in is the person who put the lot
      // into the state it starts in.
      actorId: input.postedById,
      reason: null,
    });
  });

  /**
   * A count where every lot agreed writes a posting and no lines at all. The
   * posting is the point: proving the shelf was right is most of what a count is
   * for, and a posting that vanished when it found nothing would make a clean
   * count indistinguishable from a count nobody ran.
   */
  it('writes an empty movement batch rather than no batch at all', () => {
    const batches = stockPostingSpec.childRows?.(
      { ...reasonlessWaste(), kind: 'COUNT', lines: [] },
      postingRow(),
      CONTEXT
    );

    expect(batches?.map((batch) => batch.model)).toEqual(['StockMovement']);
    expect(batches?.[0]?.rows).toEqual([]);
  });
});

describe('the ledger has no amend', () => {
  /**
   * Unreachable through HTTP, which is why it is tested here. Postgres refuses
   * an UPDATE on `StockMovement` because the migration revokes the privilege;
   * the in-memory store has no grants, so without these throws a green suite
   * would mean something Postgres would have rejected.
   */
  it('refuses to amend a posting', () => {
    expect(() => stockPostingSpec.patchData({}, postingRow(), CONTEXT)).toThrow('append-only');
  });

  it('refuses to amend a movement', () => {
    expect(() => stockMovementSpec.patchData({}, movementRow(), CONTEXT)).toThrow('append-only');
  });
});

describe('a movement built on its own', () => {
  /**
   * No route reaches this: movements exist only as children of a posting, which
   * is what makes a dispense drawn from three lots one act rather than three.
   * The create path exists because the spec type requires it, and it goes
   * through the same column builder the posting's `childRows` uses - so this
   * asserts the two cannot disagree.
   */
  it('goes through the same column builder as a posted line', () => {
    const columns = stockMovementSpec.newRow(
      {
        postingId: POSTING,
        facilityId: DEMO_FACILITY_A,
        lotSeq: 7,
        movement: {
          id: testId(30),
          lotId: LOT,
          itemId: ITEM,
          kind: 'ADMINISTER',
          quantity: 1,
          occurredOn: '2026-08-17',
          actorId: testId(951),
        },
      },
      CONTEXT
    );

    expect(columns).toMatchObject({
      postingId: POSTING,
      facilityId: DEMO_FACILITY_A,
      lotSeq: 7,
      kind: 'ADMINISTER',
      reason: null,
      correctsMovementId: null,
      occurredOn: new Date('2026-08-17T00:00:00.000Z'),
    });
  });

  it('is checked by the same rules a posted line is', () => {
    const refusal = refusalFrom(() =>
      stockMovementSpec.newRow(
        {
          postingId: POSTING,
          facilityId: DEMO_FACILITY_A,
          lotSeq: 1,
          movement: {
            id: testId(30),
            lotId: LOT,
            itemId: ITEM,
            kind: 'WASTE',
            quantity: 1,
            occurredOn: '2026-08-17',
            actorId: testId(951),
          },
        },
        CONTEXT
      )
    );

    expect(refusal.issues[0]?.message).toBe('A WASTE movement must say why.');
  });
});

describe('the columns a create writes', () => {
  /**
   * A spec returns every column, defaults included, so the in-memory store and
   * Postgres receive the same values and a default can never be a place where
   * the two disagree.
   */
  it("fills an item's absent columns with the schema's own defaults", () => {
    expect(
      stockItemSpec.newRow({ sku: 'IBU-200', name: 'Ibuprofen 200 mg', unit: 'tablet' }, CONTEXT)
    ).toEqual({
      sku: 'IBU-200',
      name: 'Ibuprofen 200 mg',
      unit: 'tablet',
      rxnormCode: null,
      ndcCode: null,
      cvxCode: null,
      packSize: null,
      reorderLevel: null,
      controlled: false,
      controlledSchedule: null,
      active: true,
    });
  });

  it('keeps every column a create did name', () => {
    expect(
      stockItemSpec.newRow(
        {
          sku: 'FENT-25',
          name: 'Fentanyl 25 mcg patch',
          unit: 'patch',
          rxnormCode: '197696',
          ndcCode: '00000-0000-00',
          cvxCode: '208',
          packSize: 5,
          reorderLevel: 0,
          controlled: true,
          controlledSchedule: '2',
          active: false,
        },
        CONTEXT
      )
    ).toMatchObject({ reorderLevel: 0, controlled: true, controlledSchedule: '2', active: false });
  });

  it('brings a lot into stock available, with both clocks empty', () => {
    expect(
      stockLotSpec.newRow(
        {
          itemId: ITEM,
          facilityId: DEMO_FACILITY_A,
          lotNumber: 'LOT-A',
          receivedOn: new Date('2026-08-17T00:00:00.000Z'),
        },
        CONTEXT
      )
    ).toEqual({
      itemId: ITEM,
      facilityId: DEMO_FACILITY_A,
      lotNumber: 'LOT-A',
      status: 'AVAILABLE',
      expiresOn: null,
      openedOn: null,
      beyondUseDays: null,
      manufacturer: null,
      ndcCode: null,
      receivedOn: new Date('2026-08-17T00:00:00.000Z'),
    });
  });

  it('keeps the carton details a delivery came with', () => {
    expect(
      stockLotSpec.newRow(
        {
          itemId: ITEM,
          facilityId: DEMO_FACILITY_A,
          lotNumber: 'LOT-A',
          receivedOn: new Date('2026-08-17T00:00:00.000Z'),
          status: 'QUARANTINED',
          expiresOn: new Date('2027-06-30T00:00:00.000Z'),
          openedOn: new Date('2026-08-10T00:00:00.000Z'),
          beyondUseDays: 28,
          manufacturer: 'Testicorp',
          ndcCode: '00000-0000-00',
        },
        CONTEXT
      )
    ).toMatchObject({ status: 'QUARANTINED', beyondUseDays: 28, manufacturer: 'Testicorp' });
  });

  /**
   * An absent key means "not mentioned", never "clear this column". A patch that
   * nulled what it did not name would empty a lot's expiry the first time
   * somebody quarantined it.
   */
  it('changes only the columns a patch mentioned', () => {
    expect(stockLotSpec.patchData({ status: 'RECALLED' }, lotRow(), CONTEXT)).toEqual({
      status: 'RECALLED',
    });
    expect(stockItemSpec.patchData({ active: false }, itemRow(), CONTEXT)).toEqual({
      active: false,
    });
  });

  /**
   * A key that is present and holds `undefined` is the shape a caller building a
   * patch object with optional spreads produces. It means "not mentioned" just
   * as much as an absent key does, and writing it through would clear the
   * column.
   */
  it('drops a key that is present and undefined rather than clearing the column', () => {
    expect(
      stockItemSpec.patchData(
        { name: 'Amoxicillin 500 mg capsule', reorderLevel: undefined },
        itemRow(),
        CONTEXT
      )
    ).toEqual({ name: 'Amoxicillin 500 mg capsule' });
  });
});

describe('the natural keys the database enforces', () => {
  /**
   * `uniqueBy.where` is the Prisma half of the pair and `matches` is the
   * in-memory half; only the second is reachable through the HTTP suite, so the
   * first is asserted here. Two halves that disagree would mean a duplicate the
   * API refused in tests and accepted in production, or the reverse.
   */
  it('identifies an item by its catalogue code, the same way in both', () => {
    const input = { sku: 'AMOX-500', name: 'Amoxicillin', unit: 'capsule' };

    expect(stockItemSpec.uniqueBy?.where(input)).toEqual({ sku: 'AMOX-500' });
    expect(stockItemSpec.uniqueBy?.matches(itemRow(), input)).toBe(true);
    expect(stockItemSpec.uniqueBy?.matches({ ...itemRow(), sku: 'OTHER' }, input)).toBe(false);
    expect(stockItemSpec.uniqueBy?.message(input)).toContain('AMOX-500');
  });

  /**
   * A carton number is not unique on its own: suppliers reuse them, and the same
   * number at two sites is two boxes counted separately. The key is all three
   * columns, so a lot number that matches while the site does not is a different
   * carton.
   */
  it('identifies a lot by item, site and carton number together', () => {
    const input = {
      itemId: ITEM,
      facilityId: DEMO_FACILITY_A,
      lotNumber: 'LOT-A',
      receivedOn: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(stockLotSpec.uniqueBy?.where(input)).toEqual({
      itemId: ITEM,
      facilityId: DEMO_FACILITY_A,
      lotNumber: 'LOT-A',
    });
    expect(stockLotSpec.uniqueBy?.matches(lotRow(), input)).toBe(true);
    expect(stockLotSpec.uniqueBy?.matches({ ...lotRow(), facilityId: testId(99) }, input)).toBe(
      false
    );
    expect(stockLotSpec.uniqueBy?.matches({ ...lotRow(), itemId: testId(98) }, input)).toBe(false);
    expect(stockLotSpec.uniqueBy?.message(input)).toContain('LOT-A');
  });
});

/** Runs `act`, and hands back the `ApiError` it was supposed to raise. */
function refusalFrom(act: () => unknown): { status: number; issues: readonly FieldIssue[] } {
  try {
    act();
  } catch (error) {
    if (isApiError(error)) return { status: error.status, issues: error.issues };
    throw error;
  }
  throw new Error('the call was expected to be refused and was not');
}

describe('the filters the two storage implementations share', () => {
  /**
   * `matches` and `where` are two statements of one filter, and nothing in the
   * repository asserts that they agree. These pin the pairs a route does not
   * exercise: the posting list has no route of its own, because a posting is
   * read back as part of the act that wrote it.
   */
  it('narrows postings by site and by kind, the same way in both', () => {
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'occurredOn' as const,
      order: 'asc' as const,
      facilityId: DEMO_FACILITY_A,
      kind: 'WASTAGE' as const,
    };

    expect(stockPostingSpec.matches(postingRow(), query)).toBe(true);
    expect(stockPostingSpec.matches({ ...postingRow(), kind: 'COUNT' }, query)).toBe(false);
    expect(stockPostingSpec.where(query)).toEqual({
      facilityId: DEMO_FACILITY_A,
      kind: 'WASTAGE',
    });
  });

  it('constrains nothing when a posting query names nothing', () => {
    const query = { page: 1, pageSize: 25, sort: 'createdAt' as const, order: 'desc' as const };

    expect(stockPostingSpec.matches(postingRow(), query)).toBe(true);
    expect(stockPostingSpec.where(query)).toEqual({});
    expect(stockPostingSpec.orderBy(query)).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(stockPostingSpec.sortValue(postingRow(), 'createdAt')).toBe(FIXED_NOW.getTime());
  });

  /**
   * The day book and the ledger both default to the day the thing happened, not
   * the day it was typed. The two are different columns on purpose, and the gap
   * between them is what a back-dated entry is made of.
   */
  it('orders the ledger and the day book by when things happened', () => {
    const postings = { page: 1, pageSize: 25, sort: 'occurredOn' as const, order: 'asc' as const };
    const movements = {
      page: 1,
      pageSize: 25,
      sort: 'occurredOn' as const,
      order: 'desc' as const,
    };

    expect(stockPostingSpec.orderBy(postings)).toEqual([{ occurredOn: 'asc' }, { id: 'asc' }]);
    expect(stockPostingSpec.sortValue(postingRow(), 'occurredOn')).toBe(
      new Date('2026-08-17T00:00:00.000Z').getTime()
    );
    expect(stockMovementSpec.orderBy(movements)).toEqual([{ occurredOn: 'desc' }, { id: 'asc' }]);
    expect(stockMovementSpec.sortValue(movementRow(), 'occurredOn')).toBe(
      new Date('2026-01-05T00:00:00.000Z').getTime()
    );
    expect(stockLotSpec.orderBy(lotQuery('expiresOn'))).toEqual([
      { expiresOn: 'asc' },
      { id: 'asc' },
    ]);
  });

  /**
   * A lot that cannot expire sorts last ascending, mirroring `fefo`: there is
   * never a reason to spend an undated carton ahead of one with a clock on it.
   * The sentinel is a string rather than `Infinity` because the memory
   * comparator subtracts numbers, and `Infinity - Infinity` is `NaN` - which
   * would make two undated lots compare as neither before nor after each other.
   */
  it('sorts a lot that cannot expire behind every lot that can', () => {
    const dated = { ...lotRow(), expiresOn: new Date('2027-01-01T00:00:00.000Z') };

    expect(stockLotSpec.sortValue(lotRow(), 'expiresOn')).toBe('9999-12-31');
    expect(stockLotSpec.sortValue(dated, 'expiresOn') < '9999-12-31').toBe(true);
  });

  it('sorts lots by arrival and by carton number when asked to', () => {
    expect(stockLotSpec.sortValue(lotRow(), 'receivedOn')).toBe(
      new Date('2026-01-05T00:00:00.000Z').getTime()
    );
    expect(stockLotSpec.sortValue(lotRow(), 'lotNumber')).toBe('LOT-A');
    expect(stockLotSpec.sortValue(lotRow(), 'createdAt')).toBe(FIXED_NOW.getTime());
    expect(stockLotSpec.orderBy(lotQuery('receivedOn'))).toEqual([
      { receivedOn: 'asc' },
      { id: 'asc' },
    ]);
    expect(stockLotSpec.orderBy(lotQuery('lotNumber'))).toEqual([
      { lotNumber: 'asc' },
      { id: 'asc' },
    ]);
    expect(stockLotSpec.orderBy(lotQuery('createdAt'))).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('sorts the catalogue by name, by sku and by age', () => {
    expect(stockItemSpec.sortValue(itemRow(), 'name')).toBe('Amoxicillin 500 mg capsule');
    expect(stockItemSpec.sortValue(itemRow(), 'sku')).toBe('AMOX-500');
    expect(stockItemSpec.sortValue(itemRow(), 'createdAt')).toBe(FIXED_NOW.getTime());
    expect(stockItemSpec.orderBy(itemQuery('name'))).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(stockItemSpec.orderBy(itemQuery('sku'))).toEqual([{ sku: 'asc' }, { id: 'asc' }]);
    expect(stockItemSpec.orderBy(itemQuery('createdAt'))).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('narrows the catalogue by every filter the search screen offers', () => {
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'name' as const,
      order: 'asc' as const,
      q: 'amox',
      active: true,
      controlled: false,
      unit: 'capsule',
    };

    expect(stockItemSpec.matches(itemRow(), query)).toBe(true);
    expect(stockItemSpec.matches({ ...itemRow(), unit: 'tablet' }, query)).toBe(false);
    expect(stockItemSpec.matches(itemRow(), { ...query, q: 'ibu' })).toBe(false);
    expect(stockItemSpec.where(query)).toEqual({
      active: true,
      controlled: false,
      unit: 'capsule',
      OR: [
        { sku: { contains: 'amox', mode: 'insensitive' } },
        { name: { contains: 'amox', mode: 'insensitive' } },
      ],
    });
  });

  it('narrows lots by every filter the carton list offers', () => {
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'expiresOn' as const,
      order: 'asc' as const,
      itemId: ITEM,
      facilityId: DEMO_FACILITY_A,
      status: 'AVAILABLE' as const,
      lotNumber: 'LOT-A',
      expiringBefore: new Date('2026-10-01T00:00:00.000Z'),
    };
    const dated = { ...lotRow(), expiresOn: new Date('2026-09-01T00:00:00.000Z') };

    expect(stockLotSpec.matches(dated, query)).toBe(true);
    // A carton that cannot expire is outside every bounded window, in both
    // implementations: Prisma's `lt` excludes nulls too.
    expect(stockLotSpec.matches(lotRow(), query)).toBe(false);
    expect(stockLotSpec.where(query)).toEqual({
      itemId: ITEM,
      facilityId: DEMO_FACILITY_A,
      status: 'AVAILABLE',
      lotNumber: 'LOT-A',
      expiresOn: { lt: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('narrows movements by every column a snapshot filters on', () => {
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'createdAt' as const,
      order: 'asc' as const,
      itemId: ITEM,
      lotId: LOT,
      facilityId: DEMO_FACILITY_A,
      postingId: POSTING,
    };

    expect(stockMovementSpec.where(query)).toEqual({
      itemId: ITEM,
      lotId: LOT,
      facilityId: DEMO_FACILITY_A,
      postingId: POSTING,
    });
    expect(stockMovementSpec.matches(movementRow(), query)).toBe(true);
    expect(stockMovementSpec.matches({ ...movementRow(), lotId: testId(21) }, query)).toBe(false);
    expect(stockMovementSpec.orderBy(query)).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(stockMovementSpec.sortValue(movementRow(), 'createdAt')).toBe(FIXED_NOW.getTime());
  });

  it('records what a write is worth naming in the audit event', () => {
    expect(stockMovementSpec.writeMetadata?.(movementRow(), null)).toEqual({
      kind: 'RECEIPT',
      lotSeq: 1,
    });
    expect(stockPostingSpec.writeMetadata?.(postingRow(), null)).toEqual({ kind: 'WASTAGE' });
    expect(stockLotSpec.writeMetadata?.(lotRow(), null)).toEqual({
      lotNumber: 'LOT-A',
      status: 'AVAILABLE',
    });
    expect(stockItemSpec.writeMetadata?.(itemRow(), null)).toEqual({
      sku: 'AMOX-500',
      unit: 'capsule',
    });
  });
});

function lotQuery(sort: 'expiresOn' | 'receivedOn' | 'lotNumber' | 'createdAt') {
  return { page: 1, pageSize: 25, sort, order: 'asc' as const };
}

describe('quoting what a package threw', () => {
  /**
   * `catch` binds `unknown`, because JavaScript permits throwing anything. The
   * package throws `RangeError`s today, so the other arm is unreachable through
   * the routes - and it is the arm that would put "[object Object]" in front of
   * a stockroom clerk if a future dependency threw something else.
   */
  it("uses an error's own sentence, and stringifies anything else", () => {
    expect(causeText(new RangeError('a count must be zero or more'))).toBe(
      'a count must be zero or more'
    );
    expect(causeText('a bare string')).toBe('a bare string');
  });
});

function itemQuery(sort: 'name' | 'sku' | 'createdAt') {
  return { page: 1, pageSize: 25, sort, order: 'asc' as const };
}

function lotRow(): ScopedRow<'StockLot'> {
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
  };
}

function itemRow(): ScopedRow<'StockItem'> {
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
  };
}

function movementRow(): ScopedRow<'StockMovement'> {
  return {
    ...storageColumns(testId(30)),
    postingId: POSTING,
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
  };
}

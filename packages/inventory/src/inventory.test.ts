import { describe, expect, it } from 'vitest';

import {
  addDays,
  allocate,
  balancesByLot,
  countVariance,
  courseTotal,
  exactlyThisManyStockUnits,
  expiringWithin,
  fefo,
  isExpired,
  isKnownLotStatus,
  isInbound,
  isKnownKind,
  isUsable,
  itemBalance,
  lastUsableDay,
  lotBalance,
  movementProblems,
  movementsFor,
  needsReorder,
  negativeBalances,
  packsToUnits,
  signedQuantity,
  unusableReason,
  usableBalance,
  toStockPrecision,
  signedQuantity as signed,
  type Lot,
  type LotStatus,
  type MovementKind,
  type StockItem,
  type StockMovement,
} from './index.js';

const TODAY = '2026-08-17';

function lot(overrides: Partial<Lot> & Pick<Lot, 'id'>): Lot {
  return {
    itemId: 'item-1',
    lotNumber: `LOT-${overrides.id}`,
    status: 'AVAILABLE',
    receivedOn: '2026-01-01',
    ...overrides,
  };
}

function movement(overrides: Partial<StockMovement> & Pick<StockMovement, 'id'>): StockMovement {
  return {
    lotId: 'lot-a',
    itemId: 'item-1',
    kind: 'RECEIPT',
    quantity: 100,
    occurredOn: '2026-01-01',
    actorId: 'user-1',
    ...overrides,
  };
}

const TABLETS: StockItem = { id: 'item-1', name: 'Metformin 500 mg', unit: 'tablet' };

describe('expiry', () => {
  /**
   * The inclusive boundary, asserted at the boundary itself.
   *
   * A carton stamped with a date is good through the end of that date. Off by
   * one in the safe direction throws away a day of every lot in the building;
   * off by one in the other administers expired product. Only the exact day
   * distinguishes the three implementations, so only the exact day is tested.
   */
  it('treats a lot as usable through its printed expiry date', () => {
    const expiring = lot({ id: 'a', expiresOn: TODAY });

    expect(isExpired(expiring, addDays(TODAY, -1))).toBe(false);
    expect(isExpired(expiring, TODAY)).toBe(false);
    expect(isExpired(expiring, addDays(TODAY, 1))).toBe(true);
  });

  it('has no last usable day when nothing expires and nothing was opened', () => {
    expect(lastUsableDay(lot({ id: 'a' }), TODAY)).toBeUndefined();
    expect(isExpired(lot({ id: 'a' }), '2099-01-01')).toBe(false);
  });

  it('ignores a beyond-use window on a lot that was never opened', () => {
    expect(lastUsableDay(lot({ id: 'a', beyondUseDays: 28 }), TODAY)).toBeUndefined();
  });

  /**
   * The deadline a practice forgets, because it is not printed on anything.
   *
   * A vial opened in June with a December expiry stops being usable in July.
   * Reading only `expiresOn` would keep drawing from it for five months.
   */
  it('closes an opened vial at its beyond-use date, ahead of the printed expiry', () => {
    const opened = lot({
      id: 'a',
      expiresOn: '2026-12-31',
      openedOn: '2026-08-01',
      beyondUseDays: 28,
    });

    expect(lastUsableDay(opened, TODAY)).toBe('2026-08-29');
    expect(isExpired(opened, '2026-08-30')).toBe(true);
  });

  it('keeps the printed expiry when it falls before the beyond-use window closes', () => {
    const opened = lot({
      id: 'a',
      expiresOn: '2026-08-20',
      openedOn: '2026-08-01',
      beyondUseDays: 28,
    });

    expect(lastUsableDay(opened, TODAY)).toBe('2026-08-20');
  });

  /**
   * A truncated date used to come back as an answer.
   *
   * `'2026'` split into a year and two undefineds, which defaulted to January
   * the 1st, so `addDays('2026', 1)` returned '2026-01-02' and read as a date.
   * Every date in this package feeds an expiry decision, so a shape that cannot
   * be interpreted has to say so rather than be guessed at.
   */
  it.each(['2026', '2026-08', '17/08/2026', '', 'not-a-date'])(
    'refuses %s rather than guessing what it meant',
    (malformed) => {
      expect(() => addDays(malformed, 1)).toThrow(/must be a YYYY-MM-DD date/u);
    }
  );

  /**
   * `Date.UTC` rolls over rather than refusing, and the rollover is what makes
   * the day arithmetic work across a month end - so it cannot be switched off.
   * The 30th of February would otherwise be accepted as the 2nd of March, and
   * an expiry a practice never typed would start governing a lot.
   */
  it.each(['2026-13-01', '2026-02-30', '2026-00-10', '2026-01-32'])(
    'refuses %s, which is well-shaped and not a date',
    (impossible) => {
      expect(() => addDays(impossible, 1)).toThrow(/not a date that exists/u);
    }
  );

  it('crosses a month end and a leap day without string arithmetic', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('usability', () => {
  it.each([
    ['RECALLED', 'recalled'],
    ['QUARANTINED', 'quarantined'],
    ['RETIRED', 'retired'],
  ] as const)('refuses a %s lot and says which it is', (status, word) => {
    const held = lot({ id: 'a', status });

    expect(isUsable(held, TODAY)).toBe(false);
    expect(unusableReason(held, TODAY)).toContain(word);
  });

  /**
   * The message, not just the refusal.
   *
   * "No stock available" in front of a fridge with four visible cartons is what
   * makes people stop trusting the system and start keeping a paper book. The
   * reason has to name the lot and say which deadline passed.
   */
  it('distinguishes a beyond-use refusal from an expiry refusal in the message', () => {
    const expired = lot({ id: 'a', lotNumber: 'ABC123', expiresOn: '2026-01-01' });
    const stale = lot({
      id: 'b',
      lotNumber: 'DEF456',
      expiresOn: '2026-12-31',
      openedOn: '2026-01-01',
      beyondUseDays: 28,
    });

    expect(unusableReason(expired, TODAY)).toBe('Lot ABC123 expired on 2026-01-01.');
    expect(unusableReason(stale, TODAY)).toBe(
      'Lot DEF456 passed its beyond-use date on 2026-01-29, 28 days after it was opened.'
    );
  });

  it('gives no reason for a lot that is fine', () => {
    expect(unusableReason(lot({ id: 'a', expiresOn: '2027-01-01' }), TODAY)).toBeUndefined();
  });
});

describe('FEFO ordering', () => {
  /**
   * First-expired-first-out, which is not first-in-first-out.
   *
   * The two agree only when stock arrives in the order it expires, which is
   * exactly what does not happen. This fixture is the disagreement: the
   * short-dated lot arrived second, and FIFO would hold it behind the long-dated
   * one until it expired on the shelf.
   */
  it('spends the soonest-expiring lot first even when it arrived last', () => {
    const longDated = lot({ id: 'long', expiresOn: '2027-06-01', receivedOn: '2026-01-01' });
    const shortDated = lot({ id: 'short', expiresOn: '2026-09-01', receivedOn: '2026-06-01' });

    expect(fefo([longDated, shortDated], TODAY).map((entry) => entry.id)).toEqual([
      'short',
      'long',
    ]);
  });

  it('sorts a lot that cannot expire behind every lot that can', () => {
    const never = lot({ id: 'never' });
    const dated = lot({ id: 'dated', expiresOn: '2030-01-01' });

    expect(fefo([never, dated], TODAY).map((entry) => entry.id)).toEqual(['dated', 'never']);
  });

  it('leaves out lots that are expired or held', () => {
    const usable = lot({ id: 'ok', expiresOn: '2027-01-01' });

    expect(
      fefo(
        [
          usable,
          lot({ id: 'gone', expiresOn: '2026-01-01' }),
          lot({ id: 'held', status: 'QUARANTINED' }),
        ],
        TODAY
      ).map((entry) => entry.id)
    ).toEqual(['ok']);
  });

  /**
   * A total order, so a second run of the same numbers reconciles against the
   * first. Two lots tying on expiry and receipt date would otherwise come out in
   * whatever order the caller's array happened to be in.
   */
  it('breaks a full tie on id rather than on argument order', () => {
    const tied = ['bbb', 'aaa', 'ccc'].map((id) =>
      lot({ id, expiresOn: '2027-01-01', receivedOn: '2026-01-01' })
    );

    expect(fefo(tied, TODAY).map((entry) => entry.id)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(fefo(tied.toReversed(), TODAY).map((entry) => entry.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('does not mutate the array it was given', () => {
    const lots = [
      lot({ id: 'b', expiresOn: '2027-06-01' }),
      lot({ id: 'a', expiresOn: '2026-09-01' }),
    ];

    fefo(lots, TODAY);

    expect(lots.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('breaks an expiry tie on the earlier receipt', () => {
    const late = lot({ id: 'late', expiresOn: '2027-01-01', receivedOn: '2026-06-01' });
    const early = lot({ id: 'early', expiresOn: '2027-01-01', receivedOn: '2026-01-01' });

    expect(fefo([late, early], TODAY).map((entry) => entry.id)).toEqual(['early', 'late']);
  });
});

describe('expiring soon', () => {
  it('lists what runs out inside the horizon and nothing beyond it', () => {
    const soon = lot({ id: 'soon', expiresOn: addDays(TODAY, 10) });
    const later = lot({ id: 'later', expiresOn: addDays(TODAY, 90) });
    const never = lot({ id: 'never' });

    expect(expiringWithin([soon, later, never], TODAY, 30).map((entry) => entry.id)).toEqual([
      'soon',
    ]);
  });

  /**
   * Already-expired stock is waste to dispose of, not stock to prioritise.
   * Mixing the two into one list gives the person reading it two different jobs
   * under one heading.
   */
  it('leaves out stock that has already expired', () => {
    const gone = lot({ id: 'gone', expiresOn: addDays(TODAY, -1) });

    expect(expiringWithin([gone], TODAY, 30)).toEqual([]);
  });

  it('includes a lot expiring exactly on the horizon', () => {
    const edge = lot({ id: 'edge', expiresOn: addDays(TODAY, 30) });

    expect(expiringWithin([edge], TODAY, 30).map((entry) => entry.id)).toEqual(['edge']);
  });
});

describe('the ledger', () => {
  it.each([
    ['RECEIPT', true],
    ['RETURN', true],
    ['TRANSFER_IN', true],
    ['COUNT_SURPLUS', true],
    ['DISPENSE', false],
    ['ADMINISTER', false],
    ['WASTE', false],
    ['TRANSFER_OUT', false],
    ['COUNT_SHORTFALL', false],
  ] as [MovementKind, boolean][])('directs %s correctly', (kind, inbound) => {
    expect(isInbound(kind)).toBe(inbound);
    expect(signedQuantity(movement({ id: 'm', kind, quantity: 5 }))).toBe(inbound ? 5 : -5);
  });

  it('derives on-hand by summing movements rather than reading a column', () => {
    const movements = [
      movement({ id: 'm1', kind: 'RECEIPT', quantity: 100 }),
      movement({ id: 'm2', kind: 'DISPENSE', quantity: 30, occurredOn: '2026-02-01' }),
      movement({
        id: 'm3',
        kind: 'WASTE',
        quantity: 2,
        occurredOn: '2026-03-01',
        reason: 'Dropped',
      }),
    ];

    expect(lotBalance(movements, 'lot-a', TODAY)).toBe(68);
  });

  /**
   * The date bound, which is what makes a count reconcilable.
   *
   * A count asks "what should have been here on the day we counted". Movements
   * entered later for earlier days have to land in that answer, and movements
   * for later days must not - otherwise every back-dated entry reads as a
   * discrepancy.
   */
  it('answers as of a date rather than as of now', () => {
    const movements = [
      movement({ id: 'm1', kind: 'RECEIPT', quantity: 100, occurredOn: '2026-01-01' }),
      movement({ id: 'm2', kind: 'DISPENSE', quantity: 30, occurredOn: '2026-06-01' }),
    ];

    expect(lotBalance(movements, 'lot-a', '2026-05-01')).toBe(100);
    expect(lotBalance(movements, 'lot-a', '2026-06-01')).toBe(70);
  });

  it('keeps lots apart when several belong to one item', () => {
    const movements = [
      movement({ id: 'm1', lotId: 'lot-a', quantity: 100 }),
      movement({ id: 'm2', lotId: 'lot-b', quantity: 40 }),
      movement({ id: 'm3', lotId: 'lot-b', kind: 'DISPENSE', quantity: 10 }),
    ];

    expect([...balancesByLot(movements, 'item-1', TODAY).entries()]).toEqual([
      ['lot-a', 100],
      ['lot-b', 30],
    ]);
    expect(itemBalance(movements, 'item-1', TODAY)).toBe(130);
  });

  it('ignores movements belonging to another item', () => {
    const movements = [
      movement({ id: 'm1', quantity: 100 }),
      movement({ id: 'm2', itemId: 'item-2', lotId: 'lot-z', quantity: 500 }),
    ];

    expect(itemBalance(movements, 'item-1', TODAY)).toBe(100);
  });

  /**
   * Stock that left before it arrived - a real reconciliation finding rather
   * than an impossible state. Allocation cannot produce it, but a back-dated
   * entry can, and the stockroom needs it surfaced rather than swallowed.
   */
  it('reports a lot driven negative by a back-dated movement', () => {
    const movements = [
      movement({ id: 'm1', kind: 'RECEIPT', quantity: 10, occurredOn: '2026-06-01' }),
      movement({ id: 'm2', kind: 'DISPENSE', quantity: 4, occurredOn: '2026-01-01' }),
    ];

    expect(negativeBalances(movements, 'item-1', '2026-05-01')).toEqual([
      { lotId: 'lot-a', balance: -4 },
    ]);
    expect(negativeBalances(movements, 'item-1', TODAY)).toEqual([]);
  });
});

describe('posting rules', () => {
  it('accepts a well-formed movement', () => {
    expect(movementProblems(movement({ id: 'm' }))).toEqual([]);
  });

  /**
   * Zero as well as negative. A zero movement asserts something happened and
   * changes nothing, which is the shape of a bug rather than an event.
   */
  it.each([0, -1, Number.NaN])('refuses a quantity of %s', (quantity) => {
    expect(movementProblems(movement({ id: 'm', quantity })).length).toBeGreaterThan(0);
  });

  it.each(['WASTE', 'COUNT_SURPLUS', 'COUNT_SHORTFALL'] as MovementKind[])(
    'refuses a %s with no reason attached',
    (kind) => {
      expect(movementProblems(movement({ id: 'm', kind }))).toContain(
        `A ${kind} movement must say why.`
      );
      expect(movementProblems(movement({ id: 'm', kind, reason: 'Counted short' }))).toEqual([]);
    }
  );

  it('refuses a correction with no reason', () => {
    expect(movementProblems(movement({ id: 'm2', correctsMovementId: 'm1' }))).toContain(
      'A correction must say why.'
    );
  });

  it('refuses a movement that corrects itself', () => {
    expect(
      movementProblems(movement({ id: 'm1', correctsMovementId: 'm1', reason: 'Typo' }))
    ).toContain('A movement cannot correct itself.');
  });

  /**
   * The type stops a bad kind being written here. It stops nothing arriving
   * from a column or a request body, and the failure there is quiet: an
   * unrecognised kind is not inbound, so it subtracts. A misspelled `RECIEPT`
   * would have removed stock on the way in and balanced to a plausible number.
   */
  it('refuses a kind it does not recognise rather than treating it as outbound', () => {
    const typo = movement({ id: 'm', kind: 'RECIEPT' as MovementKind });

    expect(isKnownKind('RECIEPT')).toBe(false);
    expect(movementProblems(typo)).toContain('RECIEPT is not a movement kind this system knows.');
  });

  it('recognises every kind it defines', () => {
    for (const kind of [
      'RECEIPT',
      'RETURN',
      'TRANSFER_IN',
      'COUNT_SURPLUS',
      'DISPENSE',
      'ADMINISTER',
      'WASTE',
      'TRANSFER_OUT',
      'COUNT_SHORTFALL',
    ]) {
      expect(isKnownKind(kind), kind).toBe(true);
    }
  });

  it('refuses a movement with no actor', () => {
    expect(movementProblems(movement({ id: 'm', actorId: '' }))).toContain(
      'A movement must name who posted it.'
    );
  });

  /**
   * A correction leaves both rows in the record.
   *
   * The pair reads as "this happened, and then it was found to be wrong", which
   * is what occurred. Editing the original would read as "this happened", which
   * is not - and on a controlled substance that difference is what an audit
   * exists to detect.
   */
  it('corrects an overstated dispense without removing it', () => {
    const wrong = movement({ id: 'm1', kind: 'DISPENSE', quantity: 30 });
    const fix = movement({
      id: 'm2',
      kind: 'RETURN',
      quantity: 10,
      correctsMovementId: 'm1',
      reason: 'Entered 30, handed over 20',
    });

    expect(movementProblems(fix)).toEqual([]);
    expect(lotBalance([movement({ id: 'm0', quantity: 100 }), wrong, fix], 'lot-a', TODAY)).toBe(
      80
    );
  });
});

describe('counting', () => {
  it('records no variance when the shelf and the ledger agree', () => {
    expect(countVariance(68, 68)).toBeUndefined();
  });

  /**
   * The physical count wins. The shelf is the territory and the ledger is the
   * map, so a disagreement is the ledger's to explain - and the variance keeps
   * what the ledger thought, which is what makes it investigable later.
   */
  it('names a shortfall and a surplus as different events, keeping both figures', () => {
    expect(countVariance(60, 68)).toEqual({
      kind: 'COUNT_SHORTFALL',
      quantity: 8,
      counted: 60,
      expected: 68,
    });
    expect(countVariance(70, 68)).toEqual({
      kind: 'COUNT_SURPLUS',
      quantity: 2,
      counted: 70,
      expected: 68,
    });
  });
});

describe('packs and reordering', () => {
  it('converts packs to stock units once, at receipt', () => {
    expect(packsToUnits({ ...TABLETS, packSize: 100 }, 4)).toBe(400);
  });

  it('passes a figure through for an item bought in the unit it is counted in', () => {
    expect(packsToUnits(TABLETS, 4)).toBe(4);
  });

  it('flags an item at or below its reorder level and not one above', () => {
    const item: StockItem = { ...TABLETS, reorderLevel: 50 };
    const at = [movement({ id: 'm1', quantity: 50 })];
    const above = [movement({ id: 'm1', quantity: 51 })];

    expect(needsReorder(item, [lot({ id: 'lot-a' })], at, TODAY)).toBe(true);
    expect(needsReorder(item, [lot({ id: 'lot-a' })], above, TODAY)).toBe(false);
  });

  it('never flags an item with no reorder level', () => {
    expect(needsReorder(TABLETS, [], [], TODAY)).toBe(false);
  });
});

describe('course quantities', () => {
  /**
   * The bug this package is shaped around.
   *
   * "One tablet twice daily for ten days" shows three numbers and the quantity
   * that leaves the shelf is none of them. Deducting the dose leaves the count
   * wrong by nineteen with nothing reading as an error.
   */
  it('multiplies a course out rather than taking any number off the prescription', () => {
    expect(courseTotal({ perDose: 1, dosesPerDay: 2, days: 10 })).toBe(20);
  });

  it('handles a course whose dose is not one unit', () => {
    expect(courseTotal({ perDose: 2, dosesPerDay: 3, days: 5 })).toBe(30);
  });

  it('passes a figure that is already a total straight through', () => {
    expect(exactlyThisManyStockUnits(0.5)).toBe(0.5);
  });
});

describe('allocation', () => {
  const stock = [
    movement({ id: 'm1', lotId: 'short', quantity: 20 }),
    movement({ id: 'm2', lotId: 'long', quantity: 50 }),
  ];
  const lots = [
    lot({ id: 'short', lotNumber: 'S1', expiresOn: '2026-09-01' }),
    lot({ id: 'long', lotNumber: 'L1', expiresOn: '2027-09-01' }),
  ];

  it('draws from the soonest-expiring lot first', () => {
    const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(15), TODAY, {
      divisible: true,
    });

    expect(result.lines).toEqual([{ lotId: 'short', lotNumber: 'S1', quantity: 15 }]);
    expect(result.shortfall).toBe(0);
  });

  it('spills into the next lot when the first cannot cover the request', () => {
    const result = allocate(
      lots,
      stock,
      'item-1',
      courseTotal({ perDose: 1, dosesPerDay: 2, days: 15 }),
      TODAY,
      {
        divisible: true,
      }
    );

    expect(result.lines).toEqual([
      { lotId: 'short', lotNumber: 'S1', quantity: 20 },
      { lotId: 'long', lotNumber: 'L1', quantity: 10 },
    ]);
    expect(result.allocated).toBe(30);
  });

  /**
   * A partial fill is a transaction, not an error - twenty now and ten owed is
   * a thing pharmacies do daily. It is a returned field rather than an exception
   * so the caller has to look at it, and never a silently smaller success.
   */
  it('reports a shortfall rather than throwing or quietly filling less', () => {
    const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(100), TODAY, {
      divisible: true,
    });

    expect(result.allocated).toBe(70);
    expect(result.requested).toBe(100);
    expect(result.shortfall).toBe(30);
  });

  it('never allocates more than a lot holds, so the ledger cannot go negative', () => {
    const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(1000), TODAY, {
      divisible: true,
    });

    for (const line of result.lines) {
      expect(line.quantity).toBeLessThanOrEqual(
        balancesByLot(stock, 'item-1', TODAY).get(line.lotId) ?? 0
      );
    }
  });

  it('skips a lot that is expired even when it still holds stock', () => {
    const expired = [...lots, lot({ id: 'gone', lotNumber: 'X1', expiresOn: '2026-01-01' })];
    const withExpired = [...stock, movement({ id: 'm3', lotId: 'gone', quantity: 500 })];

    const result = allocate(expired, withExpired, 'item-1', exactlyThisManyStockUnits(10), TODAY, {
      divisible: true,
    });

    expect(result.lines.map((line) => line.lotId)).toEqual(['short']);
  });

  it('skips a lot whose balance has run to zero rather than allocating nothing from it', () => {
    const drained = [
      ...stock,
      movement({ id: 'm3', lotId: 'short', kind: 'DISPENSE', quantity: 20 }),
    ];

    const result = allocate(lots, drained, 'item-1', exactlyThisManyStockUnits(10), TODAY, {
      divisible: true,
    });

    expect(result.lines).toEqual([{ lotId: 'long', lotNumber: 'L1', quantity: 10 }]);
  });

  /**
   * A lot record with no movements behind it yet.
   *
   * Real rather than hypothetical: the lot row is created when the delivery is
   * booked in and the receipt is posted afterwards, so there is a window where
   * the lot exists and holds nothing. It has to be skipped, not treated as an
   * unknown balance and drawn from.
   */
  it('skips a lot that exists but has had no movement posted against it', () => {
    const unposted = [...lots, lot({ id: 'fresh', lotNumber: 'F1', expiresOn: '2026-08-25' })];

    const result = allocate(unposted, stock, 'item-1', exactlyThisManyStockUnits(5), TODAY, {
      divisible: true,
    });

    expect(result.lines.map((line) => line.lotId)).toEqual(['short']);
  });

  it('ignores lots belonging to another item', () => {
    const other = [...lots, lot({ id: 'other', itemId: 'item-2', expiresOn: '2026-08-20' })];

    const result = allocate(other, stock, 'item-1', exactlyThisManyStockUnits(5), TODAY, {
      divisible: true,
    });

    expect(result.lines.map((line) => line.lotId)).toEqual(['short']);
  });

  it('allocates nothing for a request of zero', () => {
    const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(0), TODAY, {
      divisible: true,
    });

    expect(result).toEqual({
      itemId: 'item-1',
      lines: [],
      allocated: 0,
      requested: 0,
      shortfall: 0,
    });
  });

  describe('when the quantity cannot be split', () => {
    it('takes the whole amount from one lot', () => {
      const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(15), TODAY, {
        divisible: false,
      });

      expect(result.lines).toEqual([{ lotId: 'short', lotNumber: 'S1', quantity: 15 }]);
    });

    it('moves past a lot too small to cover it rather than splitting', () => {
      const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(30), TODAY, {
        divisible: false,
      });

      expect(result.lines).toEqual([{ lotId: 'long', lotNumber: 'L1', quantity: 30 }]);
    });

    /**
     * The state that makes people distrust the system: the screen says there is
     * no stock and the fridge visibly has some, and both are true. Without a
     * name for it the caller can only say "insufficient", which is the wrong
     * answer to what the person is looking at.
     */
    it('says so when the stock exists but is scattered across lots', () => {
      const scattered = [
        movement({ id: 'm1', lotId: 'short', quantity: 20 }),
        movement({ id: 'm2', lotId: 'long', quantity: 20 }),
      ];

      const result = allocate(lots, scattered, 'item-1', exactlyThisManyStockUnits(30), TODAY, {
        divisible: false,
      });

      expect(result.blockedByIndivisibility).toBe(true);
      expect(result.shortfall).toBe(30);
      expect(result.lines).toEqual([]);
    });

    it('does not blame indivisibility for a plain shortage', () => {
      const result = allocate(lots, stock, 'item-1', exactlyThisManyStockUnits(1000), TODAY, {
        divisible: false,
      });

      expect(result.blockedByIndivisibility).toBeUndefined();
    });
  });
});

describe('turning an allocation into movements', () => {
  /**
   * Deciding what to take and recording that it was taken are separate acts. A
   * fused version posts the ledger for a dispense that then fails at the
   * counter: the tablets back on the shelf and the record saying they left.
   */
  it('produces one movement per line, and only when the caller asks', () => {
    const allocation = {
      itemId: 'item-1',
      lines: [
        { lotId: 'short', lotNumber: 'S1', quantity: 20 },
        { lotId: 'long', lotNumber: 'L1', quantity: 10 },
      ],
      allocated: 30,
      requested: 30,
      shortfall: 0,
    };

    const posted = movementsFor(allocation, {
      kind: 'DISPENSE',
      occurredOn: TODAY,
      actorId: 'user-1',
      idFor: (_line, index) => `mv-${String(index)}`,
    });

    expect(posted.map((entry) => [entry.id, entry.lotId, entry.quantity])).toEqual([
      ['mv-0', 'short', 20],
      ['mv-1', 'long', 10],
    ]);
    for (const entry of posted) {
      expect(movementProblems(entry)).toEqual([]);
    }
  });

  it('carries a reason through to every movement when one is given', () => {
    const posted = movementsFor(
      {
        itemId: 'item-1',
        lines: [{ lotId: 'a', lotNumber: 'A1', quantity: 2 }],
        allocated: 2,
        requested: 2,
        shortfall: 0,
      },
      {
        kind: 'WASTE',
        occurredOn: TODAY,
        actorId: 'user-1',
        reason: 'Drawn and not used',
        idFor: () => 'mv-0',
      }
    );

    expect(posted[0]?.reason).toBe('Drawn and not used');
    expect(movementProblems(posted[0]!)).toEqual([]);
  });

  /**
   * A waste movement with no reason must not pass validation just because it
   * came through this helper. The rule lives on the movement, not on the path
   * that built it.
   */
  it('leaves a reason-requiring movement invalid when no reason was given', () => {
    const posted = movementsFor(
      {
        itemId: 'item-1',
        lines: [{ lotId: 'a', lotNumber: 'A1', quantity: 2 }],
        allocated: 2,
        requested: 2,
        shortfall: 0,
      },
      { kind: 'WASTE', occurredOn: TODAY, actorId: 'user-1', idFor: () => 'mv-0' }
    );

    expect(movementProblems(posted[0]!)).toContain('A WASTE movement must say why.');
  });
});

describe('a dispense and a count, end to end', () => {
  /**
   * The whole point, in one run: receive, dispense a course, count the shelf,
   * and have the two numbers agree.
   *
   * It is the check that would have caught the dose-instead-of-course bug. The
   * shelf holds 80 because 20 tablets left, and a system that deducted the dose
   * would count 99 here and pass every unit test above.
   */
  it('leaves the shelf agreeing with the ledger after a ten-day course', () => {
    const lots = [lot({ id: 'lot-a', lotNumber: 'A1', expiresOn: '2027-01-01' })];
    const received = [movement({ id: 'm0', kind: 'RECEIPT', quantity: 100 })];

    const allocation = allocate(
      lots,
      received,
      'item-1',
      courseTotal({ perDose: 1, dosesPerDay: 2, days: 10 }),
      TODAY,
      { divisible: true }
    );
    const ledger = [
      ...received,
      ...movementsFor(allocation, {
        kind: 'DISPENSE',
        occurredOn: TODAY,
        actorId: 'user-1',
        idFor: () => 'mv-0',
      }),
    ];

    expect(itemBalance(ledger, 'item-1', TODAY)).toBe(80);
    expect(countVariance(80, itemBalance(ledger, 'item-1', TODAY))).toBeUndefined();
  });
});

describe('the review findings, each held by a test', () => {
  /**
   * An unpadded month reads as unexpired.
   *
   * Every comparison here is lexicographic, which is right for `YYYY-MM-DD` and
   * silently wrong otherwise: `'2026-8-01' < '2026-09-01'` is false, because
   * `'8'` sorts after `'0'`. A lot that expired in August therefore passed as
   * usable in September, and `fefo` would have handed it to a patient. The type
   * is an alias for `string`, so it stops nothing arriving from a form or a
   * column - which is where a non-canonical date comes from.
   */
  it('refuses an unpadded expiry rather than reading it as unexpired', () => {
    const sloppy = lot({ id: 'a', expiresOn: '2026-8-01' });

    expect('2026-8-01' < '2026-09-01', 'the comparison this guards against').toBe(false);
    expect(() => isExpired(sloppy, '2026-09-01')).toThrow(/must be a YYYY-MM-DD date/u);
    expect(() => fefo([sloppy], '2026-09-01')).toThrow(/must be a YYYY-MM-DD date/u);
  });

  it('refuses a malformed comparison date as well as a malformed lot date', () => {
    expect(() => isExpired(lot({ id: 'a', expiresOn: '2026-09-01' }), '2026-9-1')).toThrow(
      /must be a YYYY-MM-DD date/u
    );
  });

  /**
   * The check that read as protection and was not.
   *
   * `isKnownKind` was called only by `movementProblems`, while `lotBalance` and
   * `balancesByLot` reach `signedQuantity` directly - so a movement carrying a
   * misspelled `RECIEPT` produced a quiet, plausible, wrong balance with no
   * validation error anywhere. Failing closed on a corrupt row is a bad
   * afternoon; a confidently wrong balance is stock ordered against a number
   * nobody can reproduce.
   */
  it('refuses to compute a balance over a movement whose kind it does not know', () => {
    const corrupt = [movement({ id: 'm1', kind: 'RECIEPT' as MovementKind, quantity: 40 })];

    expect(() => signed(corrupt[0]!)).toThrow(/not one this system knows/u);
    expect(() => lotBalance(corrupt, 'lot-a', TODAY)).toThrow(/not one this system knows/u);
    expect(() => balancesByLot(corrupt, 'item-1', TODAY)).toThrow(/not one this system knows/u);
  });

  /**
   * Fractional units and binary floating point.
   *
   * Receive 0.3 mL, remove 0.1 and 0.2, and the raw sum is -2.78e-17 rather
   * than zero. `negativeBalances` reported that as a loss and `countVariance`
   * turned it into a variance against a shelf that was correct. A stockroom
   * chasing minus two hundred and seventy-eight quintillionths of a millilitre
   * is a stockroom that stops believing the reports.
   */
  it('lands a fractional lot exactly on zero rather than on floating-point noise', () => {
    const fractional = [
      movement({ id: 'm1', kind: 'RECEIPT', quantity: 0.3 }),
      movement({ id: 'm2', kind: 'DISPENSE', quantity: 0.1 }),
      movement({ id: 'm3', kind: 'DISPENSE', quantity: 0.2 }),
    ];

    expect(0.3 - 0.1 - 0.2, 'the arithmetic this guards against').not.toBe(0);
    expect(lotBalance(fractional, 'lot-a', TODAY)).toBe(0);
    expect(itemBalance(fractional, 'item-1', TODAY)).toBe(0);
    expect(negativeBalances(fractional, 'item-1', TODAY)).toEqual([]);
    expect(countVariance(0, itemBalance(fractional, 'item-1', TODAY))).toBeUndefined();
  });

  /**
   * A brand that accepts anything is a promise about where the number was
   * typed, not about the number.
   *
   * A negative allocated as `requested: -5, allocated: 0, shortfall: 0` - a
   * request reporting itself completely filled having moved nothing. `NaN` was
   * worse: it survives `Math.min`, so lines and posted movements carried it and
   * every downstream balance became `NaN` with no row identifiable as the
   * cause.
   */
  it.each([-5, Number.NaN, Number.POSITIVE_INFINITY])('refuses to brand %s as a total', (bad) => {
    expect(() => exactlyThisManyStockUnits(bad)).toThrow(RangeError);
  });

  it('refuses a course whose numbers multiply out to nonsense', () => {
    expect(() => courseTotal({ perDose: 1, dosesPerDay: Number.NaN, days: 10 })).toThrow(
      RangeError
    );
    expect(() => courseTotal({ perDose: -1, dosesPerDay: 2, days: 10 })).toThrow(RangeError);
  });

  /**
   * The same lot supplied twice - a join returning duplicate rows.
   *
   * Each copy was given the lot's full balance, so ten units passed twice
   * satisfied a request for twenty with two ten-unit lines, and posting them
   * drove the lot to -10 straight past the guarantee that allocation never
   * takes more than a lot holds.
   */
  it('gives a duplicated lot its balance once, not once per copy', () => {
    const single = lot({ id: 'dup', lotNumber: 'D1', expiresOn: '2027-01-01' });
    const ledger = [movement({ id: 'm1', lotId: 'dup', quantity: 10 })];

    const result = allocate(
      [single, single],
      ledger,
      'item-1',
      exactlyThisManyStockUnits(20),
      TODAY,
      { divisible: true }
    );

    expect(result.allocated).toBe(10);
    expect(result.shortfall).toBe(10);
    expect(result.lines).toEqual([{ lotId: 'dup', lotNumber: 'D1', quantity: 10 }]);
  });

  it('refuses two different lots sharing an id, having no one answer for either', () => {
    const one = lot({ id: 'dup', expiresOn: '2027-01-01' });
    const other = lot({ id: 'dup', expiresOn: '2026-09-01' });

    expect(() => fefo([one, other], TODAY)).toThrow(/supplied twice with different contents/u);
  });

  /**
   * Reordering on physical stock suppresses replenishment exactly when the
   * shelf is empty in every sense that matters.
   *
   * A hundred units in an expired lot reads as a hundred on a stock report and
   * supplies nobody: `allocate` skips the lot and hands out zero.
   */
  it('counts only what could be dispensed when deciding to reorder', () => {
    const item: StockItem = { ...TABLETS, reorderLevel: 50 };
    const expired = [lot({ id: 'gone', expiresOn: '2026-01-01' })];
    const ledger = [movement({ id: 'm1', lotId: 'gone', quantity: 100 })];

    expect(itemBalance(ledger, 'item-1', TODAY), 'physically present').toBe(100);
    expect(usableBalance(expired, ledger, 'item-1', TODAY), 'actually dispensable').toBe(0);
    expect(needsReorder(item, expired, ledger, TODAY)).toBe(true);
  });

  /**
   * Allocating one item and posting the movements under another.
   *
   * Undetectable downstream: every lot id and quantity in the result is valid,
   * and they simply debit the wrong item's ledger. So the item travels with the
   * allocation rather than being supplied again at posting time.
   */
  it('posts movements against the item that was allocated, with no second chance to say', () => {
    const lots = [lot({ id: 'lot-a', lotNumber: 'A1', expiresOn: '2027-01-01' })];
    const ledger = [movement({ id: 'm0', quantity: 100 })];

    const allocation = allocate(lots, ledger, 'item-1', exactlyThisManyStockUnits(10), TODAY, {
      divisible: true,
    });
    const posted = movementsFor(allocation, {
      kind: 'DISPENSE',
      occurredOn: TODAY,
      actorId: 'user-1',
      idFor: () => 'mv-0',
    });

    expect(allocation.itemId).toBe('item-1');
    expect(posted.map((entry) => entry.itemId)).toEqual(['item-1']);
  });
});

describe('the second review round, each held by a test', () => {
  /**
   * The one outcome in this package that reaches a patient.
   *
   * An unrecognised status matched none of the clauses, fell through to the
   * expiry check and came out usable, so a misspelled `RECALLED` from a column
   * put recalled stock back on the shelf. The type does not help: the string
   * arrives from a database.
   */
  it('refuses a lot whose status it does not recognise rather than assuming it is fine', () => {
    const corrupt = lot({ id: 'a', lotNumber: 'X1', status: 'RECALED' as LotStatus });

    expect(isKnownLotStatus('RECALED')).toBe(false);
    expect(isUsable(corrupt, TODAY)).toBe(false);
    expect(unusableReason(corrupt, TODAY)).toContain('not one this system knows');
    expect(fefo([corrupt], TODAY)).toEqual([]);
  });

  /**
   * The date bug in the other direction: an unpadded month sorts late, so a
   * receipt dropped out of the balance and allocation reported a shortage that
   * did not exist.
   */
  it('refuses an unpadded movement date rather than dropping it from the balance', () => {
    const sloppy = [movement({ id: 'm1', quantity: 100, occurredOn: '2026-8-01' })];

    expect('2026-8-01' <= '2026-09-01', 'the comparison this guards against').toBe(false);
    expect(() => lotBalance(sloppy, 'lot-a', '2026-09-01')).toThrow(/must be a YYYY-MM-DD date/u);
    expect(() => balancesByLot(sloppy, 'item-1', '2026-09-01')).toThrow(
      /must be a YYYY-MM-DD date/u
    );
  });

  /**
   * The README claimed `{ kind: 'RECEIPT', quantity: -40 }` was
   * unrepresentable, and half of that was true. The kind cannot carry a sign;
   * the quantity could, and an inbound kind with a negative quantity still
   * subtracted. `movementProblems` caught it and nothing on the balance path
   * called `movementProblems`.
   */
  it.each([-40, 0, Number.NaN])('refuses to balance a movement of quantity %s', (quantity) => {
    const bad = [movement({ id: 'm1', kind: 'RECEIPT', quantity })];

    expect(() => lotBalance(bad, 'lot-a', TODAY)).toThrow(/not a positive number/u);
  });

  /**
   * `usableBalance` exists to predict what allocation would hand out. Summing a
   * negative lot made it disagree with the only thing it predicts: lots of -10
   * and 20 reported 10 while `allocate` gives 20.
   */
  it('ignores a negative lot rather than offsetting the usable stock beside it', () => {
    const lots = [
      lot({ id: 'short', lotNumber: 'S1', expiresOn: '2027-01-01' }),
      lot({ id: 'long', lotNumber: 'L1', expiresOn: '2027-06-01' }),
    ];
    const ledger = [
      movement({ id: 'm1', lotId: 'short', kind: 'DISPENSE', quantity: 10 }),
      movement({ id: 'm2', lotId: 'long', kind: 'RECEIPT', quantity: 20 }),
    ];

    expect(negativeBalances(ledger, 'item-1', TODAY)).toEqual([{ lotId: 'short', balance: -10 }]);
    expect(usableBalance(lots, ledger, 'item-1', TODAY)).toBe(20);
    expect(
      allocate(lots, ledger, 'item-1', exactlyThisManyStockUnits(20), TODAY, { divisible: true })
        .allocated
    ).toBe(20);
  });

  /**
   * A reason of three spaces satisfied an exact-empty check and told an auditor
   * nothing. The rule is that the movement carries a reason, not that the field
   * is non-empty.
   */
  it.each(['   ', '\t', '\n '])('refuses %j as a reason for a waste movement', (blank) => {
    expect(movementProblems(movement({ id: 'm', kind: 'WASTE', reason: blank }))).toContain(
      'A WASTE movement must say why.'
    );
  });

  /**
   * The reorder boundary, documented and implemented the same way.
   *
   * It was described as exclusive on `StockItem.reorderLevel` and implemented
   * as inclusive, leaving a caller to work out which was authoritative from a
   * test. Inclusive is the convention a reorder point follows.
   */
  it('is due for reorder at the level, not one below it', () => {
    const item: StockItem = { ...TABLETS, reorderLevel: 50 };
    const lots = [lot({ id: 'lot-a', expiresOn: '2027-01-01' })];

    expect(needsReorder(item, lots, [movement({ id: 'm', quantity: 51 })], TODAY)).toBe(false);
    expect(needsReorder(item, lots, [movement({ id: 'm', quantity: 50 })], TODAY)).toBe(true);
    expect(needsReorder(item, lots, [movement({ id: 'm', quantity: 49 })], TODAY)).toBe(true);
  });
});

describe('the third review round, each held by a test', () => {
  /**
   * The duplicate-row problem one table over.
   *
   * I deduplicated lots and not movements, so a join returning a receipt twice
   * counted its quantity twice: ten units passed twice gave allocation twenty
   * to hand out, and posting that against the real ledger drove the lot to -10.
   * Fixing it for lots and not for movements left the guarantee just as broken.
   */
  it('counts a duplicated movement once, not once per copy', () => {
    const receipt = movement({ id: 'm1', quantity: 10 });

    expect(lotBalance([receipt, receipt], 'lot-a', TODAY)).toBe(10);
    expect(itemBalance([receipt, receipt], 'item-1', TODAY)).toBe(10);

    const lots = [lot({ id: 'lot-a', lotNumber: 'A1', expiresOn: '2027-01-01' })];
    const result = allocate(
      lots,
      [receipt, receipt],
      'item-1',
      exactlyThisManyStockUnits(20),
      TODAY,
      { divisible: true }
    );

    expect(result.allocated).toBe(10);
    expect(result.shortfall).toBe(10);
  });

  it('refuses two movements sharing an id with different contents', () => {
    const one = movement({ id: 'm1', quantity: 10 });
    const other = movement({ id: 'm1', quantity: 40 });

    expect(() => lotBalance([one, other], 'lot-a', TODAY)).toThrow(
      /supplied twice with different contents/u
    );
  });

  /**
   * A complete fill that reported itself partial.
   *
   * 0.1 three times a day multiplies out to 0.30000000000000004, so against a
   * lot holding exactly 0.3 the allocation supplied the whole 0.3 and reported
   * a shortfall of 5.55e-17 - the counter told to owe the patient a quantity
   * too small to measure. The ledger rounds its sums, so the quantity going in
   * has to be on the same grid.
   */
  it('lands a fractional course on the same grid the ledger uses', () => {
    expect(0.1 * 3, 'the arithmetic this guards against').not.toBe(0.3);
    expect(courseTotal({ perDose: 0.1, dosesPerDay: 3, days: 1 })).toBe(0.3);

    const lots = [lot({ id: 'lot-a', lotNumber: 'A1', expiresOn: '2027-01-01' })];
    const ledger = [movement({ id: 'm1', quantity: 0.3 })];
    const result = allocate(
      lots,
      ledger,
      'item-1',
      courseTotal({ perDose: 0.1, dosesPerDay: 3, days: 1 }),
      TODAY,
      { divisible: true }
    );

    expect(result.allocated).toBe(0.3);
    expect(result.shortfall).toBe(0);
  });

  /**
   * A variance is the input to a movement, and a movement that cannot be posted
   * is a variance nobody can close. `countVariance(-5, 10)` returned a
   * perfectly plausible 15-unit shortfall that passed quantity validation and
   * would have driven the ledger to -5. A count of minus five is a typo at the
   * shelf, not a finding.
   */
  it('refuses a physical count that cannot have been counted', () => {
    expect(() => countVariance(-5, 10)).toThrow(/must be zero or more/u);
    expect(() => countVariance(Number.NaN, 10)).toThrow(/must be zero or more/u);
    expect(() => countVariance(10, Number.NaN)).toThrow(/must be a number/u);
    expect(countVariance(0, 10)).toEqual({
      kind: 'COUNT_SHORTFALL',
      quantity: 10,
      counted: 0,
      expected: 10,
    });
  });

  /**
   * The actor, trimmed like the reason and for the same reason. An audit entry
   * naming "   " names nobody, with more confidence than a blank field.
   */
  it.each(['   ', '\t'])('refuses %j as the actor who posted a movement', (blank) => {
    expect(movementProblems(movement({ id: 'm', actorId: blank }))).toContain(
      'A movement must name who posted it.'
    );
  });
});

describe('the fourth review round, each held by a test', () => {
  /**
   * Two malformed fields cancelling into a plausible total.
   *
   * Validating only the product let `perDose: -1` with `dosesPerDay: -2`
   * multiply out to a finite positive 20, which passed every check downstream
   * and dispensed twenty units against a prescription saying nothing coherent.
   */
  it('refuses a course whose dimensions cancel into a plausible number', () => {
    expect(-1 * -2 * 10, 'the arithmetic this guards against').toBe(20);
    expect(() => courseTotal({ perDose: -1, dosesPerDay: -2, days: 10 })).toThrow(
      /perDose must be zero or more/u
    );
    expect(() => courseTotal({ perDose: 1, dosesPerDay: 2, days: -10 })).toThrow(
      /days must be zero or more/u
    );
  });

  /**
   * TypeScript is structural, so a prescription record carrying an `id`
   * alongside the three course fields is a valid `Course` at the call site.
   * Walking the object's keys rejected the `id` for not being a number and
   * refused a course whose every declared field was fine - a validator failing
   * on data it was never asked about.
   */
  it('validates the fields a course declares and ignores what else the object carries', () => {
    const prescription = { id: 'rx-1', perDose: 1, dosesPerDay: 2, days: 10 };

    expect(courseTotal(prescription)).toBe(20);
  });

  /**
   * A fridge holding exactly enough, reported as a shortage.
   *
   * The request was normalised and the available total was not, so 0.7 and 0.1
   * summed to 0.7999999999999999 against a request for 0.8 - the comparison
   * came out false and the caller was told there was no stock, which is the
   * precise state `blockedByIndivisibility` exists to name.
   */
  it('names indivisibility rather than shortage when fractional lots sum to enough', () => {
    const lots = [
      lot({ id: 'a', lotNumber: 'A1', expiresOn: '2027-01-01' }),
      lot({ id: 'b', lotNumber: 'B1', expiresOn: '2027-06-01' }),
    ];
    const ledger = [
      movement({ id: 'm1', lotId: 'a', quantity: 0.7 }),
      movement({ id: 'm2', lotId: 'b', quantity: 0.1 }),
    ];

    expect(0.7 + 0.1, 'the arithmetic this guards against').not.toBe(0.8);

    const result = allocate(lots, ledger, 'item-1', exactlyThisManyStockUnits(0.8), TODAY, {
      divisible: false,
    });

    expect(result.blockedByIndivisibility).toBe(true);
  });

  /**
   * The door, which the header claims is where invalid entries are stopped.
   *
   * A malformed `occurredOn` produced no problem, entered an append-only
   * ledger, and then threw on every later balance read for that lot - blocking
   * allocation and reconciliation until somebody worked out that an immutable
   * row needed compensating. Failing closed on read is right; failing closed
   * only on read turns one keystroke into a lot nobody can count.
   */
  it('refuses a malformed movement date before it can be posted', () => {
    const problems = movementProblems(movement({ id: 'm', occurredOn: '2026-8-01' }));

    expect(problems.some((problem) => /must be a YYYY-MM-DD date/u.test(problem))).toBe(true);
    expect(movementProblems(movement({ id: 'm', occurredOn: '2026-08-01' }))).toEqual([]);
  });
});

describe('the fifth review round, each held by a test', () => {
  /**
   * Rounding the balances and not the comparison against them left exactly the
   * artefact the rounding was introduced to remove: a surplus of 5.55e-17,
   * which passes quantity validation and posts as a permanent correction to an
   * append-only ledger for a discrepancy of five hundredths of a femtolitre.
   */
  it('finds no variance between a fractional count and the sum it came from', () => {
    expect(0.1 + 0.2, 'the arithmetic this guards against').not.toBe(0.3);

    expect(countVariance(0.1 + 0.2, 0.3)).toBeUndefined();
    expect(countVariance(0.3, 0.1 + 0.2)).toBeUndefined();
  });

  it('still reports a variance a practice would care about, on the grid', () => {
    expect(countVariance(0.1 + 0.2, 0.5)).toEqual({
      kind: 'COUNT_SHORTFALL',
      quantity: 0.2,
      counted: 0.1 + 0.2,
      expected: 0.5,
    });
  });

  /**
   * Not yet received is not on the shelf.
   *
   * Every function here answers "as of" a date, and a lot received in October
   * appeared in a September `fefo` and in September's expiring-soon report - a
   * historical stockroom report listing inventory the practice did not have,
   * which reads as a real count and reconciles against nothing.
   */
  it('leaves out a lot that had not arrived by the cutoff', () => {
    const future = lot({ id: 'future', receivedOn: '2026-10-01', expiresOn: '2027-01-01' });
    const here = lot({ id: 'here', receivedOn: '2026-01-01', expiresOn: '2027-01-01' });

    expect(fefo([future, here], '2026-09-01').map((entry) => entry.id)).toEqual(['here']);
    expect(fefo([future, here], '2026-10-01').map((entry) => entry.id)).toEqual(['here', 'future']);
    expect(expiringWithin([future], '2026-09-01', 365)).toEqual([]);
  });

  it('includes a lot received exactly on the cutoff', () => {
    const today = lot({ id: 'today', receivedOn: TODAY, expiresOn: '2027-01-01' });

    expect(fefo([today], TODAY).map((entry) => entry.id)).toEqual(['today']);
  });

  /**
   * A row claiming to correct something and naming nothing. The audit link the
   * field exists to make points nowhere, and the ledger is append-only, so the
   * claim stays.
   */
  it.each(['', '   '])('refuses %j as the movement a correction corrects', (blank) => {
    const problems = movementProblems(
      movement({ id: 'm2', correctsMovementId: blank, reason: 'Entered twice' })
    );

    expect(problems).toContain('A correction must name the movement it corrects.');
  });
});

describe('the sixth review round, each held by a test', () => {
  /**
   * Filter order, which the first version got backwards.
   *
   * Validating `receivedOn` before the usability filter meant one retired lot
   * from years ago with a corrupt date took down `fefo`, allocation, reordering
   * and every expiry report for the whole item. Status is decided without
   * reading these dates, so discarding the held lots first means only the
   * candidates have to be well formed.
   */
  it.each(['RETIRED', 'RECALLED', 'QUARANTINED'] as const)(
    'discards a %s lot with a corrupt date instead of failing on it',
    (status) => {
      const corrupt = lot({ id: 'old', status, receivedOn: 'not-a-date' });
      const good = lot({ id: 'good', receivedOn: '2026-01-01', expiresOn: '2027-01-01' });

      expect(fefo([corrupt, good], TODAY).map((entry) => entry.id)).toEqual(['good']);
    }
  );

  it('still refuses a corrupt date on a lot that is otherwise a candidate', () => {
    const corrupt = lot({ id: 'candidate', receivedOn: 'not-a-date', expiresOn: '2027-01-01' });

    expect(() => fefo([corrupt], TODAY)).toThrow(/must be a YYYY-MM-DD date/u);
  });

  /**
   * A finite number that stops being finite when it is scaled.
   *
   * `MAX_VALUE` times a million is `Infinity`, so the explicit finite checks
   * passed and the rounding overflowed behind them. `countVariance` produced a
   * correction quantity of `Infinity`, and worse, two different overflowing
   * counts both became `Infinity` and compared equal - reporting no variance
   * between two numbers that were not the same.
   */
  it('refuses a quantity too large to carry at six decimal places', () => {
    expect(Number.isFinite(Number.MAX_VALUE), 'finite going in').toBe(true);
    expect(Number.isFinite(Number.MAX_VALUE * 1e6), 'not finite once scaled').toBe(false);

    expect(() => toStockPrecision(Number.MAX_VALUE)).toThrow(/too large to carry/u);
    expect(() => countVariance(Number.MAX_VALUE, 0)).toThrow(/too large to carry/u);
  });

  it('carries a quantity a practice could plausibly hold', () => {
    expect(toStockPrecision(1_000_000.123456)).toBe(1_000_000.123456);
  });
});

describe('the review of the merged inventory PRs, each finding held by a test', () => {
  /**
   * A deadline derived from something that had not happened yet.
   *
   * The beyond-use clock starts when the vial is pierced, so on any date before
   * that it does not exist. Applying it regardless gave a lot opened on the 10th
   * an October deadline in a query asked about the 1st, sorting it ahead of a
   * December expiry in a back-dated FEFO and listing it in that month's
   * expiring-soon report. The as-of contract this package opens with is exactly
   * the promise that was broken.
   */
  it('ignores a beyond-use window that had not started as of the date asked about', () => {
    const opened = lot({
      id: 'a',
      receivedOn: '2026-08-01',
      openedOn: '2026-09-10',
      beyondUseDays: 28,
    });

    expect(lastUsableDay(opened, '2026-09-01')).toBeUndefined();
    expect(lastUsableDay(opened, '2026-09-10')).toBe('2026-10-08');
    expect(expiringWithin([opened], '2026-09-01', 365)).toEqual([]);
  });

  /**
   * The public single-lot answer disagreed with the shelf answer, because the
   * receipt-date check lived only inside `fefo`. A caller asking about one lot
   * could approve stock the practice did not yet have.
   */
  it('reports a not-yet-received lot as unusable, not only as absent from FEFO', () => {
    const future = lot({ id: 'a', lotNumber: 'F1', receivedOn: '2026-10-01' });

    expect(isUsable(future, '2026-09-01')).toBe(false);
    expect(unusableReason(future, '2026-09-01')).toBe('Lot F1 was not received until 2026-10-01.');
    expect(fefo([future], '2026-09-01')).toEqual([]);
  });

  it('still discards a held lot before reading its dates', () => {
    const corrupt = lot({ id: 'a', status: 'RETIRED', receivedOn: 'not-a-date' });

    expect(isUsable(corrupt, TODAY)).toBe(false);
    expect(fefo([corrupt], TODAY)).toEqual([]);
  });

  /**
   * A beyond-use window that is not a whole number of days is bad stored data.
   * A negative one produced a last-usable day before the vial was opened, and
   * `Date.UTC` silently truncated a fractional one.
   */
  it.each([-1, 1.5, Number.NaN])('refuses a beyond-use window of %s days', (days) => {
    const bad = lot({ id: 'a', openedOn: '2026-08-01', beyondUseDays: days });

    expect(() => lastUsableDay(bad, TODAY)).toThrow(/not a whole number of days/u);
  });

  /**
   * Two rows carrying identical fields built by two code paths compared unequal
   * under `JSON.stringify`, so a duplicate the caller could not deduplicate
   * threw on a balance read for data that was fine.
   */
  it('treats a duplicate as a duplicate whatever order its keys were written in', () => {
    const first = movement({ id: 'm1', quantity: 10 });
    const reordered = Object.fromEntries(
      Object.entries(first).reverse()
    ) as unknown as StockMovement;

    expect(JSON.stringify(first), 'the comparison this guards against').not.toBe(
      JSON.stringify(reordered)
    );
    expect(lotBalance([first, reordered], 'lot-a', TODAY)).toBe(10);
  });

  /**
   * `.trim()` on an absent actor threw a TypeError, turning the validation
   * failure this function exists to report into an application error - on
   * precisely the malformed audit input it was written to catch. The other
   * identifiers were not checked at all.
   */
  it.each(['id', 'itemId', 'lotId', 'actorId'] as const)(
    'reports a missing %s rather than throwing on it',
    (field) => {
      const bare = { ...movement({ id: 'm' }) } as Record<string, unknown>;
      delete bare[field];

      expect(() => movementProblems(bare as unknown as StockMovement)).not.toThrow();
      expect(movementProblems(bare as unknown as StockMovement).length).toBeGreaterThan(0);
    }
  );

  it.each(['id', 'itemId', 'lotId', 'actorId'] as const)('refuses a blank %s', (field) => {
    const blank = { ...movement({ id: 'm' }), [field]: '   ' } as StockMovement;

    expect(movementProblems(blank).length).toBeGreaterThan(0);
  });

  /**
   * Rounding after every addition discarded stock whose individual quantities
   * sat below the grid, so the per-lot figure and the single-lot figure
   * disagreed for the same ledger - and allocation read the wrong one.
   */
  it('agrees with lotBalance when the quantities are finer than the grid', () => {
    const dust = Array.from({ length: 10 }, (_, index) =>
      movement({ id: `m${String(index)}`, quantity: 0.0000004 })
    );

    expect(lotBalance(dust, 'lot-a', TODAY)).toBe(0.000004);
    expect(balancesByLot(dust, 'item-1', TODAY).get('lot-a')).toBe(0.000004);
    expect(itemBalance(dust, 'item-1', TODAY)).toBe(0.000004);
  });

  /**
   * `Allocation` is a plain interface, so a caller can build one - and these
   * tests do. `movementsFor` checked no line against the totals beside it, so a
   * forged allocation emitted a movement the ledger accepted.
   */
  it('refuses an allocation whose lines do not sum to what it claims', () => {
    const forged = {
      itemId: 'item-1',
      lines: [{ lotId: 'a', lotNumber: 'A1', quantity: 100 }],
      allocated: 1,
      requested: 1,
      shortfall: 0,
    };

    expect(() =>
      movementsFor(forged, {
        kind: 'DISPENSE',
        occurredOn: TODAY,
        actorId: 'user-1',
        idFor: () => 'mv-0',
      })
    ).toThrow(/lines sum to 100 but the allocation says 1/u);
  });

  it('refuses an allocation that does not account for what was requested', () => {
    const forged = {
      itemId: 'item-1',
      lines: [{ lotId: 'a', lotNumber: 'A1', quantity: 1 }],
      allocated: 1,
      requested: 10,
      shortfall: 0,
    };

    expect(() =>
      movementsFor(forged, {
        kind: 'DISPENSE',
        occurredOn: TODAY,
        actorId: 'user-1',
        idFor: () => 'mv-0',
      })
    ).toThrow(/accounts for 1 of a requested 10/u);
  });

  /**
   * Truthiness handed a clinically significant decision to JavaScript: the
   * string 'false' from an unchecked form is truthy and chose divisible, while
   * an omitted value chose indivisible - both silently, and both being the
   * answer nobody gave.
   */
  it.each([undefined, 'false', 1, null])('refuses %j as a divisibility answer', (bad) => {
    const lots = [lot({ id: 'a', lotNumber: 'A1', expiresOn: '2027-01-01' })];
    const ledger = [movement({ id: 'm1', quantity: 10 })];

    expect(() =>
      allocate(lots, ledger, 'item-1', exactlyThisManyStockUnits(5), TODAY, {
        divisible: bad as unknown as boolean,
      })
    ).toThrow(/must say whether the quantity may be split/u);
  });
});

import { describe, expect, it } from 'vitest';

import { isStockUnit, STOCK_UNITS } from '../inventory/units.js';

/**
 * The closed unit set.
 *
 * The compile-time proofs in `units.ts` are what keep the tuple and
 * `@openrunic/inventory` in step, and they need no test - a drift there is a
 * build failure. What needs a test is the runtime guard, because
 * `StockItem.unit` is a `String` column and a value can arrive from a seed, an
 * import or a migration without any compiler having looked at it.
 */
describe('the units an item may be counted in', () => {
  it('accepts every unit in the closed set', () => {
    for (const unit of STOCK_UNITS) {
      expect(isStockUnit(unit), unit).toBe(true);
    }
  });

  /**
   * Three of the nine are UCUM codes, where case is part of the code: `mL` is
   * millilitres and `ML` is not a UCUM unit at all. A fold-insensitive guard
   * would let a spreadsheet import of "ML" through, and the label on every
   * screen would then read as a unit nobody defined.
   */
  it('is case-sensitive, because three of the units are UCUM codes', () => {
    expect(isStockUnit('mL')).toBe(true);
    expect(isStockUnit('ML')).toBe(false);
    expect(isStockUnit('Mg')).toBe(false);
    expect(isStockUnit('GRAM')).toBe(false);
  });

  it('refuses a unit this system cannot count in', () => {
    expect(isStockUnit('box')).toBe(false);
    expect(isStockUnit('')).toBe(false);
  });

  it('names each unit once', () => {
    expect(new Set(STOCK_UNITS).size).toBe(STOCK_UNITS.length);
  });
});

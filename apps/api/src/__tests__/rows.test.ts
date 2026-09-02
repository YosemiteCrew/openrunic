import { describe, expect, it } from 'vitest';

import { toPlainRow, type ModelRecord } from '../repositories/rows.js';

import { FIXED_NOW, testId } from './support.js';

/**
 * The one transformation a Prisma record undergoes on its way to a row.
 *
 * `toPlainRow` flattens `Decimal` columns to numbers, and until now nothing
 * asked it to: the in-memory dataset stores plain numbers and the fake Prisma
 * port says so in a comment, so no test in this suite ever handed it a decimal.
 * The function whose entire job is that conversion was therefore exercised only
 * on inputs where it does nothing.
 *
 * It matters because a decimal that reached the wire serialises as an object.
 * That is valid JSON and not a number, so a client reading `Quantity.value` off
 * a Goal target, or a dispensed quantity off a MedicationDispense, gets NaN
 * without anything reporting an error.
 */

/** What Prisma hands back for a Decimal column: an object carrying `toNumber`. */
function decimal(value: number): unknown {
  return {
    toNumber: () => value,
    toString: () => String(value),
  };
}

function goalRecord(overrides: Record<string, unknown> = {}): ModelRecord<'Goal'> {
  return {
    id: testId(1),
    tenantId: testId(2),
    patientId: testId(3),
    carePlanId: null,
    lifecycleStatus: 'ACTIVE',
    achievementStatus: null,
    priority: null,
    description: 'HbA1c below 7%',
    descriptionCode: null,
    descriptionSystem: null,
    targetMeasureCode: null,
    targetMeasureSystem: null,
    targetValue: decimal(7),
    targetLow: null,
    targetHigh: null,
    targetUnit: '%',
    startDate: null,
    dueDate: null,
    statusReason: null,
    expressedByUserId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  } as unknown as ModelRecord<'Goal'>;
}

describe('toPlainRow', () => {
  it('flattens a Decimal column to a number', () => {
    const row = toPlainRow<'Goal'>(goalRecord());

    expect(row.targetValue).toBe(7);
    expect(typeof row.targetValue).toBe('number');
  });

  it('flattens every Decimal column, not only the first', () => {
    /* A loop that stopped early, or a hand-maintained list of decimal columns,
       would pass the test above and leave the range bounds as objects. */
    const row = toPlainRow<'Goal'>(
      goalRecord({ targetValue: null, targetLow: decimal(110), targetHigh: decimal(130) })
    );

    expect(row.targetLow).toBe(110);
    expect(row.targetHigh).toBe(130);
  });

  it('leaves nulls null rather than turning them into zero', () => {
    /* A null decimal is a column nobody filled in. Read as 0 it becomes a
       target of zero, which for a blood pressure is a different statement
       entirely. */
    const row = toPlainRow<'Goal'>(goalRecord({ targetValue: null }));

    expect(row.targetValue).toBeNull();
  });

  it('leaves dates alone', () => {
    /*
     * Every row carries timestamps, so a projection that mangled them would
     * break everything, and this says it does not.
     *
     * It is not what proves the `instanceof Date` clause in `isDecimalLike`.
     * Deleting that clause passes this test, because a Date carries no
     * `toNumber` and the duck-type check rejects it anyway. The clause is belt
     * and braces against a date-like value that does carry one, and nothing in
     * this schema is such a value, so there is no honest test for it.
     */
    const row = toPlainRow<'Goal'>(goalRecord());

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt).toEqual(FIXED_NOW);
  });

  it('leaves strings, booleans and nulls untouched', () => {
    const row = toPlainRow<'Goal'>(goalRecord());

    expect(row.description).toBe('HbA1c below 7%');
    expect(row.targetUnit).toBe('%');
    expect(row.carePlanId).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { goalSpec } from '../repositories/specs/clinical.js';

/**
 * The two ports must agree on where an undated goal falls.
 *
 * The memory port sorts an absent `dueDate` with a -Infinity sentinel, so an
 * undated goal comes first ascending and last descending. Postgres does the opposite by
 * default, so without an explicit `nulls` the production and in-memory ports
 * returned different orders the moment a dated and an undated goal shared a page
 * - and the sort tests missed it because their fixtures were all dated. The
 * orderBy must pin the null placement to the memory port's answer.
 */
describe('goal due-date ordering pins null placement', () => {
  const query = (order: 'asc' | 'desc') =>
    ({ page: 1, pageSize: 25, sort: 'dueDate' as const, order }) as Parameters<
      typeof goalSpec.orderBy
    >[0];

  it('puts undated goals first ascending', () => {
    expect(goalSpec.orderBy(query('asc'))).toEqual([
      { dueDate: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ]);
  });

  it('puts undated goals last descending', () => {
    expect(goalSpec.orderBy(query('desc'))).toEqual([
      { dueDate: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });
});

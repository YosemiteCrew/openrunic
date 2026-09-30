import { describe, expect, it } from 'vitest';

import {
  LIST_ALL_PAGE_SIZE,
  listAll,
  paginate,
  type BaseQuery,
  type Page,
} from '../repositories/collection.js';

interface NumberQuery extends BaseQuery {
  readonly even?: boolean;
}

/** A list over `0..count-1` that records every query it is asked. */
function numbers(count: number): {
  list: (query: NumberQuery) => Promise<Page<number>>;
  seen: NumberQuery[];
} {
  const all = Array.from({ length: count }, (_, i) => i);
  const seen: NumberQuery[] = [];
  return {
    seen,
    list: (query) => {
      seen.push(query);
      const rows = query.even === true ? all.filter((n) => n % 2 === 0) : all;
      return Promise.resolve(paginate(rows, query.page, query.pageSize));
    },
  };
}

const QUERY = { sort: 'value', order: 'asc' } as const;

describe('listAll', () => {
  it('returns every row across pages, in order', async () => {
    const count = LIST_ALL_PAGE_SIZE * 2 + 7;
    const { list, seen } = numbers(count);

    const rows = await listAll(list, QUERY);

    expect(rows).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(seen.map((q) => q.page)).toEqual([1, 2, 3]);
    expect(seen.every((q) => q.pageSize === LIST_ALL_PAGE_SIZE)).toBe(true);
  });

  it('carries the caller query into every page', async () => {
    const { list, seen } = numbers(LIST_ALL_PAGE_SIZE * 3);

    const rows = await listAll(list, { ...QUERY, even: true });

    expect(rows).toHaveLength((LIST_ALL_PAGE_SIZE * 3) / 2);
    expect(rows.every((n) => n % 2 === 0)).toBe(true);
    expect(seen.every((q) => q.even === true && q.sort === 'value')).toBe(true);
  });

  it('stops on a full last page without asking for another', async () => {
    const { list, seen } = numbers(LIST_ALL_PAGE_SIZE);

    expect(await listAll(list, QUERY)).toHaveLength(LIST_ALL_PAGE_SIZE);
    expect(seen).toHaveLength(1);
  });

  it('asks once and returns nothing when nothing matches', async () => {
    const { list, seen } = numbers(0);

    expect(await listAll(list, QUERY)).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('stops at the first empty page when the total claims more rows', async () => {
    let calls = 0;
    const list = (query: NumberQuery): Promise<Page<number>> => {
      calls += 1;
      // Refuse to be walked forever, so a regression fails here and not on the
      // suite timeout.
      if (calls > 5) throw new Error('walked past the empty page');
      const rows = query.page === 1 ? [1, 2, 3] : [];
      return Promise.resolve({ rows, total: 1000, page: query.page, pageSize: query.pageSize });
    };

    expect(await listAll(list, QUERY)).toEqual([1, 2, 3]);
    expect(calls).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';

import { escapeLike } from '../repositories/collection.js';
import { coreSpecs } from '../repositories/specs/core.js';
import { inventorySpecs } from '../repositories/specs/inventory.js';
import { platformSpecs } from '../repositories/specs/platform.js';

import { matchesWhere } from './fake-port.js';

/**
 * Free-text search, and the two characters that used to mean something.
 *
 * Every filter below answers the same question through two ports. In memory it
 * is `String.includes`, which is literal. In Postgres it is `ILIKE`, which
 * Prisma builds by splicing the caller's string into `'%' || $1 || '%'` with no
 * escaping at all, so a `%` matched any run of characters and a `_` matched
 * exactly one.
 *
 * The two ports therefore answered differently, and in the dangerous direction:
 * `GET /bff/v0/patients?q=%25` returned an empty page in memory, where the whole
 * HTTP suite runs, and every patient the caller could reach from the database.
 * `_` was worse for being plausible - stock SKUs and terminology codes carry
 * underscores routinely, so those searches were quietly matching more than they
 * were asked to.
 *
 * These assert the emitted `where` against the same row `matches` sees, using
 * `matchesWhere`, which models LIKE rather than substring precisely so this
 * class of divergence is visible to a test that needs no database.
 */

const BASE = { page: 1, pageSize: 25, order: 'asc' as const };

/** The caller's literal needle, and a row that contains it. */
const NEEDLES = ['100%', 'a_b', 'back\\slash', 'plain'] as const;

/** A row that a wildcard would match but a literal needle must not. */
const DECOYS: Record<string, string> = {
  '100%': '100 percent',
  a_b: 'axb',
  'back\\slash': 'backslash',
  plain: 'nothing alike',
};

interface Case {
  readonly name: string;
  readonly spec: {
    matches: (row: never, query: never) => boolean;
    where: (query: never) => Record<string, unknown>;
  };
  readonly query: (q: string) => Record<string, unknown>;
  /** Builds a row whose searched column holds `value`. */
  readonly row: (value: string) => Record<string, unknown>;
  /** True for a prefix filter, where the needle has to lead rather than occur. */
  readonly prefix?: true;
}

const CASES: readonly Case[] = [
  {
    name: 'patients q',
    spec: coreSpecs.patients as never,
    query: (q) => ({ ...BASE, sort: 'familyName', q }),
    row: (value) => ({ familyName: value, givenName: null, preferredName: null, mrn: null }),
  },
  {
    name: 'patients family',
    spec: coreSpecs.patients as never,
    query: (q) => ({ ...BASE, sort: 'familyName', family: q }),
    row: (value) => ({ familyName: value, givenName: null, preferredName: null, mrn: null }),
    prefix: true,
  },
  {
    name: 'patients given',
    spec: coreSpecs.patients as never,
    query: (q) => ({ ...BASE, sort: 'familyName', given: q }),
    row: (value) => ({ givenName: value, familyName: null, preferredName: null, mrn: null }),
    prefix: true,
  },
  {
    name: 'users q',
    spec: platformSpecs.users as never,
    query: (q) => ({ ...BASE, sort: 'familyName', q }),
    row: (value) => ({ givenName: value, familyName: '', email: '' }),
  },
  {
    name: 'facilities q',
    spec: platformSpecs.facilities as never,
    query: (q) => ({ ...BASE, sort: 'name', q }),
    row: (value) => ({ name: value, code: '' }),
  },
  {
    name: 'terminology q',
    spec: platformSpecs.terminology as never,
    query: (q) => ({ ...BASE, sort: 'display', q }),
    row: (value) => ({ display: value, code: '', system: '' }),
  },
  {
    name: 'stock items q',
    spec: inventorySpecs.stockItems as never,
    query: (q) => ({ ...BASE, sort: 'name', q }),
    row: (value) => ({ sku: value, name: '' }),
  },
];

describe('free-text search treats LIKE metacharacters literally', () => {
  it('escapes the three characters Postgres reads as pattern syntax', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    // The backslash goes first, or escaping the others would double-escape it.
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike('plain')).toBe('plain');
  });

  describe.each(CASES.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    it.each(NEEDLES)('finds the row holding a literal %s, and only that row', (needle) => {
      const query = entry.query(needle) as never;
      const emitted = entry.spec.where(query);

      const hit = entry.row(entry.prefix === true ? `${needle}y` : `x${needle}y`);
      const decoy = entry.row(DECOYS[needle] ?? 'unrelated');

      // The row that really contains the needle is found by both ports.
      expect(entry.spec.matches(hit as never, query), 'memory finds the literal').toBe(true);
      expect(matchesWhere(hit, emitted), 'Prisma finds the literal').toBe(true);

      // The row a wildcard would have swept in is found by neither. Before the
      // fix, `100%` matched the decoy in Postgres and nothing in memory.
      expect(entry.spec.matches(decoy as never, query), 'memory rejects the decoy').toBe(false);
      expect(matchesWhere(decoy, emitted), 'Prisma rejects the decoy').toBe(false);
    });

    it('agrees between the two ports for every needle and every row', () => {
      const disagreements: string[] = [];
      for (const needle of NEEDLES) {
        const query = entry.query(needle) as never;
        const emitted = entry.spec.where(query);
        const held = entry.prefix === true ? `${needle}y` : `x${needle}y`;
        for (const value of [...NEEDLES, ...Object.values(DECOYS), held, '']) {
          const row = entry.row(value);
          const memory = entry.spec.matches(row as never, query);
          const prisma = matchesWhere(row, emitted);
          if (memory !== prisma) {
            disagreements.push(`q=${needle} row=${value}: memory=${memory} prisma=${prisma}`);
          }
        }
      }
      expect(disagreements).toEqual([]);
    });
  });
});

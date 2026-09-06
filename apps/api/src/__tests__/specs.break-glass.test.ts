import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';
import { breakGlassGrantSpec } from '../repositories/specs/core.js';

import { testId } from './support.js';

/**
 * The natural key of a break-glass grant, which is the only one of the fourteen
 * that turns on a comparison rather than on equality.
 *
 * `uniqueBy` is one predicate written twice - `where` for Postgres, `matches`
 * for the memory port - and the two have to answer the same question. Every
 * other spec compares columns for equality, so a divergence needs a wrong
 * column name and the return annotation catches that at compile time. This one
 * asks whether the grant is *still in force*, which no annotation can check:
 * `gt` against `gte`, or a window measured from a clock read rather than from
 * the declaration's own `grantedAt`, type-checks perfectly and changes the
 * answer.
 *
 * Nothing reached either half before this file. The Prisma port is the only
 * caller of `uniqueBy.where` and the HTTP suites run the memory port, which
 * consults `matches` instead - so the route that creates the grant exercises
 * one half and cannot reach the other. Measured on `dev` before this file
 * existed: making this `where` throw left the whole api suite at rc=0, while
 * the same throw in `patientSpec` failed eight tests.
 *
 * The expectations below are written as literals rather than derived from the
 * spec. A test that builds its expectation out of one half cannot see the two
 * halves disagree, which is the failure this file exists for.
 */

const READER = testId(970);
const OTHER_READER = testId(971);
const CHART = testId(972);
const OTHER_CHART = testId(973);

/** The instant the declaration was made. Everything else is relative to it. */
const GRANTED_AT = new Date('2026-08-13T09:00:00.000Z');
/** A window still open at `GRANTED_AT`. */
const STILL_OPEN = new Date('2026-08-13T13:00:00.000Z');
/** A window that closed before it. */
const ALREADY_CLOSED = new Date('2026-08-13T05:00:00.000Z');

const INPUT = {
  userId: READER,
  patientId: CHART,
  reason: 'Unresponsive in resus, notes needed now.',
  grantedAt: GRANTED_AT,
  expiresAt: STILL_OPEN,
};

function row(overrides: Partial<ScopedRow<'BreakGlassGrant'>> = {}): ScopedRow<'BreakGlassGrant'> {
  return {
    id: testId(974),
    tenantId: testId(1),
    userId: READER,
    patientId: CHART,
    reason: 'An earlier declaration by the same reader on the same chart.',
    grantedAt: GRANTED_AT,
    expiresAt: STILL_OPEN,
    createdAt: GRANTED_AT,
    updatedAt: GRANTED_AT,
    ...overrides,
  };
}

describe("a break-glass grant's natural key", () => {
  /**
   * The emitted query, as a literal.
   *
   * `expiresAt` is compared against the *input's* `grantedAt` and not against a
   * clock read here, so the natural key, the route's bounds check and the
   * database trigger are all asking about one instant. Asserting the operand as
   * well as the operator is what makes that visible: a `where` rebuilt around
   * `new Date()` would still emit `gt` and would still pass a test that only
   * checked the key names.
   */
  it('asks Postgres for an unexpired grant by this reader on this chart', () => {
    expect(breakGlassGrantSpec.uniqueBy?.where(INPUT)).toEqual({
      userId: READER,
      patientId: CHART,
      expiresAt: { gt: GRANTED_AT },
    });
  });

  it('finds an existing grant whose window is still open', () => {
    expect(breakGlassGrantSpec.uniqueBy?.matches(row(), INPUT)).toBe(true);
  });

  /**
   * The case that separates `gt` from `gte`, and the reason this file is not
   * four assertions about equality.
   *
   * A grant expiring at the exact instant the new one is declared is spent. If
   * `matches` were written with `>=` - or `where` with `gte` - this row would be
   * read as a clash and the reader would be refused access they are entitled to,
   * in an emergency, on the strength of a grant that has just run out. Every
   * other case here is satisfied by both operators, so without this one the
   * suite cannot tell them apart.
   */
  it('does not treat a grant expiring at that exact instant as still in force', () => {
    expect(breakGlassGrantSpec.uniqueBy?.matches(row({ expiresAt: GRANTED_AT }), INPUT)).toBe(
      false
    );
  });

  it('does not treat an expired grant as still in force', () => {
    expect(breakGlassGrantSpec.uniqueBy?.matches(row({ expiresAt: ALREADY_CLOSED }), INPUT)).toBe(
      false
    );
  });

  /**
   * Both halves of the identity, separately.
   *
   * A grant is per reader *and* per chart. Dropping either comparison from
   * `matches` would make one reader's open declaration suppress every other
   * reader's, or one chart's suppress every other chart's - and the second is
   * the dangerous direction, because the failure is a refusal to open a record
   * rather than a duplicate row.
   */
  it('does not match another reader holding a grant on the same chart', () => {
    expect(breakGlassGrantSpec.uniqueBy?.matches(row({ userId: OTHER_READER }), INPUT)).toBe(false);
  });

  it('does not match this reader holding a grant on another chart', () => {
    expect(breakGlassGrantSpec.uniqueBy?.matches(row({ patientId: OTHER_CHART }), INPUT)).toBe(
      false
    );
  });

  /**
   * The conflict a caller sees. `message` takes no argument here, so it cannot
   * quote the reason or the chart - which is deliberate: the refusal goes to a
   * reader who has not been granted access, and naming the patient in it would
   * disclose that this chart exists.
   */
  it('answers a clash with the collection its own message', () => {
    expect(breakGlassGrantSpec.uniqueBy?.message(INPUT)).toContain('unexpired break-glass grant');
  });
});

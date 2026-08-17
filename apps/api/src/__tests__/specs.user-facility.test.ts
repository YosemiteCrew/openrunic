import { describe, expect, it } from 'vitest';

import type { RowContext } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import { userFacilitySpec } from '../repositories/specs/platform.js';

import { DEMO_FACILITY_A, FIXED_NOW, testId } from './support.js';

/**
 * The write half of the facility-grant collection, which no route reaches yet.
 *
 * `PractitionerRole` reads these grants and nothing writes them, so the create
 * and update paths are exercised here directly rather than through a request.
 * That is worth doing rather than deferring: the rules encoded in `newRow` and
 * `patchData` are the ones a future write route will inherit silently, and an
 * inherited rule nobody asserted is one nobody chose.
 */

const GRANT = testId(980);
const USER = testId(981);

const CONTEXT: RowContext = {
  tenantId: testId(1),
  now: FIXED_NOW,
  nextId: () => testId(982),
};

function row(overrides: Partial<ScopedRow<'UserFacility'>> = {}): ScopedRow<'UserFacility'> {
  return {
    id: GRANT,
    tenantId: testId(1),
    userId: USER,
    facilityId: DEMO_FACILITY_A,
    isPrimary: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('the facility-grant collection', () => {
  it('defaults a new grant to non-primary rather than leaving it unset', () => {
    expect(userFacilitySpec.newRow({ userId: USER, facilityId: DEMO_FACILITY_A }, CONTEXT)).toEqual(
      {
        userId: USER,
        facilityId: DEMO_FACILITY_A,
        isPrimary: false,
      }
    );
  });

  it('honours an explicit primary flag', () => {
    expect(
      userFacilitySpec.newRow(
        { userId: USER, facilityId: DEMO_FACILITY_A, isPrimary: true },
        CONTEXT
      ).isPrimary
    ).toBe(true);
  });

  /**
   * Which site is primary is the only amendable thing, and the omission is the
   * rule rather than an oversight.
   *
   * Moving a grant to another user or another facility is a revocation and a
   * new grant, exactly as it is for a role assignment, because the audit log
   * has to be able to show it as two events. An update that could rewrite
   * `facilityId` would let somebody's site change with no record that they had
   * ever worked at the first one.
   */
  it('amends only which site is primary, never who or where', () => {
    const patch = userFacilitySpec.patchData({ isPrimary: true }, row(), CONTEXT);

    expect(patch).toEqual({ isPrimary: true });
    expect(Object.keys(userFacilitySpec.patchData({}, row(), CONTEXT))).toEqual([]);
  });

  /**
   * The audit metadata carries the facility, which is what an auditor searches
   * on. A grant recorded with only its own id says that something changed and
   * not where.
   */
  it('records the facility and the primary flag on the audit entry', () => {
    expect(userFacilitySpec.writeMetadata?.(row({ isPrimary: true }), null)).toEqual({
      facilityId: DEMO_FACILITY_A,
      isPrimary: true,
    });
  });

  /**
   * Closed to the patient compartment, like the staff directory it belongs to.
   * Which sites a named member of staff works at is not something a portal
   * session has any business enumerating.
   */
  /**
   * `matches` and `where` are two spellings of one filter - one for the
   * in-memory store, one for Postgres - and `CollectionSpec` says they must
   * agree. Nothing enforces that, and a disagreement is the worst kind of bug
   * to find: the suite passes against memory and the deployed system returns
   * different rows.
   *
   * So both are run over the same fixtures and compared. `where` is asserted by
   * its shape rather than executed, since there is no Postgres here, but the
   * shape is what Prisma turns into the predicate.
   */
  describe('its two spellings of the same filter', () => {
    const here = row({ id: testId(983), facilityId: DEMO_FACILITY_A });
    const elsewhere = row({ id: testId(984), facilityId: testId(985) });
    const otherUser = row({ id: testId(986), userId: testId(987) });

    it('filters on nothing when the query names nothing', () => {
      const query = { page: 1, pageSize: 10, sort: 'createdAt' as const, order: 'asc' as const };

      for (const candidate of [here, elsewhere, otherUser]) {
        expect(userFacilitySpec.matches(candidate, query)).toBe(true);
      }
      expect(userFacilitySpec.where(query)).toEqual({});
    });

    it('filters on the user alone', () => {
      const query = {
        userId: USER,
        page: 1,
        pageSize: 10,
        sort: 'createdAt' as const,
        order: 'asc' as const,
      };

      expect(userFacilitySpec.matches(here, query)).toBe(true);
      expect(userFacilitySpec.matches(elsewhere, query)).toBe(true);
      expect(userFacilitySpec.matches(otherUser, query)).toBe(false);
      expect(userFacilitySpec.where(query)).toEqual({ userId: USER });
    });

    it('filters on the facility alone', () => {
      const query = {
        facilityId: DEMO_FACILITY_A,
        page: 1,
        pageSize: 10,
        sort: 'createdAt' as const,
        order: 'asc' as const,
      };

      expect(userFacilitySpec.matches(here, query)).toBe(true);
      expect(userFacilitySpec.matches(elsewhere, query)).toBe(false);
      expect(userFacilitySpec.where(query)).toEqual({ facilityId: DEMO_FACILITY_A });
    });

    it('filters on both together', () => {
      const query = {
        userId: USER,
        facilityId: DEMO_FACILITY_A,
        page: 1,
        pageSize: 10,
        sort: 'createdAt' as const,
        order: 'asc' as const,
      };

      expect(userFacilitySpec.matches(here, query)).toBe(true);
      expect(userFacilitySpec.matches(elsewhere, query)).toBe(false);
      expect(userFacilitySpec.matches(otherUser, query)).toBe(false);
      expect(userFacilitySpec.where(query)).toEqual({
        userId: USER,
        facilityId: DEMO_FACILITY_A,
      });
    });
  });

  it('orders by when the grant was made, tie-broken on id', () => {
    expect(userFacilitySpec.sortValue(row(), 'createdAt')).toBe(FIXED_NOW.getTime());
    expect(
      userFacilitySpec.orderBy({
        page: 1,
        pageSize: 10,
        sort: 'createdAt',
        order: 'desc',
      })
    ).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });

  it('is closed to the patient compartment', () => {
    expect(userFacilitySpec.compartment).toBe('closed');
  });
});

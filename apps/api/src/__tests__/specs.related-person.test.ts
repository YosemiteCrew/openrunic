import { describe, expect, it } from 'vitest';

import type { RowContext } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import { relatedPersonSpec, type RelatedPersonListQuery } from '../repositories/specs/core.js';

import { FIXED_NOW, testId } from './support.js';

/**
 * The collection behind `RelatedPerson`, exercised directly.
 *
 * The FHIR boundary serves this read-only, so `newRow` and `patchData` are
 * reachable through no request at all and would otherwise ship unasserted. That
 * is the half worth pinning: the defaults a future write route inherits are
 * decided here, and three of them are the booleans that become relationship
 * codings at the boundary. A guardian flag defaulting to `null` instead of
 * `false` would reach the mapper as an absent role rather than an unset one.
 *
 * `matches` and `where` are asserted against each other on the same rows,
 * because the spec contract is that they agree and the two storage
 * implementations pick one each.
 */

const TENANT = testId(1);
const PATIENT = testId(200);
const CONTEXT: RowContext = {
  tenantId: TENANT,
  now: FIXED_NOW,
  nextId: () => testId(201),
};

function row(overrides: Partial<ScopedRow<'RelatedPerson'>> = {}): ScopedRow<'RelatedPerson'> {
  return {
    id: testId(201),
    tenantId: TENANT,
    patientId: PATIENT,
    relationshipCode: 'MTH',
    relationshipText: 'Mother',
    givenName: 'Marisol',
    familyName: 'Verificada',
    phone: '+1 555 0142 118',
    email: null,
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'US',
    isGuardian: true,
    isEmergencyContact: true,
    isPortalProxy: false,
    active: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function query(overrides: Partial<RelatedPersonListQuery> = {}): RelatedPersonListQuery {
  return { page: 1, pageSize: 25, sort: 'familyName', order: 'asc', ...overrides };
}

describe('newRow', () => {
  it('defaults every role to false rather than leaving it unset', () => {
    /*
     * These three are NOT NULL on the row and become relationship codings at
     * the FHIR boundary. Left undefined they would reach the mapper as an
     * absent role, which reads as "not a guardian" and is a different claim
     * from "nobody said".
     */
    const created = relatedPersonSpec.newRow(
      {
        patientId: PATIENT,
        relationshipCode: 'MTH',
        givenName: 'Marisol',
        familyName: 'Verificada',
      },
      CONTEXT
    );

    expect(created).toMatchObject({
      isGuardian: false,
      isEmergencyContact: false,
      isPortalProxy: false,
      active: true,
      country: 'US',
    });
  });

  it('nulls the optional text rather than storing undefined', () => {
    const created = relatedPersonSpec.newRow(
      {
        patientId: PATIENT,
        relationshipCode: 'FTH',
        givenName: 'Tobias',
        familyName: 'Assertson',
      },
      CONTEXT
    );

    expect(created.relationshipText).toBeNull();
    expect(created.phone).toBeNull();
    expect(created.city).toBeNull();
  });

  it('keeps what it was given, including a role set false on purpose', () => {
    const created = relatedPersonSpec.newRow(
      {
        patientId: PATIENT,
        relationshipCode: 'GUARD',
        givenName: 'Adia',
        familyName: 'Nwosu',
        phone: '+1 555 0142 900',
        city: 'Birchwood',
        country: 'CA',
        isGuardian: false,
        isPortalProxy: true,
        active: false,
      },
      CONTEXT
    );

    expect(created).toMatchObject({
      relationshipCode: 'GUARD',
      phone: '+1 555 0142 900',
      city: 'Birchwood',
      country: 'CA',
      isGuardian: false,
      isPortalProxy: true,
      active: false,
    });
  });
});

describe('patchData', () => {
  it('carries only the columns the patch mentioned', () => {
    expect(relatedPersonSpec.patchData({ phone: '+1 555 0142 901' }, row(), CONTEXT)).toEqual({
      phone: '+1 555 0142 901',
    });
  });

  it('keeps a field set to false, which is a change and not an omission', () => {
    /* `Object.entries` filtering on `undefined` rather than on falsiness is
       what makes revoking a guardian flag possible at all. */
    expect(
      relatedPersonSpec.patchData({ isGuardian: false, active: false }, row(), CONTEXT)
    ).toEqual({
      isGuardian: false,
      active: false,
    });
  });

  it('drops an explicitly undefined field rather than writing it', () => {
    expect(
      relatedPersonSpec.patchData({ phone: undefined, city: 'Birchwood' }, row(), CONTEXT)
    ).toEqual({
      city: 'Birchwood',
    });
  });
});

describe('matches and where agree', () => {
  /*
   * The spec contract: the in-memory filter and the Prisma `where` describe the
   * same set. One storage implementation uses each, so a disagreement is a
   * collection that answers differently depending on how it is deployed.
   */
  const CASES: readonly { readonly name: string; readonly query: RelatedPersonListQuery }[] = [
    { name: 'no filter', query: query() },
    { name: 'by patient', query: query({ patientId: PATIENT }) },
    { name: 'by another patient', query: query({ patientId: testId(999) }) },
    { name: 'active only', query: query({ active: true }) },
    { name: 'inactive only', query: query({ active: false }) },
    { name: 'guardians', query: query({ isGuardian: true }) },
    { name: 'non-guardians', query: query({ isGuardian: false }) },
    { name: 'emergency contacts', query: query({ isEmergencyContact: true }) },
    {
      name: 'every clause at once',
      query: query({
        patientId: PATIENT,
        active: true,
        isGuardian: true,
        isEmergencyContact: true,
      }),
    },
  ];

  const ROWS = [
    row(),
    row({ id: testId(202), isGuardian: false, isEmergencyContact: false }),
    row({ id: testId(203), active: false }),
    row({ id: testId(204), patientId: testId(999) }),
  ];

  it.each(CASES)('$name', ({ query: q }) => {
    const where = relatedPersonSpec.where(q) as Record<string, unknown>;

    for (const candidate of ROWS) {
      const byWhere = Object.entries(where).every(
        ([column, value]) => (candidate as unknown as Record<string, unknown>)[column] === value
      );

      expect(
        relatedPersonSpec.matches(candidate, q),
        `${candidate.id} under ${JSON.stringify(q)}`
      ).toBe(byWhere);
    }
  });
});

describe('ordering', () => {
  it('sorts by family name by default, which is how a contact list reads', () => {
    expect(relatedPersonSpec.sortValue(row({ familyName: 'Abara' }), 'familyName')).toBe('Abara');
    expect(relatedPersonSpec.orderBy(query({ order: 'asc' }))).toEqual([
      { familyName: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('sorts by when the contact was added when asked', () => {
    expect(relatedPersonSpec.sortValue(row(), 'createdAt')).toBe(FIXED_NOW.getTime());
    expect(relatedPersonSpec.orderBy(query({ sort: 'createdAt', order: 'desc' }))).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('breaks a tie on id in both directions, so a page boundary is stable', () => {
    /* Two contacts with the same family name are ordinary. Without the tie-break
       the same query can return them either way round and a second page can
       repeat or skip one. */
    for (const order of ['asc', 'desc'] as const) {
      expect(relatedPersonSpec.orderBy(query({ order }))).toContainEqual({ id: 'asc' });
    }
  });
});

describe('scoping', () => {
  it('is compartmented on the patient, so a patient-bound token sees only their own', () => {
    expect(relatedPersonSpec.compartment).toEqual({ column: 'patientId' });
    expect(relatedPersonSpec.patientColumn).toBe('patientId');
  });

  it('is not facility-scoped, because a guardian belongs to a person and not a site', () => {
    expect(relatedPersonSpec.facilityScoped).toBeUndefined();
    expect(relatedPersonSpec.facilityColumn).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { COLLECTION_SPECS } from '../repositories/specs/index.js';

/**
 * The facility narrowing, held at the level it is actually decided.
 *
 * Every route-level fix for this was a fix to one instance. The appointment list
 * checked a facility only when the caller had named one; the generic CRUD list
 * did not check at all; the FHIR PractitionerRole projection read a user's sites
 * straight out of `UserFacility`. Three routes, three holes, one cause - a
 * collection whose rows carry a facility and whose reads are not narrowed to the
 * caller's grants.
 *
 * So the rule is asserted about the data rather than about any route: a spec that
 * names a facility column is a spec whose lists are narrowed. A new aggregate
 * that declares `facilityColumn` and forgets `facilityScoped` fails here, before
 * it has a route to leak through.
 *
 * If a collection ever genuinely needs the column without the narrowing - a
 * directory of sites, say, where the column IS the subject rather than the
 * boundary - add it here with the reason. An exemption that has to be written
 * down is one somebody has to defend.
 */

/**
 * Collections allowed to carry a facility column without narrowing reads to it.
 *
 * `patients` is the one, decided in #139. `Patient.primaryFacilityId` is the
 * site that registered somebody, not the site an act happened at - attribution
 * rather than containment - and it is the only facility column in the schema
 * that is not called `facilityId`. Narrowing on it hid the chart of a patient
 * registered at one site from the clinician treating them at another, while
 * still showing a patient registered here who has only ever been seen
 * elsewhere. Wrong in both directions is not a boundary.
 *
 * The column stays because it is a real fact about a patient and lists filter
 * on it deliberately. What confines a site-limited clinician is the sited
 * collections, where the acts live.
 */
const EXEMPT: ReadonlySet<string> = new Set(['patients']);

describe('every facility-sited collection narrows to the caller grants', () => {
  const sited = Object.entries(COLLECTION_SPECS).filter(
    ([, spec]) => (spec as { facilityColumn?: string }).facilityColumn !== undefined
  );

  it('finds collections to check at all', () => {
    // Guards the assertion below against a refactor that renames the field and
    // turns this whole file into a test of the empty set.
    expect(sited.length).toBeGreaterThan(5);
  });

  it.each(sited)('%s', (key, spec) => {
    if (EXEMPT.has(key)) return;
    expect(
      (spec as { facilityScoped?: true }).facilityScoped,
      `${key} names a facility column but does not narrow reads to the caller's grants`
    ).toBe(true);
  });
});

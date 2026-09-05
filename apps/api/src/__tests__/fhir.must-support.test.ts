import { mustSupportParams } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { SERVED_MODULES } from '../fhir/resources.js';

/**
 * Where this server falls short of the profiles it serves against, enumerated.
 *
 * `SEARCH_SUPPORT` in `packages/fhir` is the normative catalogue: it records
 * what US Core requires, and it must keep saying so whether or not this server
 * has got there. The modules record what is actually implemented. The gap
 * between the two is real, and the question is only whether it is written down
 * or left for an integrator to discover with a 400.
 *
 * Deleting a requirement from the catalogue to close the gap was the first
 * attempt and it was wrong. It did not stop the server refusing the parameter -
 * the modules decide that - it made `mustSupportParams` stop reporting a
 * requirement US Core really does impose. The gap became invisible rather than
 * closed, and this entry still declares the US Core profile, so the catalogue
 * would have understated what conformance takes while the profile claim stood.
 * An admitted gap is better than a quiet one.
 *
 * So the catalogue keeps the requirement, the module keeps the truth, and this
 * pins the difference. A gap that closes fails this test and the entry comes
 * out; a gap that opens fails it too, which is the point - dropping a
 * must-support parameter should not be something a change can do quietly.
 */

/**
 * Must-support parameters this server does not implement, and why.
 *
 * Three kinds, and the distinction matters more than the total:
 *
 * A **status** entry is deliberate and explained in `resources.ts`. A coded
 * parameter is advertised only where the domain enum and the FHIR value set
 * agree one for one, because searching by a code that collapses several domain
 * states would match one and miss the rest. Those will not be implemented as
 * written; closing them means either a lossless mapping or a set-valued filter.
 *
 * A **join** entry needs a set-based repository read, which does not exist.
 * `specialty` is the worked example - the taxonomy code is on the user and the
 * search is over grants. #88 unblocks these; #94 tracks `specialty`.
 *
 * The rest are simply not built yet.
 *
 * This is a baseline of a real shortfall, not a design. It is written down so
 * the set cannot grow quietly, and so an integrator reading `mustSupportParams`
 * against what the server accepts finds the difference explained rather than a
 * 400.
 */
const KNOWN_GAPS: Readonly<Record<string, readonly string[]>> = {
  // Not built yet.
  Location: ['address'],
  Observation: ['category'],
  Condition: ['category', 'clinical-status'],
  AllergyIntolerance: ['clinical-status'],
  DiagnosticReport: ['category', 'code'],
  DocumentReference: ['type', 'status'],
  Task: ['status', 'code'],
  ServiceRequest: ['category', 'code', 'status'],
  Encounter: ['status', 'class'],
  MedicationRequest: ['status', 'intent'],
  // Deliberate: the domain enum is wider than the FHIR value set, so the
  // mapping is lossy and the parameter is left out rather than half answered.
  Appointment: ['status'],
  MedicationStatement: ['status'],
  Immunization: ['status'],
  // No columns exist. The practice's postal address and NPI live on `Facility`,
  // which is what `Location` serves; `Organisation` holds the name and the
  // deployment state. Inventing an address from the first facility would state
  // a fact the record never did, and a practice may have several sites.
  Organization: ['address', 'identifier'],
};

describe('the must-support parameters this server does not implement', () => {
  const gaps = SERVED_MODULES.flatMap((module) => {
    const required = mustSupportParams(module.type).map((param) => param.name);
    const missing = required.filter((name) => !module.params.includes(name));
    return missing.length === 0 ? [] : [[module.type, missing] as const];
  });

  it('are exactly the ones written down', () => {
    expect(Object.fromEntries(gaps)).toEqual(KNOWN_GAPS);
  });

  /**
   * An unimplemented parameter is refused rather than ignored. A client that
   * filters on an ignored parameter receives the whole practice and believes it
   * received a slice, which is the failure the boundary is built to avoid - so
   * the gap has to be visible at request time as well as here.
   */
  it('are refused rather than silently ignored', () => {
    for (const [type, missing] of gaps) {
      const module = SERVED_MODULES.find((candidate) => candidate.type === type);
      for (const name of missing) {
        expect(module?.params, `${type}?${name}=`).not.toContain(name);
      }
    }
  });
});

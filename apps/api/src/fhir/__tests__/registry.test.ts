import { COMMON_SEARCH_PARAMS, SEARCH_SUPPORT } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { MAX_PAGE_SIZE } from '../../schemas/pagination.js';
import { servedResources } from '../index.js';
import {
  CONTROL_SEARCH_PARAMS,
  acceptedSearchParams,
  profileOf,
  searchParamDefinition,
  type ServedResource,
} from '../registry.js';

/**
 * The conformance registry, tested directly.
 *
 * `fhir.test.ts` exercises it through the router, which is the test that
 * matters: it enforces ADR-0002's rule that /metadata cannot drift from what
 * the server serves. These cover the pieces at the level of the functions
 * themselves, where a wrong answer is a wrong CapabilityStatement rather than a
 * failed request.
 *
 * The first version of this file also tested a control-parameter arm of
 * `searchParamDefinition`, on the reasoning that /metadata would otherwise omit
 * paging. That was wrong: `buildCapabilityStatement` appends
 * `CONTROL_SEARCH_PARAMS` itself and only ever passes a module's own declared
 * names to the lookup, so the arm could not be reached by anything. It has been
 * deleted rather than covered, and what replaced it is the invariant that made
 * it unreachable.
 */

const SERVED: readonly ServedResource[] = [
  { type: 'Patient', interactions: ['read', 'search-type'], params: ['_id', 'name'] },
];

describe('searchParamDefinition', () => {
  it('finds a parameter the resource type defines', () => {
    const name = SEARCH_SUPPORT.Patient.searchParams[0]?.name;
    expect(name).toBeDefined();

    expect(searchParamDefinition('Patient', name as string)?.name).toBe(name);
  });

  it('falls back to the parameters every resource shares', () => {
    const shared = COMMON_SEARCH_PARAMS[0]?.name;
    expect(shared).toBeDefined();

    expect(searchParamDefinition('Patient', shared as string)?.name).toBe(shared);
  });

  it('does not resolve a control parameter, because nothing asks it to', () => {
    /*
     * `_count` and `_offset` are real accepted parameters, and this is still
     * the right answer. `buildCapabilityStatement` appends their definitions
     * from the constant, and the search router only ever reads their names
     * through `acceptedSearchParams`. A third arm here would be reachable only
     * by a served resource that declared `_count` in its own params, which
     * would then advertise it twice.
     */
    expect(searchParamDefinition('Patient', '_count')).toBeUndefined();
    expect(searchParamDefinition('Patient', '_offset')).toBeUndefined();
  });

  it('is only two arms because no served resource declares a control parameter', () => {
    /*
     * The invariant that lets the lookup stop at the shared list. If a module
     * ever adds `_count` to its own params, the CapabilityStatement lists it
     * twice and this fails - which is the failure worth catching, rather than a
     * fallback quietly papering over it.
     */
    const control = new Set(CONTROL_SEARCH_PARAMS.map((param) => param.name));
    const declared = servedResources().flatMap((module) => module.params);

    expect(declared.filter((name) => control.has(name))).toEqual([]);
  });

  it('answers undefined for a name no list defines', () => {
    expect(searchParamDefinition('Patient', 'not-a-parameter')).toBeUndefined();
  });

  it('documents the page ceiling the schema actually enforces', () => {
    /*
     * The documentation string interpolates `MAX_PAGE_SIZE`. If the two ever
     * came apart, `/metadata` would advertise a ceiling the server rejects,
     * which is the drift ADR-0002 forbids and which no type can catch.
     */
    const count = CONTROL_SEARCH_PARAMS.find((param) => param.name === '_count');

    expect(count?.documentation).toContain(String(MAX_PAGE_SIZE));
  });
});

describe('acceptedSearchParams', () => {
  it('accepts the resource parameters and the control parameters together', () => {
    expect(acceptedSearchParams(SERVED, 'Patient')).toEqual(
      new Set(['_id', 'name', '_count', '_offset'])
    );
  });

  it('is defensive about a type that is not in the list, which the router never asks it', () => {
    /*
     * Not a scenario: `fhirRoutes` mounts a search handler per module and
     * derives `served` from that same list, so an unserved type gets a 404 from
     * the router and never reaches here. This pins what the `?? []` does rather
     * than describing a request that can happen.
     */
    expect(acceptedSearchParams(SERVED, 'Observation')).toEqual(new Set(['_count', '_offset']));
  });
});

describe('profileOf', () => {
  it('names the US Core profile a resource is served against', () => {
    expect(profileOf('Patient')).toBe(SEARCH_SUPPORT.Patient.profile);
  });
});

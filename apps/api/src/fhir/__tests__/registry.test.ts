import { COMMON_SEARCH_PARAMS, SEARCH_SUPPORT } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { MAX_PAGE_SIZE } from '../../schemas/pagination.js';
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
 * `fhir.test.ts` already exercises these through the router, which is the test
 * that matters: it is what enforces ADR-0002's rule that `/metadata` can never
 * drift from what the server actually serves. What it cannot reach is the
 * control-parameter arm of the lookup, because no route ever asks for the
 * definition of `_count` - the router validates paging separately and reads
 * these only when it is describing itself.
 *
 * So the fallback chain had one of its three arms untested, which matters more
 * than the line count suggests: an arm that is never taken is an arm that can
 * be reordered or dropped without anything failing, and the order is what makes
 * a resource-specific parameter win over a common one of the same name.
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

  it('falls back again to the control parameters, which no route asks it for', () => {
    /*
     * The arm `fhir.test.ts` cannot reach. `_count` and `_offset` are accepted
     * on every search but validated by the paging schema rather than looked up
     * here, so this arm is only ever taken while the server is describing
     * itself - which is exactly when a missing definition would ship a
     * CapabilityStatement that omits paging.
     */
    expect(searchParamDefinition('Patient', '_count')).toEqual({
      name: '_count',
      type: 'number',
      documentation: `Page size, 1 to ${MAX_PAGE_SIZE}.`,
      mustSupport: false,
    });
    expect(searchParamDefinition('Patient', '_offset')?.type).toBe('number');
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

  it('still accepts the control parameters for a type this server does not serve', () => {
    /*
     * Not an oversight. Paging is answered before a resource type is resolved,
     * so an unserved type has to accept the same control parameters or the
     * refusal a client gets names the wrong thing.
     */
    expect(acceptedSearchParams(SERVED, 'Observation')).toEqual(new Set(['_count', '_offset']));
  });
});

describe('profileOf', () => {
  it('names the US Core profile a resource is served against', () => {
    expect(profileOf('Patient')).toBe(SEARCH_SUPPORT.Patient.profile);
  });
});

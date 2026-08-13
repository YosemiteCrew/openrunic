import { FHIR_VERSION, type CapabilityStatement } from '@openrunic/fhir';

import { FHIR_JSON } from '../http/fhir.js';

import { COMMON_SEARCH_PARAMS, FHIR_RESOURCES } from './registry.js';

/**
 * The CapabilityStatement, generated from {@link FHIR_RESOURCES}.
 *
 * Never hand-written. A hand-written statement is a promise that drifts from
 * the implementation on the first merge, and an interop client that trusts it
 * fails in a way that looks like the client's bug.
 */
export function buildCapabilityStatement(now: Date, softwareVersion: string): CapabilityStatement {
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: now.toISOString(),
    kind: 'instance',
    software: { name: 'openrunic', version: softwareVersion },
    implementation: { description: 'openrunic EMR FHIR R4 endpoint' },
    fhirVersion: FHIR_VERSION,
    format: [FHIR_JSON],
    rest: [
      {
        mode: 'server',
        documentation:
          'US Core-shaped R4 endpoint. Search implements the must-support parameters per resource against relational columns; chaining, `_include` and `_revinclude` are rejected with an OperationOutcome rather than silently ignored.',
        security: { service: [{ text: 'SMART on FHIR (bearer)' }] },
        resource: FHIR_RESOURCES.map((resource) => ({
          type: resource.type,
          ...(resource.profile === undefined ? {} : { supportedProfile: [resource.profile] }),
          interaction: resource.interactions.map((code) => ({ code })),
          searchParam: [...resource.searchParams, ...COMMON_SEARCH_PARAMS].map((param) => ({
            name: param.name,
            type: param.type,
            documentation: param.documentation,
          })),
        })),
      },
    ],
  };
}

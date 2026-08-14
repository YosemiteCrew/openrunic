import { FHIR_VERSION, type CapabilityStatement } from '@openrunic/fhir';

import { FHIR_JSON } from '../http/fhir.js';

import { BULK_EXPORT_OPERATIONS } from './bulk-export.js';
import { CONTROL_SEARCH_PARAMS, profileOf, searchParamDefinition } from './registry.js';
import type { FhirResourceModule } from './resource-module.js';

/**
 * The CapabilityStatement, generated from the mounted resource modules.
 *
 * Never hand-written. A hand-written statement is a promise that drifts from
 * the implementation on the first merge, and an interop client that trusts it
 * fails in a way that looks like the client's bug. What is published here is
 * the same list the router mounts and the same parameter names the search
 * validator accepts, so `metadata` cannot claim a resource this server does not
 * serve or a parameter it would reject.
 */
export function buildCapabilityStatement(
  now: Date,
  softwareVersion: string,
  modules: readonly FhirResourceModule[]
): CapabilityStatement {
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
          'US Core-shaped R4 endpoint. Search implements the must-support parameters per resource against relational columns; chaining, `_include` and `_revinclude` are rejected with an OperationOutcome rather than silently ignored. Authorisation is SMART on FHIR: a patient-scoped token is confined to its launch context by the data layer, not by a filter a handler applies.',
        security: { service: [{ text: 'SMART on FHIR (bearer)' }] },
        // Declared from the same list the router mounts, for the same reason
        // the resource list is generated: an operation a client can read about
        // and cannot call is worse than one that was never advertised.
        operation: operationsFor('system'),
        resource: modules.map((module) => {
          const profile = profileOf(module.type);
          return {
            type: module.type,
            ...(profile === undefined ? {} : { supportedProfile: [profile] }),
            interaction: module.interactions.map((code) => ({ code })),
            ...(operationsFor(module.type).length === 0
              ? {}
              : { operation: operationsFor(module.type) }),
            searchParam: [
              ...module.params.map((name) => searchParamDefinition(module.type, name)),
              ...CONTROL_SEARCH_PARAMS,
            ]
              .filter((param) => param !== undefined)
              .map((param) => ({
                name: param.name,
                type: param.type,
                documentation: param.documentation,
              })),
          };
        }),
      },
    ],
  };
}

/** The declared operations at one scope: the server itself, or one resource type. */
function operationsFor(scope: string): { name: string; definition: string }[] {
  return BULK_EXPORT_OPERATIONS.filter((operation) => operation.scope === scope).map(
    (operation) => ({ name: operation.name, definition: operation.definition })
  );
}

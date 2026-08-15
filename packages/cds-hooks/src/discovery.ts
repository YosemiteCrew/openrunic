import type { DiscoveryDocument, ServiceDefinition } from './protocol.js';
import { CdsHooksError } from './errors.js';

/**
 * DISCOVERY, WHICH IS HOW ANYTHING FINDS THIS SERVER AT ALL.
 *
 * `GET /cds-services` is the entry point of the whole protocol: an EMR asks what
 * this server offers and gets back a list it can wire into its own workflow. It
 * is unauthenticated by convention, and it must be, because a client needs it
 * before it has been configured with anything.
 *
 * That makes what goes in it a disclosure decision. Service ids, hooks and
 * descriptions are the contract and belong there. Nothing about this practice,
 * its patients or its configuration does - the document is identical whichever
 * organisation asks.
 */

/** The document, with the services sorted so two servers can be diffed. */
export function discoveryDocument(services: readonly ServiceDefinition[]): DiscoveryDocument {
  return {
    services: [...services].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/**
 * Finds a service by id, refusing rather than falling through.
 *
 * 404 rather than an empty card list, because those mean different things to a
 * calling EMR: no cards is "we looked and found nothing to say", and that is a
 * clinically load-bearing statement to make about a service that was never
 * consulted.
 */
export function serviceById<T extends { readonly definition: ServiceDefinition }>(
  services: readonly T[],
  id: string
): T {
  const service = services.find((candidate) => candidate.definition.id === id);
  if (service === undefined) throw CdsHooksError.noSuchService(id);
  return service;
}

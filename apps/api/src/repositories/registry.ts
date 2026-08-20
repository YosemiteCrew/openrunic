import type { AuditCollector } from '../audit/collector.js';

import type { AuditQueryRepository } from './audit-query.js';
import type { BaseQuery, Collection, CollectionSpec } from './collection.js';
import type { PrismaModelName, ScopedRow } from './rows.js';
import { COLLECTION_SPECS } from './specs/index.js';
import type { Repositories } from './types.js';

/**
 * Assembling the request's repositories.
 *
 * Both storage implementations reach this function with nothing but a factory,
 * so the *set* of aggregates, and the fact that every one of them is bound to
 * the request scope, is decided in exactly one place. An aggregate that exists
 * in `specs/` is reachable in memory and in Postgres, with the same tenant and
 * compartment narrowing, or it exists in neither.
 */

/** What the tenant-scope middleware supplies to obtain request-bound repositories. */
export interface RequestScope {
  tenantId: string;
  /**
   * Set when the principal is patient-scoped. Every collection that names a
   * chart narrows to it, and the ones that cannot are refused outright, so the
   * compartment is a property of the data access rather than a check a handler
   * performs.
   */
  compartmentPatientId?: string;
  /**
   * The facilities this principal may see, or undefined for a principal holding
   * `facility.all`.
   *
   * Undefined is unrestricted and an empty array is nothing, which is the
   * opposite of the usual convention and is deliberate: `Principal.facilityIds`
   * already documents that an empty grant list is not a wildcard, and a scope
   * that treated `[]` as "everything" would hand the whole tenant to a principal
   * who was granted no site at all.
   *
   * Applied by the repository rather than by handlers, for the same reason the
   * patient compartment is: a principal reaches one site because the objects it
   * was given cannot reach another, not because every route remembered to ask.
   */
  facilityIds?: readonly string[];
  audit: AuditCollector;
}

export type CollectionFactory = <
  M extends PrismaModelName,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>
) => Collection<ScopedRow<M>, TCreate, TPatch, TQuery>;

/**
 * Builds one repository per spec.
 *
 * The two assertions here are the price of iterating a heterogeneous map: the
 * loop sees the union of every spec, and no single instantiation of the factory
 * generic satisfies a union. Both the input and the output type are recovered
 * immediately afterwards from {@link Repositories}, which is itself derived
 * from the same map, so a spec cannot appear under a key whose repository type
 * disagrees with it.
 */
export function buildRepositories(
  scope: RequestScope,
  make: CollectionFactory,
  audit: AuditQueryRepository
): Repositories {
  const build = make as unknown as (spec: unknown) => unknown;
  const collections: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(COLLECTION_SPECS)) {
    collections[key] = build(spec);
  }
  return { tenantId: scope.tenantId, audit, ...collections } as Repositories;
}

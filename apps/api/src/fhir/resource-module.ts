import type { FhirResource, Interaction, SupportedResourceType } from '@openrunic/fhir';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import type { Permission } from '../policy/permissions.js';
import type { BaseQuery, Page } from '../repositories/collection.js';
import type { Repositories } from '../repositories/types.js';

import type { FhirPaging, SearchParams } from './params.js';

/**
 * One resource type at the FHIR boundary.
 *
 * Search and read are the same two shapes for every resource: narrow the
 * repository the token is already bound to, page it, map each row through
 * `packages/fhir`, and wrap the result in a Bundle with the right links. What
 * differs per resource is only which repository, which parameters and which
 * mapper, so that is all a module supplies.
 *
 * The declared `params` are load-bearing twice over: they are what the
 * CapabilityStatement advertises, and they are what a search is validated
 * against. Advertising a parameter the handler ignores is the failure mode this
 * arrangement exists to make impossible, and `fhir.test.ts` asserts it directly.
 */

/**
 * What a mapper may need beyond the row itself.
 *
 * `prepared` is whatever the resource's own `prepare` returned for this page,
 * and is typed by the descriptor rather than left as `unknown`, so a mapper
 * cannot reach for something the loader did not fetch.
 */
export interface ResourceContext<TPrepared = undefined> {
  repositories: Repositories;
  prepared: TPrepared;
}

export interface FhirResourceDescriptor<TRow, TQuery extends BaseQuery, TPrepared = undefined> {
  readonly type: SupportedResourceType;
  readonly interactions: readonly Interaction[];
  /** Search parameters implemented, named exactly as the catalogue names them. */
  readonly params: readonly string[];
  /** The role capability required on top of the SMART scope. */
  readonly permission: Permission;
  collection(repositories: Repositories): {
    list(query: TQuery): Promise<Page<TRow>>;
    findById(id: string): Promise<TRow | null>;
  };
  toQuery(params: SearchParams, paging: FhirPaging): TQuery;
  /**
   * Loads everything the page's rows need, once, before any of them is mapped.
   *
   * Some resources carry a child list - a Claim has its lines, a
   * PractitionerRole has the practitioner and the role behind it - and the
   * obvious way to get them is a lookup inside `toResource`. That is one query
   * per row: a bundle of twenty claims becomes twenty-one round trips, and it
   * degrades with page size, which is exactly the shape of problem that looks
   * fine in a test with three fixtures.
   *
   * So the loader sees the whole page and returns whatever the mapper will
   * need, keyed however suits it. Resources with nothing to fetch omit this and
   * pay nothing.
   */
  prepare?(rows: readonly TRow[], repositories: Repositories): Promise<TPrepared>;
  toResource(row: TRow, context: ResourceContext<TPrepared>): FhirResource | Promise<FhirResource>;
}

/** A resource module with its row and query types erased, ready to mount. */
export interface FhirResourceModule {
  readonly type: SupportedResourceType;
  readonly interactions: readonly Interaction[];
  readonly params: readonly string[];
  readonly permission: Permission;
  search(c: Context<AppEnv>, params: SearchParams, paging: FhirPaging): Promise<Page<FhirResource>>;
  read(c: Context<AppEnv>, id: string): Promise<FhirResource | null>;
}

export function defineFhirResource<TRow, TQuery extends BaseQuery, TPrepared = undefined>(
  descriptor: FhirResourceDescriptor<TRow, TQuery, TPrepared>
): FhirResourceModule {
  /** One call per page, or none at all when the resource declared no loader. */
  const prepareFor = async (
    rows: readonly TRow[],
    repositories: Repositories
  ): Promise<TPrepared> =>
    descriptor.prepare === undefined
      ? (undefined as TPrepared)
      : descriptor.prepare(rows, repositories);

  return {
    type: descriptor.type,
    interactions: descriptor.interactions,
    params: descriptor.params,
    permission: descriptor.permission,

    async search(c, params, paging): Promise<Page<FhirResource>> {
      const repositories = repositoriesOf(c);
      const page = await descriptor
        .collection(repositories)
        .list(descriptor.toQuery(params, paging));
      // `toResource` may be synchronous for most resources and asynchronous
      // for the ones that resolve a child list, so the map is wrapped rather
      // than assumed to produce promises.
      const prepared = await prepareFor(page.rows, repositories);
      const rows = await Promise.all(
        page.rows.map(async (row) =>
          stampLastUpdated(row, await descriptor.toResource(row, { repositories, prepared }))
        )
      );
      return { ...page, rows };
    },

    async read(c, id): Promise<FhirResource | null> {
      const repositories = repositoriesOf(c);
      const row = await descriptor.collection(repositories).findById(id);
      if (row === null) return null;
      // A read is a page of one, and goes through the same loader: a resource
      // that only worked on search would be the kind of gap nobody notices
      // until a client fetches by id.
      const prepared = await prepareFor([row], repositories);
      return stampLastUpdated(row, await descriptor.toResource(row, { repositories, prepared }));
    },
  };
}

/**
 * Stamps `meta.lastUpdated` from the row's own `updatedAt`.
 *
 * Central rather than per-mapper, and derived rather than mapped, because it is
 * the one field on a resource that no mapper should have an opinion about: it
 * says when the record behind it last changed, and the record is the only thing
 * that knows. A mapper that forgot it would produce a resource a client cannot
 * cache, cannot reconcile against a previous copy, and cannot ask for
 * incrementally - and forgetting it is invisible, because the resource is still
 * valid FHIR.
 *
 * A row without an `updatedAt` gets no stamp rather than a fabricated one. An
 * invented timestamp is worse than a missing field: a client will believe it.
 */
function stampLastUpdated(row: unknown, resource: FhirResource): FhirResource {
  const updatedAt = (row as { updatedAt?: unknown }).updatedAt;
  if (!(updatedAt instanceof Date)) return resource;
  return {
    ...resource,
    meta: { ...resource.meta, lastUpdated: updatedAt.toISOString() },
  };
}

function repositoriesOf(c: Context<AppEnv>): Repositories {
  const repositories = c.get('repositories');
  if (repositories === undefined) {
    throw new Error(
      'FHIR route reached without tenant-bound repositories: it is mounted outside the middleware chain'
    );
  }
  return repositories;
}

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

/** What a mapper may need beyond the row itself. */
export interface ResourceContext {
  repositories: Repositories;
}

export interface FhirResourceDescriptor<TRow, TQuery extends BaseQuery> {
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
  toResource(row: TRow, context: ResourceContext): FhirResource | Promise<FhirResource>;
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

export function defineFhirResource<TRow, TQuery extends BaseQuery>(
  descriptor: FhirResourceDescriptor<TRow, TQuery>
): FhirResourceModule {
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
      const rows = await Promise.all(
        page.rows.map(async (row) => descriptor.toResource(row, { repositories }))
      );
      return { ...page, rows };
    },

    async read(c, id): Promise<FhirResource | null> {
      const repositories = repositoriesOf(c);
      const row = await descriptor.collection(repositories).findById(id);
      return row === null ? null : descriptor.toResource(row, { repositories });
    },
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

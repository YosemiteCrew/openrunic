import type { FhirResource, Interaction, SupportedResourceType } from '@openrunic/fhir';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import { assertCareRelationship } from '../middleware/policy.js';
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
  /**
   * The collection query for a search.
   *
   * Takes `repositories` and may return a promise because one parameter cannot
   * be answered from the search string alone: `PractitionerRole?specialty=` is
   * a code on the practitioner, and the rows it filters are the role
   * assignments hanging off them, so the code has to be resolved to its users
   * before the query exists. Modules that need neither ignore both.
   */
  toQuery(
    params: SearchParams,
    paging: FhirPaging,
    repositories: Repositories
  ): TQuery | Promise<TQuery>;
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
  /**
   * The patient whose chart this row belongs to, for a resource that is one.
   *
   * A module that declares it has its addressed reads gated by a care
   * relationship: holding `patient.read` says a role may open charts, not which
   * ones, and until that check existed the answer was "any of them, if you know
   * the id".
   *
   * On `read` only. A search is already narrowed by the patient compartment and
   * by the query the caller wrote, and running the check per row would be one
   * relationship lookup per result. The addressed read is the one that turns a
   * guessed id into a chart.
   */
  chartId?(row: TRow): string | undefined;
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
        .list(await descriptor.toQuery(params, paging, repositories));

      /*
       * A search that names one chart is a read wearing a search's clothes.
       *
       * Gating only the addressed read left `?_id=` and `?identifier=` as a way
       * straight past it: `GET /fhir/Patient/{id}` answered 404 and
       * `GET /fhir/Patient?_id={id}` answered 200 with the whole resource. The
       * two are the same question, so they get the same answer.
       *
       * Only these two parameters, and only for a resource that declares a
       * chart. Narrowing an ordinary search this way would break registration
       * and duplicate-checking, which look somebody up by name and birth date
       * precisely because there is no relationship yet - and #169 requires those
       * to keep working. `_id` and `identifier` are different: both address a
       * specific known record rather than looking for one.
       */
      if (descriptor.chartId !== undefined && addressesOneChart(params)) {
        for (const chartId of new Set(
          page.rows.map((row) => descriptor.chartId?.(row)).filter(isPresent)
        )) {
          await assertCareRelationship(c, chartId);
        }
      }
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
      const chartId = descriptor.chartId?.(row);
      // Before the row is mapped, so a refusal reveals nothing about it.
      if (chartId !== undefined) await assertCareRelationship(c, chartId);
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
 *
 * ## Why the later of the two, rather than the row's
 *
 * Several resources are assembled from more than one row - PractitionerRole
 * from a grant and the user it names, Claim from a claim and its lines - and
 * for those the row's own `updatedAt` is not when the resource last changed.
 * Deactivate a practitioner and the grant row does not move, so a
 * PractitionerRole whose `active` just flipped keeps its old stamp and an
 * `$export?_since=` between the two timestamps filters it out. The consumer
 * never learns the practitioner became inactive, and nothing anywhere reports
 * an error: the export succeeded and the resource was correctly excluded from
 * it by a timestamp that was wrong.
 *
 * So a projection that knows about a later change may set `meta.lastUpdated`
 * itself, and this keeps whichever is later rather than overwriting. A
 * projection that sets nothing behaves exactly as before.
 */
export function stampLastUpdated(row: unknown, resource: FhirResource): FhirResource {
  const updatedAt = (row as { updatedAt?: unknown }).updatedAt;
  if (!(updatedAt instanceof Date)) return resource;

  const stamped = updatedAt.toISOString();
  const declared = resource.meta?.lastUpdated;
  return {
    ...resource,
    meta: {
      ...resource.meta,
      lastUpdated: declared !== undefined && declared > stamped ? declared : stamped,
    },
  };
}

/**
 * Whether this search names a specific record rather than describing one.
 *
 * `_id` is an id and `identifier` is an MRN: both say "this one", which is what
 * an addressed read says. Every other parameter describes a set, and a caller
 * with no relationship to anybody still has to be able to search by name and
 * birth date - that is how a duplicate record is avoided at registration, and
 * duplicate records are their own patient-safety hazard.
 */
function addressesOneChart(params: SearchParams): boolean {
  return params._id !== undefined || params.identifier !== undefined;
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
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

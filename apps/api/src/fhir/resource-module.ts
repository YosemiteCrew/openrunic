import type { FhirResource, Interaction, SupportedResourceType } from '@openrunic/fhir';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import { assertCareRelationship } from '../middleware/policy.js';
import { chartIdOf } from '../policy/chart.js';
import type { Permission } from '../policy/permissions.js';
import type { BaseQuery, Page } from '../repositories/collection.js';
import type { CollectionKey, Repositories } from '../repositories/types.js';

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
   * The collection whose spec says which column names this row's chart.
   *
   * Declaring it gates the resource's addressed reads behind a care
   * relationship: holding `patient.read` says a role may open charts, not which
   * ones, and until that check existed the answer was "any of them, if you know
   * the id".
   *
   * A collection key rather than a `(row) => id` function, so the chart column
   * is read from the same `patientColumn` the audit trail and the compartment
   * rule already use. A hand-written accessor per module would be twenty-five
   * chances to name the wrong column, and naming the wrong one fails in the
   * quiet direction: the check runs, passes against somebody else's chart, and
   * looks like it worked.
   *
   * A row whose chart column is null is not gated, because it names no chart to
   * protect - a held appointment slot with no patient, a stock posting that is a
   * receipt rather than a dispense. Those rows carry no patient-identifiable
   * data by construction; `fhir.chart-gate.test.ts` is what checks that claim
   * stays true for every resource that has such a column.
   */
  chartFrom?: CollectionKey;
  toResource(row: TRow, context: ResourceContext<TPrepared>): FhirResource | Promise<FhirResource>;
}

/** A resource module with its row and query types erased, ready to mount. */
export interface FhirResourceModule {
  readonly type: SupportedResourceType;
  readonly interactions: readonly Interaction[];
  readonly params: readonly string[];
  readonly permission: Permission;
  /**
   * The collection this resource's chart is read from, when it has one.
   *
   * Carried onto the mounted module rather than left on the descriptor so the
   * surface is inspectable: `fhir.chart-gate.test.ts` walks every served module
   * and asserts that one naming a patient declares it. A rule that can only be
   * checked by reading the file is a rule somebody adds a resource past.
   */
  readonly chartFrom?: CollectionKey;
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
    ...(descriptor.chartFrom === undefined ? {} : { chartFrom: descriptor.chartFrom }),

    async search(c, params, paging): Promise<Page<FhirResource>> {
      const repositories = repositoriesOf(c);
      const page = await descriptor
        .collection(repositories)
        .list(await descriptor.toQuery(params, paging, repositories));

      /*
       * A search of chart data is a read of every chart it returns, so it needs
       * a relationship with every one - the same rule as the addressed read,
       * applied to whatever the query brought back.
       *
       * The gate used to fire only when the search named a chart (`patient`,
       * `_id`, `identifier`). That closed `?patient=` and `?_id=` and left the
       * widest hole of all open behind them: `GET /fhir/Condition?code=E11.9`,
       * or a bare `GET /fhir/Condition`, named no chart, skipped the gate, and -
       * because a clinical resource carries a patient compartment but no facility
       * of its own - returned every matching row in the tenant to a reader with
       * no relationship to any of them. The addressed read was refused and the
       * set-search was not, for the same row.
       *
       * So the gate now runs on the returned page for every chart resource. A
       * row that names no chart (an unfiled fax) has none to check and is
       * returned; a row that does is refused unless the reader is in that
       * patient's care, which turns a broad clinical search into a chart-scoped
       * one and leaves an inbox of unclaimed documents working.
       *
       * `Patient` is the exception, and only for a search that does not address
       * one: looking somebody up by name and birth date is how registration and
       * duplicate-checking find a chart there is no relationship with yet, and
       * #169 requires that to keep working. A `Patient` search that DOES name a
       * chart (`_id`, `identifier`) is still the addressed read wearing a
       * search's clothes, and is gated.
       */
      const isPatientResource = descriptor.type === 'Patient';
      const gateThisSearch =
        descriptor.chartFrom !== undefined && (!isPatientResource || addressesOneChart(params));
      if (gateThisSearch) {
        for (const chartId of new Set(
          page.rows.map((row) => chartOf(descriptor.chartFrom, row)).filter(isPresent)
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
      const chartId = chartOf(descriptor.chartFrom, row);
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
 * Whether this search names one chart rather than describing a set.
 *
 * `patient` is the one that matters and was the last hole in the gate. Every
 * clinical resource advertises it, and `Condition?patient=Patient/{id}` is not a
 * search at all: it is "open this chart's problem list", spelled differently.
 * Measured before it was closed: with no relationship, `GET /fhir/Patient/{id}`
 * and `GET /fhir/Condition/{id}` both answered 404 while
 * `GET /fhir/Condition?patient=Patient/{id}` answered 200 with the ICD-10
 * diagnosis. Gating the addressed read and not this is gating the door and
 * leaving the window.
 *
 * `_id` is an id and `identifier` is an MRN; both say "this one" as plainly.
 *
 * Every other parameter describes a set, and a caller with no relationship to
 * anybody still has to be able to search by name and birth date - that is how a
 * duplicate record is avoided at registration, and duplicate records are their
 * own patient-safety hazard.
 */
function addressesOneChart(params: SearchParams): boolean {
  return (
    params._id !== undefined || params.identifier !== undefined || params.patient !== undefined
  );
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}

/**
 * The chart a row belongs to, read from its collection's own spec.
 *
 * `patientOf` is the same derivation the audit trail uses, including the one
 * special case that matters: for `Patient` the chart is the row's own id rather
 * than a column, and a per-module accessor would have had to remember that.
 */
function chartOf(key: CollectionKey | undefined, row: unknown): string | undefined {
  return key === undefined ? undefined : chartIdOf(key, row);
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

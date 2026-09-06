import type { FhirResource, Interaction, SupportedResourceType } from '@openrunic/fhir';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { assertCareRelationship } from '../middleware/policy.js';
import { chartIdOf } from '../policy/chart.js';
import type { Permission } from '../policy/permissions.js';
import type { BaseQuery, Page } from '../repositories/collection.js';
import { COLLECTION_SPECS } from '../repositories/specs/index.js';
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

/**
 * The rows a module serves, when it serves fewer than its collection holds.
 *
 * Stated once, as query terms, and applied to both doors by the framework: the
 * search merges them into the query, and the addressed read re-checks them on
 * the row it loaded. A module cannot narrow one and not the other, because
 * there is only one thing to write.
 *
 * That is the whole point of it existing. Before this, a narrowing lived in an
 * ad-hoc `findById` wrapper inside `collection` AND in `toQuery` - one rule in
 * two languages, a predicate over a loaded row and a filter the repository
 * turns into SQL, with nothing relating them. It drifted twice: #265, where a
 * dispense belonging to no chart answered 404 by id and appeared in the search,
 * and the promotion review behind #257, which found the same shape on a
 * resource where only the read had been guarded.
 *
 * The read side is answered by the collection spec's own `matches`, which is
 * the row-shaped reading of the same query the search sends. That the two agree
 * is not assumed here - `repositories.port-agreement.test.ts` asserts it for
 * every spec, which is what makes deriving one door from the other honest.
 */
export interface FhirNarrowing<K extends CollectionKey> {
  /**
   * The spec whose `matches` reads the terms.
   *
   * A key rather than the spec itself, for the reason `chartFrom` is a key: it
   * is the same registry the compartment and the audit trail resolve against.
   * It is also what types `terms`, so a misspelt term is a compile error naming
   * the correction rather than a narrowing that silently selects everything -
   * which is the failure this whole mechanism would otherwise be able to have.
   * Naming the wrong spec is caught the same way, as long as the two specs'
   * queries differ in the terms used; nothing relates this key to the
   * collection `collection` actually loads from, so a spec whose query happens
   * to accept the same terms would compile. `fhir.narrowing.test.ts` covers the
   * rest of what is checkable without that link.
   */
  readonly spec: K;
  /** The terms, which win over anything `toQuery` puts in the same key. */
  readonly terms: Readonly<Partial<QueryOf<K>>>;
}

/**
 * The list query a collection spec accepts, resolved from its key.
 *
 * Read off `where`'s parameter rather than off `CollectionSpec`'s type
 * arguments: a spec is `CollectionSpec<M, TCreate, TPatch, TQuery>` and matching
 * that shape means naming three parameters this has no use for, which is three
 * chances to widen one and quietly resolve to `never`.
 */
export type QueryOf<K extends CollectionKey> = (typeof COLLECTION_SPECS)[K] extends {
  where(query: infer TQuery): unknown;
}
  ? TQuery
  : never;

export interface FhirResourceDescriptor<
  TRow,
  TQuery extends BaseQuery,
  TPrepared = undefined,
  TNarrow extends CollectionKey = CollectionKey,
> {
  readonly type: SupportedResourceType;
  readonly interactions: readonly Interaction[];
  /** Search parameters implemented, named exactly as the catalogue names them. */
  readonly params: readonly string[];
  /** The role capability required on top of the SMART scope. */
  readonly permission: Permission;
  /**
   * Markdown published for this resource in the CapabilityStatement.
   *
   * For something a conformance client has to know that the interactions and
   * search parameters cannot tell it. The statement is generated, never
   * hand-written, so this is the only place such a sentence can live without
   * drifting from what the server actually serves.
   */
  readonly documentation?: string;
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
  /**
   * Rows of the collection this module does not serve. See {@link FhirNarrowing}.
   *
   * Modules that serve everything their collection holds - most of them - omit
   * it and pay nothing.
   */
  narrow?: FhirNarrowing<TNarrow>;
  /**
   * Why this row cannot be projected, when it cannot be.
   *
   * A module reaches for this instead of throwing when the row is
   * unrepresentable rather than the request being wrong. Throwing from the
   * mapper or the loader fails the whole page, which for a search means one
   * pathological record making a chart's entire history unreadable; returning a
   * partial resource is worse still, because nothing in it says it is partial.
   *
   * Answering here lets the two interactions differ, which is the point:
   *
   * - a search returns the rows it can and an `outcome` entry carrying this
   *   string, so the client is told exactly what is missing;
   * - a read of that row answers 501 with this string, because "give me
   *   exactly that record" has no honest partial answer.
   *
   * The string is diagnostics on an `OperationOutcome` and outcomes are widely
   * logged, so it names the record and the reason and never its contents.
   *
   * NOT for a row the module does not serve, which is {@link FhirNarrowing} and
   * says nothing. The two are one step apart and the step is the wrong way: a
   * search that narrowed owes the client no account of what it excluded, or
   * every search would carry one, and an outcome entry per excluded row turns a
   * narrowing into a count of the rows behind it. This answers for a row that
   * matched and could not be represented, which is a fact about this server.
   *
   * Modules that can always project their rows omit it and pay nothing.
   */
  withheld?(row: TRow, context: ResourceContext<TPrepared>): string | undefined;
  toResource(row: TRow, context: ResourceContext<TPrepared>): FhirResource | Promise<FhirResource>;
}

/**
 * A page of projected resources, and what was left out of it.
 *
 * `withheld` is empty for every resource that does not declare
 * {@link FhirResourceDescriptor.withheld}, which is all but one of them. It is
 * carried on the page rather than thrown so the caller decides: the search
 * route turns it into `outcome` entries, and the bulk export refuses, because
 * an export that quietly omits a record is the silent-omission failure this
 * whole mechanism exists to prevent, in a format that has nowhere to say so.
 */
export interface FhirSearchPage extends Page<FhirResource> {
  readonly withheld: readonly string[];
}

/** A resource module with its row and query types erased, ready to mount. */
export interface FhirResourceModule {
  readonly type: SupportedResourceType;
  readonly interactions: readonly Interaction[];
  readonly params: readonly string[];
  readonly permission: Permission;
  /**
   * Markdown published for this resource in the CapabilityStatement.
   *
   * For something a conformance client has to know that the interactions and
   * search parameters cannot tell it. The statement is generated, never
   * hand-written, so this is the only place such a sentence can live without
   * drifting from what the server actually serves.
   */
  readonly documentation?: string;
  /**
   * The collection this resource's chart is read from, when it has one.
   *
   * Carried onto the mounted module rather than left on the descriptor so the
   * surface is inspectable: `fhir.chart-gate.test.ts` walks every served module
   * and asserts that one naming a patient declares it. A rule that can only be
   * checked by reading the file is a rule somebody adds a resource past.
   */
  readonly chartFrom?: CollectionKey;
  /**
   * The rows this module does not serve, carried onto the mounted module for
   * the same reason `chartFrom` is: a rule that can only be checked by reading
   * the file is a rule somebody adds a resource past.
   */
  readonly narrow?: FhirNarrowing<CollectionKey>;
  search(
    c: Context<AppEnv>,
    params: SearchParams,
    paging: FhirPaging,
    options?: SearchOptions
  ): Promise<FhirSearchPage>;
  read(c: Context<AppEnv>, id: string): Promise<FhirResource | null>;
}

/**
 * Options a caller passes to {@link FhirResourceModule.search}.
 *
 * `authorizedExport` skips the per-chart care-relationship gate. It is set by
 * the bulk-export path alone, which is authorised organisation-wide - the route
 * requires `facility.all`, an organisation-scoped token, and each module's
 * permission - so gating it per chart would demand the exporter have a care
 * relationship with every patient in the tenant, which no legitimate exporter
 * has and no interactive reader is ever granted. The interactive search sets
 * nothing and stays gated.
 */
export interface SearchOptions {
  readonly authorizedExport?: boolean;
}

/**
 * The query a search actually sends: what the module built, narrowed.
 *
 * The terms go last on purpose. A module that also wrote one of them into
 * `toQuery` gets the same answer, and one that wrote a conflicting one does not
 * get to widen what it declared it serves.
 */
export function narrowedQuery<TRow, TQuery extends BaseQuery, TPrepared>(
  descriptor: FhirResourceDescriptor<TRow, TQuery, TPrepared, CollectionKey>,
  query: TQuery
): TQuery {
  // The terms are typed against the spec's query and merged into the module's,
  // which are the same object at runtime and unrelated in the types. See the
  // agreement test named on `FhirNarrowing.spec`.
  return descriptor.narrow === undefined
    ? query
    : { ...query, ...(descriptor.narrow.terms as Partial<TQuery>) };
}

/**
 * Whether an addressed read may serve this row.
 *
 * `matches` is typed for a whole query and the terms are a fragment of one, so
 * the cast is the shape of the call rather than a claim about the row. It holds
 * because no spec's `matches` reads the paging or sort members - checked across
 * every spec in `repositories/specs` - and a spec that did could not answer for
 * a single row anyway.
 */
export function servesRow<TRow, TQuery extends BaseQuery, TPrepared>(
  descriptor: FhirResourceDescriptor<TRow, TQuery, TPrepared, CollectionKey>,
  row: TRow
): boolean {
  const narrow = descriptor.narrow;
  if (narrow === undefined) return true;
  const spec = COLLECTION_SPECS[narrow.spec] as {
    matches(row: unknown, query: unknown): boolean;
  };
  return spec.matches(row, narrow.terms);
}

export function defineFhirResource<
  TRow,
  TQuery extends BaseQuery,
  TPrepared = undefined,
  TNarrow extends CollectionKey = CollectionKey,
>(descriptor: FhirResourceDescriptor<TRow, TQuery, TPrepared, TNarrow>): FhirResourceModule {
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
    /* Carried through explicitly, like every other optional field here: this
       factory rebuilds the module from a named list rather than spreading the
       descriptor, so a field added to both interfaces and not to this line is
       accepted by the compiler and dropped at run time. */
    ...(descriptor.documentation === undefined ? {} : { documentation: descriptor.documentation }),
    ...(descriptor.chartFrom === undefined ? {} : { chartFrom: descriptor.chartFrom }),
    ...(descriptor.narrow === undefined ? {} : { narrow: descriptor.narrow }),

    async search(c, params, paging, options): Promise<FhirSearchPage> {
      const repositories = repositoriesOf(c);
      const page = await descriptor
        .collection(repositories)
        .list(narrowedQuery(descriptor, await descriptor.toQuery(params, paging, repositories)));

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
       * Two exceptions. `Patient`, for a search that does not address one:
       * looking somebody up by name and birth date is how registration and
       * duplicate-checking find a chart there is no relationship with yet, and
       * #169 requires that to keep working (a `Patient` search that DOES name a
       * chart by `_id` or `identifier` is still the addressed read wearing a
       * search's clothes, and is gated). And an authorised organisation-wide
       * export, which sets `authorizedExport` and is gated differently - see
       * SearchOptions - so it is not held to a per-chart relationship it could
       * never have. Every other search of chart data is gated on the page.
       */
      const isPatientResource = descriptor.type === 'Patient';
      const gateThisSearch =
        descriptor.chartFrom !== undefined &&
        options?.authorizedExport !== true &&
        (!isPatientResource || addressesOneChart(params));
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
      /*
       * A row the module cannot project leaves the page and takes its reason
       * with it, rather than failing the search for the rows that were fine.
       *
       * `total` is deliberately untouched: it is how many rows matched, and one
       * of them matching and being unrepresentable does not make it not a
       * match. The gap between `total` and what came back is exactly what the
       * outcome entry explains.
       */
      const withheld: string[] = [];
      const projectable = page.rows.filter((row) => {
        const reason = descriptor.withheld?.(row, { repositories, prepared });
        if (reason === undefined) return true;
        withheld.push(reason);
        return false;
      });
      const rows = await Promise.all(
        projectable.map(async (row) =>
          stampLastUpdated(row, await descriptor.toResource(row, { repositories, prepared }))
        )
      );
      return { ...page, rows, withheld };
    },

    async read(c, id): Promise<FhirResource | null> {
      const repositories = repositoriesOf(c);
      const row = await descriptor.collection(repositories).findById(id);
      /* The other half of the narrowing, and it answers null rather than
         refusing: a row this module does not serve is a row that does not exist
         at this address, which is what the search says about it too. */
      if (row === null || !servesRow(descriptor, row)) return null;
      const chartId = chartOf(descriptor.chartFrom, row);
      // Before the row is mapped, so a refusal reveals nothing about it.
      if (chartId !== undefined) await assertCareRelationship(c, chartId);
      // A read is a page of one, and goes through the same loader: a resource
      // that only worked on search would be the kind of gap nobody notices
      // until a client fetches by id.
      const prepared = await prepareFor([row], repositories);
      /*
       * The other half of the split. A search drops this row and says so; an
       * addressed read cannot, because the client asked for this record and
       * nothing else, and there is no honest partial answer to that.
       *
       * 501 rather than a 4xx: the request is reasonable and it is this
       * server's projection that cannot carry the record.
       */
      const reason = descriptor.withheld?.(row, { repositories, prepared });
      if (reason !== undefined) {
        throw ApiError.notImplemented(reason, { title: `${descriptor.type} cannot be projected` });
      }
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

import type { FindManyArgs, PrismaModelName, Row, ScopedRow } from './rows.js';

/**
 * One aggregate, described once and implemented twice.
 *
 * Two dozen aggregates times two storage implementations is fifty
 * hand-written repositories, and fifty hand-written repositories is fifty
 * chances to forget the tenant filter, the audit event or the tie-break on the
 * sort. So each aggregate contributes a {@link CollectionSpec} - what a new row
 * looks like, how a query narrows the table, what a patch may change - and the
 * generic in-memory and Prisma implementations read that spec. Isolation,
 * paging and auditing are written once and are therefore either right
 * everywhere or wrong everywhere, which is the only maintainable state for a
 * property this load-bearing.
 *
 * A spec deliberately cannot express "no tenant filter". The tenant, and the
 * patient compartment when the token carries one, are applied by the
 * implementations from the request scope and never by the spec.
 */

/** One page of results plus the count needed to render a pager. */
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type SortOrder = 'asc' | 'desc';

/** What every list query carries, whatever it is listing. */
export interface BaseQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: SortOrder;
}

/**
 * The read and write surface of one aggregate.
 *
 * Note the absence of a tenant parameter, here and on every method. A
 * repository is bound to one organisation at construction, so cross-tenant
 * access is not a check a handler can forget; it is an argument a handler
 * cannot supply.
 */
export interface Collection<TRow, TCreate, TPatch, TQuery extends BaseQuery> {
  list(query: TQuery): Promise<Page<TRow>>;
  /** Resolves to `null` when the id belongs to no row *in this scope*. */
  findById(id: string): Promise<TRow | null>;
  /**
   * The rows for these ids that exist in this scope, in no particular order.
   *
   * For loaders. A `prepare` hook resolving a page's references had only
   * `findById`, so it issued one read per distinct id: a page of fifty grants
   * naming fifty different practitioners was fifty reads, and a bulk-export
   * page of five hundred could put a thousand concurrent reads through a
   * connection pool sized for far fewer.
   *
   * Ids that name nothing are simply absent from the result, which is what the
   * loaders already expect - a grant can name a user that has since been
   * deleted. An empty input is an empty result and no query.
   *
   * The narrowing is `findById`'s, exactly: same tenant binding, same
   * compartment refusal, same facility hiding, and a read recorded against the
   * audit trail for every row returned. Passing many ids must not reach a row
   * that passing one would not.
   */
  findByIds(ids: readonly string[]): Promise<TRow[]>;
  create(input: TCreate): Promise<TRow>;
  update(id: string, patch: TPatch): Promise<TRow | null>;
}

/** Columns the storage layer owns; a spec never supplies them. */
export type StorageColumn = 'id' | 'tenantId' | 'createdAt' | 'updatedAt';

/** Everything else: the columns a spec is responsible for. */
export type Writable<M extends PrismaModelName> = Omit<Row<M>, StorageColumn>;

/** Ids, clock and tenant a spec needs while building rows. */
export interface RowContext {
  readonly tenantId: string;
  readonly now: Date;
  nextId(): string;
}

/**
 * Rows written alongside their parent, in the parent's transaction.
 *
 * Four aggregates are composite by nature: a claim without its lines, a report
 * without its analytes, a payment without its allocations and a remittance
 * without its service lines are all half-written records that a later reader
 * would have to guess about. Writing them together is what makes the parent's
 * totals mean something the moment it exists.
 */
export interface ChildBatch {
  readonly model: PrismaModelName;
  readonly rows: readonly Record<string, unknown>[];
}

/**
 * Types one batch of child rows against its own model.
 *
 * The batch is erased to a plain record afterwards because the parent's spec
 * cannot be generic over every child model at once; the checking that matters
 * happens here, at the call site, where the child model is a literal.
 */
export function childBatch<C extends PrismaModelName>(
  model: C,
  rows: readonly (Writable<C> & { readonly id: string })[]
): ChildBatch {
  return { model, rows: rows };
}

/** A natural key the database enforces and the API should refuse before it. */
export interface UniqueBy<M extends PrismaModelName, TCreate> {
  where(input: TCreate): FindManyArgs<M>['where'];
  matches(row: ScopedRow<M>, input: TCreate): boolean;
  message(input: TCreate): string;
}

/**
 * How an aggregate relates to a patient compartment.
 *
 * Every spec must decide, because the alternative to deciding is a default,
 * and a default here is either "leak the table to a patient-scoped token" or
 * "hide the provider directory from every portal user". `open` is for rows
 * that carry no chart and are safe for any principal to read, such as the
 * facility list. `closed` is for rows that belong to a chart only through a
 * join this layer does not perform: a compartment-restricted principal is
 * refused them wholesale rather than served a table nobody narrowed.
 */
export type CompartmentRule<M extends PrismaModelName> =
  { readonly column: keyof Row<M> & string } | 'open' | 'closed';

export interface CollectionSpec<
  M extends PrismaModelName,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
> {
  readonly model: M;
  /** Audit target type, e.g. `Encounter`. */
  readonly targetType: string;
  /** Audit action prefix; events are `<action>.created` and `<action>.updated`. */
  readonly action: string;
  /** The column naming the chart a row belongs to, when it has one. */
  readonly patientColumn?: keyof Row<NoInfer<M>> & string;
  /** The column naming the place of service, when the row is facility-scoped. */
  readonly facilityColumn?: keyof Row<NoInfer<M>> & string;
  /**
   * Narrow reads to the caller's facilities, using {@link facilityColumn}.
   *
   * Opt-in rather than implied by `facilityColumn`, which several specs declare
   * only so the audit trail can name the site a row belonged to. Turning it on
   * for all of them would change what existing routes return, and a collection
   * that should be scoped and is not needs to be visible in review rather than
   * inferred from an unrelated field.
   *
   * Rows whose facility column is null stay visible to the whole tenant. On some
   * tables null means the row is not sited at all, and filtering those out fails
   * in the harder direction to notice: an empty page reads as "nothing here"
   * rather than as a permissions problem.
   *
   * Opting in narrows every LIST of this collection, on every path, to the
   * caller's grants. It used to narrow only the FHIR paths, because the BFF
   * routes were said to decide cross-facility access for themselves - and they
   * did, for a row addressed by its id, and not at all for a list. A list names
   * no facility, so there was nothing for those routes to check and nothing
   * between a caller granted one site and every sited row in the tenant.
   *
   * What still differs by boundary is one row addressed by its id: the FHIR
   * paths hide it (404), the BFF paths load it and answer 403. That is
   * `RequestScope.hideFacilityRows`, not this flag.
   */
  readonly facilityScoped?: true;
  /**
   * Whether a row addressed by its own id may also be hidden by the facility
   * narrowing. Defaults to true; only `Patient` sets it false.
   *
   * The distinction already exists for every spec - a list is always narrowed,
   * an addressed read only when `RequestScope.hideFacilityRows` says so - and
   * this is the one collection where the answer has to differ from the scope's.
   *
   * `Patient.primaryFacilityId` is the site that registered somebody, not the
   * site an act happened at. Narrowing a LIST on it is defensible and useful: a
   * work queue should be local, and that is what keeps a site-limited caller
   * from paging through the whole practice. Refusing an addressed READ on it is
   * not, because the caller already has the id and is treating the person - and
   * a patient registered at the north clinic is standing in front of the south
   * clinic often enough that it is the ordinary case, not the edge.
   *
   * See #139 for the decision and `specs/core.ts` for the reasoning in full.
   */
  readonly facilityHidesAddressed?: false;
  /** The column naming the visit, when the row hangs off one. */
  readonly encounterColumn?: keyof Row<NoInfer<M>> & string;
  /** What a patient-scoped token may see of this aggregate. */
  readonly compartment: CompartmentRule<NoInfer<M>>;
  /**
   * The complete row a create produces, defaults included.
   *
   * Returning every column rather than only the supplied ones is what keeps
   * the two implementations honest: the in-memory store and Postgres receive
   * the same values, so a column default can never be a place where they
   * disagree. The type demands completeness, so a column added to
   * `schema.prisma` fails to compile here until someone decides what it should
   * hold.
   */
  newRow(input: TCreate, context: RowContext): Writable<NoInfer<M>>;
  /** Rows written with the parent, in the parent's transaction. */
  childRows?(
    input: NoInfer<TCreate>,
    parent: ScopedRow<NoInfer<M>>,
    context: RowContext
  ): ChildBatch[];
  /**
   * Columns a patch changes. An absent key means "not mentioned", never
   * "clear". The context carries the request's clock, so a column a patch
   * stamps as a side effect is stamped from the same instant as `updatedAt`
   * rather than from a second reading of the wall clock.
   */
  patchData(
    patch: TPatch,
    before: ScopedRow<NoInfer<M>>,
    context: RowContext
  ): Partial<Writable<NoInfer<M>>>;
  /** The in-memory filter. Must agree with {@link CollectionSpec.where}. */
  matches(row: ScopedRow<NoInfer<M>>, query: TQuery): boolean;
  /** The same filter as a Prisma `where`. Must agree with {@link CollectionSpec.matches}. */
  where(query: NoInfer<TQuery>): FindManyArgs<NoInfer<M>>['where'];
  /** The comparable the in-memory sort uses for the query's sort key. */
  sortValue(row: ScopedRow<NoInfer<M>>, sort: NoInfer<TQuery>['sort']): number | string;
  /** The same ordering as a Prisma `orderBy`, always tie-broken on id. */
  orderBy(query: NoInfer<TQuery>): FindManyArgs<NoInfer<M>>['orderBy'];
  /** Extra facts worth recording on the write event, e.g. a status transition. */
  writeMetadata?(
    row: ScopedRow<NoInfer<M>>,
    before: ScopedRow<NoInfer<M>> | null
  ): Record<string, unknown>;
  /** A natural key both implementations refuse to duplicate. */
  readonly uniqueBy?: UniqueBy<NoInfer<M>, NoInfer<TCreate>>;
}

/**
 * A JSON column's value, as a row holds it.
 *
 * The write schemas validate a JSON column as "an object of anything", which
 * is `Record<string, unknown>`, while the row type says `JsonValue`. The two
 * describe the same bytes and neither is a subtype of the other, so exactly one
 * conversion exists and it lives here rather than at twenty call sites.
 */
export function jsonColumn(value: Record<string, unknown> | undefined | null): JsonColumnValue {
  return (value ?? null) as JsonColumnValue;
}

/** What a nullable JSON column holds. */
export type JsonColumnValue = Row<'Appointment'>['recurrenceRule'];

/** Reads a JSON column back as an object, or `undefined` when it holds anything else. */
export function readJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Slices an already-filtered, already-sorted list into one page. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const offset = (page - 1) * pageSize;
  return { rows: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize };
}

/** Case-insensitive prefix match, matching the FHIR `string` search semantic. */
export function startsWithFold(value: string | null, prefix: string): boolean {
  return value !== null && value.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * A query field the caller did not send constrains nothing.
 *
 * These two exist so a spec's `matches` reads as one conjunction instead of a
 * ladder of `if (query.x !== undefined && ...) return false`. The ladder is
 * where the duplication and the complexity came from: eight fields meant eight
 * statements and eight guards, and every new filter added both.
 */
export function equalsIfSet<T>(expected: T | undefined, actual: T | null | undefined): boolean {
  return expected === undefined || actual === expected;
}

/** As `equalsIfSet`, for fields compared by a predicate rather than by identity. */
export function matchesIfSet<T>(expected: T | undefined, test: (value: T) => boolean): boolean {
  return expected === undefined || test(expected);
}

/** Case-insensitive substring match over several columns. */
/**
 * Escapes the LIKE metacharacters in a caller's search string.
 *
 * Prisma's `contains` and `startsWith` are not literal substring tests. They
 * compile to `ILIKE ('%' || $1 || '%')`, splicing the value straight into the
 * pattern, so a `%` in what the caller typed is a wildcard and a `_` matches any
 * single character. `containsFold` below, which answers the same filter in
 * memory, uses `String.includes` and treats both literally.
 *
 * That is a divergence rather than a nuisance, and it fails in the dangerous
 * direction: a search for `%` returned nothing in memory and every row the
 * caller could reach from Postgres. It is not hypothetical for `_` either -
 * stock SKUs and terminology codes carry underscores routinely, and each one
 * was quietly matching more rows than the caller asked for.
 *
 * Escaping here rather than refusing the characters at the schema keeps a
 * literal search for them possible, which for an SKU or a code is a search
 * somebody will actually want. The backslash is Postgres's default LIKE escape
 * character and Prisma emits no `ESCAPE` clause, so it is the one that applies.
 */
export function escapeLike(value: string): string {
  // The backslash goes first, or escaping the other two would double-escape
  // the backslashes this adds.
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);
}

/** A case-insensitive substring filter over a literal needle. */
export function likeContains(needle: string): {
  contains: string;
  mode: 'insensitive';
} {
  return { contains: escapeLike(needle), mode: 'insensitive' };
}

/** A case-insensitive prefix filter over a literal prefix. */
export function likeStartsWith(prefix: string): {
  startsWith: string;
  mode: 'insensitive';
} {
  return { startsWith: escapeLike(prefix), mode: 'insensitive' };
}

export function containsFold(values: readonly (string | null)[], needle: string): boolean {
  const folded = needle.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(folded) ?? false);
}

/**
 * Half-open window `[from, to)` on an instant column, either bound optional.
 *
 * A null column is outside every bounded window. An unfinished visit has no
 * end, and reporting it as inside a window it has not reached would be a lie
 * the schedule screens would then have to undo.
 */
export function inWindow(value: Date | null, from?: Date, to?: Date): boolean {
  if (value === null) return from === undefined && to === undefined;
  if (from !== undefined && value.getTime() < from.getTime()) return false;
  return to === undefined || value.getTime() < to.getTime();
}

/** The same window as a Prisma date filter, or `undefined` when unbounded. */
export function windowFilter(from?: Date, to?: Date): { gte?: Date; lt?: Date } | undefined {
  if (from === undefined && to === undefined) return undefined;
  return { ...(from === undefined ? {} : { gte: from }), ...(to === undefined ? {} : { lt: to }) };
}

/**
 * Comparable form of a value that may be an instant, a number, a string or
 * absent. Absent sorts last ascending, which is what a worklist wants: a task
 * with no due date is not the most urgent one.
 */
export function comparable(value: unknown): number | string {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  return Number.POSITIVE_INFINITY;
}

/**
 * Facts worth carrying on a write event: the state, and how it moved.
 *
 * A create records what it was created as, along with whatever else the spec
 * thinks names the row. A patch that did not move the status records nothing,
 * because "still OPEN" on every save is how an audit log becomes unreadable.
 */
export function statusMetadata(
  status: string,
  before: { status: string } | null,
  created: Record<string, unknown>
): Record<string, unknown> {
  if (before === null) return { status, ...created };
  return before.status === status ? {} : { statusFrom: before.status, statusTo: status };
}

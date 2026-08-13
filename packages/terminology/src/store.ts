import { ok, err } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { assembleExpansion, buildVerdict, rankSearchResults } from './evaluation.js';
import { clampLimit, clampOffset, conceptKey } from './ordering.js';
import {
  DEFAULT_EXPANSION_LIMIT,
  DEFAULT_MAX_EXPANSION_SIZE,
  DEFAULT_SEARCH_LIMIT,
  codeNotFound,
  expansionTooLarge,
  storeUnavailable,
  systemNotFound,
  valueSetNotFound,
} from './service.js';
import type {
  ExpandValueSetRequest,
  LookupRequest,
  SearchRequest,
  TerminologyConcept,
  TerminologyError,
  TerminologyService,
  ValidateRequest,
  ValidationVerdict,
  ValueSetExpansion,
} from './service.js';
import type { ValueSetDefinition, ValueSetRule } from './value-set.js';

/**
 * The database-backed implementation, and the port it talks to.
 *
 * This package deliberately has no dependency on Prisma, on
 * `@openrunic/database`, or on any driver. Terminology is a leaf library: it is
 * imported by the form engine, by mappers, by the API and by tests, and every
 * one of those would inherit a database client it does not want if this file
 * imported one. It would also make the interesting logic here untestable
 * without a live Postgres, which in practice means untested.
 *
 * So instead of a client, this file declares a PORT: the three read methods a
 * terminology service actually needs, with the argument shapes a Prisma model
 * delegate already accepts. In production the caller passes
 * `prisma.terminologyCode` straight in and it satisfies the port structurally,
 * with no adapter and no wrapper. In tests the caller passes a hand-written
 * fake that records every query it received, which is how the query shapes
 * below are asserted rather than assumed.
 *
 * The port takes whole rows and never sets `select`, even though the argument
 * type carries the field so a projecting wrapper can. Prisma narrows a
 * delegate's return type through `select` using generics this port cannot
 * express, and structural compatibility with a real delegate is worth more than
 * projecting away six small columns from a nine-column table. If a future
 * client's typings ever fail to line up, the fix stays a three-method object
 * literal in the composition root, not a change in here.
 *
 * Every query is tenant-scoped by construction: the tenant comes from the
 * context handed to the factory, and no request shape can influence it. The
 * shapes are also chosen to be servable by the indexes the schema already
 * carries:
 *
 *   * `lookup` filters `(tenantId, system, code)` and orders by `version`,
 *     which is exactly the `@@unique([tenantId, system, code, version])` key.
 *   * expansion filters `(tenantId, system, isActive)` and orders by
 *     `(system, display, code, version)`, sitting on the two composite indexes
 *     `[tenantId, system, isActive]` and `[tenantId, system, display]`.
 *   * search filters `(tenantId, system, display)`. A prefix query is a range
 *     scan on `[tenantId, system, display]`; the substring fill-in behind it
 *     cannot use the index and is only run when the prefix query did not fill
 *     the page, and only ever within one tenant's slice of one system.
 */

/** Sort direction, matching the client's own vocabulary. */
export type SortOrder = 'asc' | 'desc';

/** The subset of a string filter this package uses: prefix and substring, optionally case-insensitive. */
export interface TerminologyStringFilter {
  readonly contains?: string;
  readonly startsWith?: string;
  readonly mode?: 'insensitive';
}

/**
 * The where shapes this package builds. Narrower than the client's own filter
 * type on purpose: an argument type that can only express these predicates is
 * an argument type that cannot accidentally drop the tenant.
 */
export interface TerminologyCodeWhere {
  readonly tenantId?: string;
  readonly system?: string;
  readonly code?: string | { readonly in: string[] };
  readonly version?: string;
  readonly parentCode?: string | null;
  readonly isActive?: boolean;
  readonly display?: TerminologyStringFilter;
  readonly NOT?: { readonly display?: TerminologyStringFilter };
}

/** Column projection. Carried for shape fidelity with a real delegate; see the note at the top of this file. */
export interface TerminologyCodeSelect {
  readonly system?: boolean;
  readonly code?: boolean;
  readonly display?: boolean;
  readonly version?: boolean;
  readonly parentCode?: boolean;
  readonly isActive?: boolean;
  readonly properties?: boolean;
}

/** One clause of an order-by list. */
export interface TerminologyCodeOrderBy {
  readonly system?: SortOrder;
  readonly display?: SortOrder;
  readonly code?: SortOrder;
  readonly version?: SortOrder;
}

/** Arguments for {@link TerminologyCodeStore.findMany}. */
export interface TerminologyCodeFindManyArgs {
  readonly where: TerminologyCodeWhere;
  readonly select?: TerminologyCodeSelect;
  readonly orderBy?: TerminologyCodeOrderBy[];
  readonly skip?: number;
  readonly take?: number;
}

/** Arguments for {@link TerminologyCodeStore.findFirst}. */
export interface TerminologyCodeFindFirstArgs {
  readonly where: TerminologyCodeWhere;
  readonly select?: TerminologyCodeSelect;
  readonly orderBy?: TerminologyCodeOrderBy[];
}

/** Arguments for {@link TerminologyCodeStore.count}. */
export interface TerminologyCodeCountArgs {
  readonly where: TerminologyCodeWhere;
}

/**
 * One row as this package reads it. A real delegate returns `id`, `tenantId`
 * and the timestamps too; extra properties are harmless, and not naming them
 * keeps the port honest about what it uses.
 */
export interface TerminologyCodeRow {
  readonly system: string;
  readonly code: string;
  readonly display: string;
  readonly version: string;
  readonly parentCode: string | null;
  readonly isActive: boolean;
  /** `Json?` on the way out of the database, so it is `unknown` until it has been checked. */
  readonly properties: unknown;
}

/**
 * The storage port: three read methods, no writes.
 *
 * Loading content is the CLI's job and goes through `loadCodeSystem` plus an
 * ordinary `createMany`, so nothing in this package ever needs write access to
 * the table it reads.
 */
export interface TerminologyCodeStore {
  findMany(args: TerminologyCodeFindManyArgs): Promise<TerminologyCodeRow[]>;
  findFirst(args: TerminologyCodeFindFirstArgs): Promise<TerminologyCodeRow | null>;
  count(args: TerminologyCodeCountArgs): Promise<number>;
}

/** Everything the service needs that is not a query: who is asking, and what they have configured. */
export interface StoreTerminologyContext {
  /** Stamped onto every where clause. Never taken from a request. */
  readonly tenantId: string;
  /** Value-set definitions for this tenant. Configuration, not table rows: the schema has no value-set model. */
  readonly valueSets?: readonly ValueSetDefinition[];
  /** Members an expansion will materialize before refusing. Defaults to {@link DEFAULT_MAX_EXPANSION_SIZE}. */
  readonly maxExpansionSize?: number;
}

const EXPANSION_ORDER_BY: TerminologyCodeOrderBy[] = [
  { system: 'asc' },
  { display: 'asc' },
  { code: 'asc' },
  { version: 'asc' },
];

const SEARCH_ORDER_BY: TerminologyCodeOrderBy[] = [
  { display: 'asc' },
  { system: 'asc' },
  { code: 'asc' },
  { version: 'asc' },
];

/** `Json?` is `unknown` until proven otherwise; anything that is not a plain object becomes null rather than a lie. */
function toProperties(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

function toConcept(row: TerminologyCodeRow): TerminologyConcept {
  return {
    system: row.system,
    code: row.code,
    display: row.display,
    version: row.version,
    parentCode: row.parentCode,
    isActive: row.isActive,
    properties: toProperties(row.properties),
  };
}

/**
 * Builds the where clause for one value-set rule.
 *
 * Written as one function because the fast path and the general path have to
 * select identically: if they diverged, the same value set would expand
 * differently depending on how many rules it happened to have.
 */
function ruleWhere(
  tenantId: string,
  rule: ValueSetRule,
  admitsRetired: boolean
): TerminologyCodeWhere {
  return {
    tenantId,
    system: rule.system,
    ...(rule.codes === undefined ? {} : { code: { in: [...rule.codes] } }),
    ...(rule.parentCode === undefined ? {} : { parentCode: rule.parentCode }),
    ...(rule.version === undefined ? {} : { version: rule.version }),
    ...(admitsRetired ? {} : { isActive: true }),
  };
}

/**
 * Builds a service over a storage port.
 *
 * Pass `prisma.terminologyCode` in production and a recording fake in tests;
 * both satisfy {@link TerminologyCodeStore}, and the shared contract suite runs
 * against this implementation exactly as it runs against the array-backed one.
 */
export function createStoreTerminologyService(
  store: TerminologyCodeStore,
  context: StoreTerminologyContext
): TerminologyService {
  const tenantId = context.tenantId;
  const definitions = new Map(
    (context.valueSets ?? []).map((definition) => [definition.url, definition])
  );
  const maxExpansionSize = context.maxExpansionSize ?? DEFAULT_MAX_EXPANSION_SIZE;

  /**
   * Resolves one code. Ordering by version descending and taking the first row
   * makes "newest loaded release" a single index read rather than a fetch of
   * every release; the version is compared as text, which is what the column
   * holds and all this package is willing to assume about a publisher's labels.
   */
  async function resolve(
    system: string,
    code: string,
    version?: string
  ): Promise<TerminologyConcept | null> {
    const row = await store.findFirst({
      where: {
        tenantId,
        system,
        code,
        ...(version === undefined ? {} : { version }),
      },
      orderBy: [{ version: 'desc' }],
    });
    return row === null ? null : toConcept(row);
  }

  /**
   * Whether the system has any codes at all. Only asked after a lookup missed,
   * because it exists solely to tell an operator's problem (content never
   * loaded) apart from a clinician's (code typed wrong). It is an index probe
   * on `[tenantId, system, isActive]`, not a count.
   */
  async function systemIsLoaded(system: string): Promise<boolean> {
    const row = await store.findFirst({ where: { tenantId, system } });
    return row !== null;
  }

  async function lookup(
    request: LookupRequest
  ): Promise<Result<TerminologyConcept, TerminologyError>> {
    try {
      const concept = await resolve(request.system, request.code, request.version);
      if (concept !== null) {
        return ok(concept);
      }
      if (!(await systemIsLoaded(request.system))) {
        return err(systemNotFound(request.system));
      }
      return err(codeNotFound(request.system, request.code, request.version ?? null));
    } catch (cause) {
      return err(storeUnavailable(cause));
    }
  }

  async function validate(
    request: ValidateRequest
  ): Promise<Result<ValidationVerdict, TerminologyError>> {
    let definition: ValueSetDefinition | null = null;
    if (request.valueSet !== undefined) {
      definition = definitions.get(request.valueSet) ?? null;
      if (definition === null) {
        return err(valueSetNotFound(request.valueSet));
      }
    }
    try {
      const concept = await resolve(request.system, request.code, request.version);
      // Membership is a predicate over the resolved concept, so validating a
      // code against a value set never expands it, however large it is.
      const systemKnown = concept !== null || (await systemIsLoaded(request.system));
      return ok(buildVerdict({ request, concept, systemKnown, valueSet: definition }));
    } catch (cause) {
      return err(storeUnavailable(cause));
    }
  }

  /**
   * Pages a single-rule, unfiltered value set entirely in the database: one
   * count for the total, one windowed read for the page. This is the shape
   * almost every bound field has, and it is the only shape where the count and
   * the cap measure the same quantity, which is why a display filter or a
   * second rule falls through to the general path instead.
   */
  async function expandInDatabase(
    definition: ValueSetDefinition,
    rule: ValueSetRule,
    offset: number,
    limit: number
  ): Promise<Result<ValueSetExpansion, TerminologyError>> {
    const where = ruleWhere(tenantId, rule, definition.includeRetired === true);
    const total = await store.count({ where });
    if (total > maxExpansionSize) {
      return err(expansionTooLarge(definition.url, maxExpansionSize));
    }
    const rows = await store.findMany({
      where,
      orderBy: EXPANSION_ORDER_BY,
      skip: offset,
      take: limit,
    });
    return ok({ valueSet: definition.url, total, offset, concepts: rows.map(toConcept) });
  }

  /**
   * Materializes a multi-rule or filtered value set: one query per include
   * rule, merged on the schema's `(system, code, version)` identity, then
   * excluded, filtered, sorted and paged in memory. Each query takes one row
   * more than the cap allows, so an over-large value set is refused after
   * reading a bounded number of rows rather than after reading the system.
   */
  async function expandInMemory(
    definition: ValueSetDefinition,
    request: ExpandValueSetRequest,
    offset: number,
    limit: number
  ): Promise<Result<ValueSetExpansion, TerminologyError>> {
    const admitsRetired = definition.includeRetired === true;
    const members = new Map<string, TerminologyConcept>();
    for (const rule of definition.include) {
      const rows = await store.findMany({
        where: ruleWhere(tenantId, rule, admitsRetired),
        orderBy: EXPANSION_ORDER_BY,
        take: maxExpansionSize + 1,
      });
      for (const row of rows) {
        const concept = toConcept(row);
        members.set(conceptKey(concept), concept);
      }
      if (members.size > maxExpansionSize) {
        return err(expansionTooLarge(definition.url, maxExpansionSize));
      }
    }
    return ok(
      assembleExpansion(definition, [...members.values()], {
        filter: request.filter,
        offset,
        limit,
      })
    );
  }

  async function expandValueSet(
    request: ExpandValueSetRequest
  ): Promise<Result<ValueSetExpansion, TerminologyError>> {
    const definition = definitions.get(request.valueSet);
    if (definition === undefined) {
      return err(valueSetNotFound(request.valueSet));
    }
    const offset = clampOffset(request.offset);
    const limit = clampLimit(request.limit, DEFAULT_EXPANSION_LIMIT);
    const onlyRule = definition.include[0];
    try {
      if (
        onlyRule !== undefined &&
        definition.include.length === 1 &&
        (definition.exclude ?? []).length === 0 &&
        request.filter === undefined
      ) {
        return await expandInDatabase(definition, onlyRule, offset, limit);
      }
      return await expandInMemory(definition, request, offset, limit);
    } catch (cause) {
      return err(storeUnavailable(cause));
    }
  }

  async function search(
    request: SearchRequest
  ): Promise<Result<readonly TerminologyConcept[], TerminologyError>> {
    const query = request.query.trim();
    // An empty box would match every row in the tenant. Answer with nothing
    // rather than issue the scan.
    if (query === '') {
      return ok([]);
    }
    const limit = clampLimit(request.limit, DEFAULT_SEARCH_LIMIT);
    const base: TerminologyCodeWhere = {
      tenantId,
      ...(request.system === undefined ? {} : { system: request.system }),
      ...(request.includeInactive === true ? {} : { isActive: true }),
    };
    try {
      const prefixRows = await store.findMany({
        where: { ...base, display: { startsWith: query, mode: 'insensitive' } },
        orderBy: SEARCH_ORDER_BY,
        take: limit,
      });
      const rows = [...prefixRows];
      // The substring query is the expensive one, so it only runs when prefix
      // matches did not fill the page, and it excludes what the first query
      // already returned instead of de-duplicating afterwards.
      if (prefixRows.length < limit) {
        const fillRows = await store.findMany({
          where: {
            ...base,
            display: { contains: query, mode: 'insensitive' },
            NOT: { display: { startsWith: query, mode: 'insensitive' } },
          },
          orderBy: SEARCH_ORDER_BY,
          take: limit - prefixRows.length,
        });
        rows.push(...fillRows);
      }
      return ok(rankSearchResults(rows.map(toConcept), query, limit));
    } catch (cause) {
      return err(storeUnavailable(cause));
    }
  }

  return { lookup, validate, expandValueSet, search };
}

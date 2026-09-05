import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { facilityWhere } from '../repositories/prisma.js';
import { COLLECTION_SPECS } from '../repositories/specs/index.js';

/**
 * The facility narrowing, held at the level it is actually decided.
 *
 * Every route-level fix for this was a fix to one instance. The appointment list
 * checked a facility only when the caller had named one; the generic CRUD list
 * did not check at all; the FHIR PractitionerRole projection read a user's sites
 * straight out of `UserFacility`. Three routes, three holes, one cause - a
 * collection whose rows carry a facility and whose reads are not narrowed to the
 * caller's grants.
 *
 * So the rule is asserted about the data rather than about any route: a spec that
 * names a facility column is a spec whose lists are narrowed. A new aggregate
 * that declares `facilityColumn` and forgets `facilityScoped` fails here, before
 * it has a route to leak through.
 *
 * If a collection ever genuinely needs the column without the narrowing - a
 * directory of sites, say, where the column IS the subject rather than the
 * boundary - add it here with the reason. An exemption that has to be written
 * down is one somebody has to defend.
 */

/** Collections allowed to carry a facility column without narrowing reads to it. */
const EXEMPT: ReadonlySet<string> = new Set([]);

describe('every facility-sited collection narrows to the caller grants', () => {
  const sited = Object.entries(COLLECTION_SPECS).filter(
    ([, spec]) => (spec as { facilityColumn?: string }).facilityColumn !== undefined
  );

  it('finds collections to check at all', () => {
    // Guards the assertion below against a refactor that renames the field and
    // turns this whole file into a test of the empty set.
    expect(sited.length).toBeGreaterThan(5);
  });

  it.each(sited)('%s', (key, spec) => {
    if (EXEMPT.has(key)) return;
    expect(
      (spec as { facilityScoped?: true }).facilityScoped,
      `${key} names a facility column but does not narrow reads to the caller's grants`
    ).toBe(true);
  });
});

/**
 * Which columns `schema.prisma` marks optional, read from the schema itself.
 *
 * Parsed rather than read off Prisma's runtime metadata, because there is none:
 * the `prisma-client` generator emits TypeScript, the runtime `Prisma` namespace
 * carries the scalar field enums and the Decimal helpers and no `dmmf`, and the
 * generated model types erase. `repositories.port-agreement.test.ts` reaches the
 * same conclusion for the same reason and parses the same file.
 *
 * Relation fields are excluded by name: their type is another model, so they are
 * not columns a `where` can constrain.
 */
function optionalColumns(): ReadonlyMap<string, ReadonlySet<string>> {
  const schema = readFileSync(
    fileURLToPath(new URL('../../../../packages/database/prisma/schema.prisma', import.meta.url)),
    'utf8'
  );

  const blocks = new Map<string, string[]>();
  let open: string[] | undefined;
  for (const raw of schema.split('\n')) {
    const line = raw.trim();
    const header = /^model\s+(\w+)\s*\{/u.exec(line);
    if (header?.[1] !== undefined) {
      open = [];
      blocks.set(header[1], open);
      continue;
    }
    if (open !== undefined && line === '}') {
      open = undefined;
      continue;
    }
    if (open !== undefined) open.push(line);
  }

  const modelNames = new Set(blocks.keys());
  const optional = new Map<string, ReadonlySet<string>>();
  for (const [model, lines] of blocks) {
    const columns = new Set<string>();
    for (const line of lines) {
      if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = /^(\w+)\s+([A-Za-z_]\w*)(\[\])?(\?)?/u.exec(line);
      if (field?.[1] === undefined || field[4] !== '?') continue;
      if (modelNames.has(field[2] ?? '')) continue;
      columns.add(field[1]);
    }
    optional.set(model, columns);
  }
  return optional;
}

const OPTIONAL_COLUMNS = optionalColumns();

interface SitedSpec {
  readonly model: string;
  readonly facilityScoped?: true;
  readonly facilityColumn?: string;
  readonly facilityColumnOptional?: true;
}

/**
 * The narrowing has to be a query Postgres will accept, and nothing else can say so.
 *
 * The whole HTTP suite runs the memory port, whose `matches` evaluates
 * `facilityId === null` perfectly happily - so a clause filtering a REQUIRED
 * column for null is green in 3578 tests and a 500 on every list in a
 * Postgres-backed deployment, including the `Encounter` list that every
 * care-relationship check runs. That was #305, and it reached `dev`.
 *
 * The port-agreement harness cannot see it either: the facility clause is not
 * written by any spec's `where`, it is added around it, so it is in neither of
 * the two things that harness compares.
 *
 * Both directions, because neither default is safe. A flag on a required column
 * is the 500. A missing flag on a nullable one silently drops every unsited row,
 * which on `RoleAssignment` and `AuditEvent` is every row there is - a
 * permissions problem wearing an empty page's clothes, which is the failure the
 * null branch exists to prevent.
 */
describe('the facility narrowing is a query Postgres accepts', () => {
  // The field this filters on differs from the describe above deliberately, and
  // the asymmetry is load-bearing rather than untidy. `it.each` cannot fail for
  // a member that has left the list, and neither count assertion is exact, so a
  // spec that lost `facilityScoped` would simply go dark here. It cannot,
  // because it is still caught above by `facilityColumn` - and a spec that lost
  // `facilityColumn` is caught here by `facilityScoped`. Making the two filters
  // agree would close that and open the hole.
  const scoped = Object.entries(COLLECTION_SPECS).filter(
    ([, spec]) => (spec as SitedSpec).facilityScoped === true
  ) as readonly (readonly [string, SitedSpec])[];

  it('found the schema, and found the models these specs name', () => {
    // An empty or mis-parsed table would make every assertion below vacuous:
    // `optional.has(column)` is false for a column the parser never saw, so a
    // silent parse failure reads as "every column is required" and agrees with
    // a spec that has dropped its flag.
    expect(scoped.length).toBeGreaterThan(5);
    expect(OPTIONAL_COLUMNS.size).toBeGreaterThan(20);
    for (const [, spec] of scoped) {
      expect(
        OPTIONAL_COLUMNS.has(spec.model),
        `${spec.model} is not a model in schema.prisma`
      ).toBe(true);
    }
    // The parser distinguishes the two states rather than answering one of them
    // for everything: at least one facility column of each kind exists today.
    const kinds = new Set(
      scoped.map(([, spec]) => OPTIONAL_COLUMNS.get(spec.model)?.has(spec.facilityColumn ?? ''))
    );
    expect(kinds).toEqual(new Set([true, false]));
  });

  it.each(scoped)('%s declares its facility column as the schema does', (key, spec) => {
    // Named before it is used, because `?? ''` reads every question about a
    // missing column as "not nullable" and then reports that as a fact about a
    // column with no name: `patients: Patient. is required`. A spec that is
    // facilityScoped with nothing to narrow on is its own defect and says so.
    expect(
      spec.facilityColumn,
      `${key}: ${spec.model} is facilityScoped but names no facilityColumn, so there is nothing to narrow on`
    ).toBeTypeOf('string');
    const column = spec.facilityColumn ?? '';
    const nullableInSchema = OPTIONAL_COLUMNS.get(spec.model)?.has(column) === true;

    expect(
      spec.facilityColumnOptional === true,
      nullableInSchema
        ? `${key}: ${spec.model}.${column} is nullable, so facilityColumnOptional must be set or every unsited row disappears`
        : `${key}: ${spec.model}.${column} is required, so facilityColumnOptional must not be set - Prisma refuses a null filter on it`
    ).toBe(nullableInSchema);
  });

  it.each(scoped)('%s never asks Postgres for a null it cannot hold', (key, spec) => {
    const where = facilityWhere(spec, ['facility-a', 'facility-b']);
    expect(where, `${key} is facilityScoped and emitted no clause`).not.toBeNull();

    // `?? ''` is safe HERE and nowhere else in this file: `facilityWhere`
    // returns null without a column, so the assertion above has already failed
    // for the only input that could reach this line with one missing. A guard
    // here would read as a check and never run - measured by deleting it, and
    // the counts and both messages were identical with and without.
    const column = spec.facilityColumn ?? '';
    const names = JSON.stringify(where);
    const asksForNull = names.includes(`"${column}":null`);
    const nullableInSchema = OPTIONAL_COLUMNS.get(spec.model)?.has(column) === true;

    expect(
      asksForNull,
      `${key}: the emitted where ${asksForNull ? 'asks' : 'does not ask'} for ${spec.model}.${column} to be null`
    ).toBe(nullableInSchema);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { narrowedQuery, servesRow, type FhirResourceDescriptor } from '../fhir/resource-module.js';
import { SERVED_MODULES } from '../fhir/resources.js';
import { COLLECTION_SPECS } from '../repositories/specs/index.js';
import type { StockPostingListQuery } from '../repositories/specs/inventory.js';

import { DEMO_FACILITY_A, FIXED_NOW, testId } from './support.js';

/**
 * A module states its narrowing once, and both doors read the same statement.
 *
 * #265 is the defect this closes the class of: `MedicationDispense` narrowed
 * its read inside an ad-hoc `findById` wrapper and its search inside `toQuery`,
 * one rule written twice in two languages, and the two drifted - a posting
 * belonging to no chart answered 404 by id and appeared in the search bundle.
 * The promotion review behind #257 found the same shape on another resource.
 *
 * So these cases are written against `defineFhirResource` rather than against
 * `MedicationDispense`. The module below is synthetic and exists only here; a
 * fix that made today's two modules agree without making disagreement
 * unwritable would pass every test in `fhir.resources.test.ts` and fail these.
 */

/** A posting drawn against a chart: the row the narrowing admits. */
function charted(id: string): Record<string, unknown> {
  return {
    id,
    tenantId: 'tenant-a',
    kind: 'DISPENSE',
    patientId: testId(9001),
    facilityId: DEMO_FACILITY_A,
    occurredOn: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

/** The same posting drawn against ward stock: the row it excludes. */
function uncharted(id: string): Record<string, unknown> {
  return { ...charted(id), patientId: null };
}

/** A receipt: excluded by the other term, so neither term is load-bearing alone. */
function receipt(id: string): Record<string, unknown> {
  return { ...charted(id), kind: 'RECEIPT' };
}

type Descriptor = FhirResourceDescriptor<
  Record<string, unknown>,
  StockPostingListQuery,
  undefined,
  'stockPostings'
>;

const BASE_QUERY: StockPostingListQuery = {
  page: 1,
  pageSize: 25,
  sort: 'occurredOn',
  order: 'desc',
};

/**
 * Everything a descriptor needs to compile and nothing this file exercises.
 *
 * `collection`, `toResource` and the rest are never reached: the two functions
 * under test take the descriptor and a row, which is what makes a framework
 * assertion possible without a request, a token or a repository.
 */
const SKELETON = {
  type: 'MedicationDispense',
  interactions: ['read', 'search-type'],
  params: ['patient'],
  permission: 'encounter.read',
  collection: () => {
    throw new Error('not reached: these cases do not load rows');
  },
  toQuery: () => BASE_QUERY,
  toResource: () => {
    throw new Error('not reached: these cases do not project rows');
  },
} as unknown as Descriptor;

const NARROWED: Descriptor = {
  ...SKELETON,
  narrow: { spec: 'stockPostings', terms: { kind: 'DISPENSE', charted: true } },
};

/** The same module with the declaration removed, which is the mutation. */
const UNNARROWED: Descriptor = { ...SKELETON };

describe('one declaration reaches both doors', () => {
  it('keeps the excluded row out of the read', () => {
    expect(servesRow(NARROWED, uncharted(testId(9101)))).toBe(false);
    expect(servesRow(NARROWED, receipt(testId(9102)))).toBe(false);
  });

  it('keeps the served row in it', () => {
    /* The control. Without it the case above passes for a narrowing that
       serves nothing at all, which is the shape #273's own tests guarded
       against one level down. */
    expect(servesRow(NARROWED, charted(testId(9103)))).toBe(true);
  });

  it('puts the same terms in the search query', () => {
    expect(narrowedQuery(NARROWED, BASE_QUERY)).toMatchObject({
      kind: 'DISPENSE',
      charted: true,
    });
  });

  it('leaves the caller their own terms', () => {
    /* The narrowing adds; it does not replace. A search for one chart still
       searches that chart. */
    expect(narrowedQuery(NARROWED, { ...BASE_QUERY, patientId: testId(9001) })).toMatchObject({
      patientId: testId(9001),
      charted: true,
    });
  });

  it('refuses to let a module widen what it declared it serves', () => {
    /* The terms go last, so a `toQuery` that contradicts them loses. Without
       this the declaration would be a default rather than a narrowing. */
    expect(narrowedQuery(NARROWED, { ...BASE_QUERY, kind: 'RECEIPT' })).toMatchObject({
      kind: 'DISPENSE',
    });
  });

  it('removing the declaration opens both doors at once, and neither alone', () => {
    /*
     * The acceptance, stated as one case because it is one claim: there is no
     * edit to this module that closes one door and leaves the other open.
     *
     * `servesRow` and `narrowedQuery` read the same `narrow` field. Deleting it
     * turns the read permissive AND empties the query in the same step, and no
     * third place exists to write the rule in for one of them.
     */
    expect(servesRow(UNNARROWED, uncharted(testId(9104)))).toBe(true);
    expect(narrowedQuery(UNNARROWED, BASE_QUERY)).toEqual(BASE_QUERY);
  });

  it('costs a module that narrows nothing exactly nothing', () => {
    /* Acceptance 4. The query is returned unchanged - the same object, not an
       equal one - so a module without a narrowing pays no allocation and no
       behaviour. */
    expect(narrowedQuery(UNNARROWED, BASE_QUERY)).toBe(BASE_QUERY);
  });
});

describe('the declaration is answerable by the spec it names', () => {
  const narrowed = SERVED_MODULES.flatMap((module) =>
    module.narrow === undefined ? [] : [[module.type, module.narrow] as const]
  );

  it.each(narrowed)('%s', (type, narrow) => {
    /*
     * What the types cannot say.
     *
     * `terms` is typed against the named spec's query, so a wrong key is a
     * compile error whenever the two specs' queries differ in the terms used -
     * verified both ways: `kinds` for `kind` fails, and `formDefinitions` with
     * a dispense's terms fails. What compiles is a key whose query happens to
     * accept the same terms, because `collection` returns a repository rather
     * than a key and nothing relates the two.
     *
     * So this asserts the reachable half: the spec exists, it can answer, and
     * the narrowing has something in it. A declaration with empty terms narrows
     * nothing while reading as though it does.
     */
    const spec = COLLECTION_SPECS[narrow.spec] as { matches?: unknown } | undefined;
    expect(spec, `${type} narrows against a spec that does not exist`).toBeDefined();
    expect(typeof spec?.matches, `${type} names a spec with no matches`).toBe('function');
    expect(
      Object.keys(narrow.terms).length,
      `${type} declares a narrowing with no terms, which narrows nothing`
    ).toBeGreaterThan(0);
  });

  it('no module narrows a read on its own', () => {
    /*
     * The second door, made unwritable.
     *
     * `collection` returns `{ list, findById }`, so a module can still hand
     * back a hand-written `findById` that filters - which is exactly how #265
     * happened, and TypeScript cannot forbid it: structural typing accepts any
     * object of that shape, and `repositories.audit` and
     * `repositories.organisations` are outside `COLLECTION_SPECS`, so the field
     * cannot become a key instead.
     *
     * So the rule is asserted against the source. A module that needs to narrow
     * declares `narrow`; one that writes a `findById` here fails with this
     * message rather than shipping a read its search does not agree with.
     */
    const source = readFileSync(
      fileURLToPath(new URL('../fhir/resources.ts', import.meta.url)),
      'utf8'
    );

    /* An assertion derived from a file is only as good as the assertion that it
       read the right file. `resources.ts` is 1,600 lines and will be split one
       day; a smaller `resources.ts` still parses, still has no match, and this
       guard silently covers nothing. Equality rather than a floor, because the
       file being read is the file `SERVED_MODULES` is exported from - a partial
       split shows up as a mismatch instead of as a still-passing subset. */
    expect(
      (source.match(/defineFhirResource\(/g) ?? []).length,
      'fhir.narrowing.test.ts is not reading the file the served modules are ' +
        'declared in, so the rule below checks nothing'
    ).toBe(SERVED_MODULES.length);

    /* The property, not the word: `prepare` legitimately CALLS `findById` on a
       repository, and the comments above discuss it by name. Only a module
       DECLARING one is the wrapper this forbids - and a declaration is a
       property assignment OR a method shorthand, which are the same structural
       type. The lookbehind is what keeps `repository.findById(` out: matching
       the word alone would fire on every legitimate call. */
    expect(
      /(?<![.\w])findById\s*[:(]/.exec(source),
      'a module in resources.ts declares its own findById: narrowing a read ' +
        'without narrowing the search is what #265 was. Declare `narrow` instead'
    ).toBeNull();
  });
});

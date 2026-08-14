# @openrunic/terminology

Bring-your-own code systems for the Openrunic EMR: a terminology service contract, two
implementations of it, and a verifying loader for the code-system files a deployment supplies.

## This project never vendors terminology

**No terminology content ships in this repository. None. Not a sample, not a subset, not a
development fixture drawn from a real publisher.**

The code systems a clinic actually needs are licensed content. Diagnosis, procedure, laboratory,
medication and clinical-finding vocabularies variously require a paid licence, a national affiliate
agreement, or membership of a standards body, and the terms differ per country and per deployment.
A project that bundled them would be redistributing content it has no right to redistribute, and
would be making somebody else's licensing decision for them.

So the arrangement is:

1. **The deployer supplies the file.** They obtain the release under whatever licence applies to
   them, in their country, for their deployment.
2. **The loader verifies it.** A manifest names the system, the release and a content hash, and the
   loader refuses a payload that does not match the hash it was promised.
3. **The manifest records the attestation.** Who asserted that this deployment holds a valid licence
   for this content, when they asserted it, and the assertion in their own words. **A load without a
   complete attestation is refused.** The refusal is not a formality: it is the mechanism that makes
   "who decided we could load this" a record rather than an argument.

If you are contributing to this package, the rule is short: **do not add a code-system file.** See
[Bundled reference content](#bundled-reference-content) below for the one narrow exception and why
it has never been used.

## What is in the package

| Module            | What it owns                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `service.ts`      | The `TerminologyService` contract, its request and result types, and the typed error union |
| `in-memory.ts`    | `createInMemoryTerminologyService`, the array-backed implementation                        |
| `store.ts`        | The storage port and `createStoreTerminologyService`                                       |
| `value-set.ts`    | The declarative value-set model, its Zod schema and its rule predicates                    |
| `loader.ts`       | `loadCodeSystem`, the manifest schema and the attestation refusal                          |
| `content-hash.ts` | `hashCodeSystemContent`, the verifiable-load primitive                                     |
| `evaluation.ts`   | The behaviour both implementations share: verdicts, exclusions, ranking                    |
| `ordering.ts`     | The two sort keys and the paging bounds                                                    |

Nothing here depends on a database driver, a filesystem or a network. The package is a leaf library
on `@openrunic/types` and `zod`, so a mapper, a form definition, an API handler and a test can all
import it without inheriting anything.

## The service contract

Four operations, every one of them returning a `Result` rather than throwing, because every one of
them fails for reasons a clinician can cause:

- **`lookup({ system, code, version? })`** resolves one code to its display, status, parent and
  publisher properties. A missing code is a typed `code_not_found`, never `undefined`, and an
  unloaded system is a separate `system_not_found`: one is a typo, the other is an operator's
  problem, and a caller has to be able to tell them apart. With no `version` the newest loaded
  release wins; version labels are compared as opaque strings, because the column holds whatever
  the publisher used and this package will not guess whether that is semantic, a date or a serial.
- **`validate({ system, code, version?, valueSet?, allowInactive? })`** answers whether a code may
  be recorded here, and when it may not, why. The verdict is structured, not a boolean, and names
  one of `system_not_known`, `code_not_found`, `code_inactive` or `not_in_value_set`, with a
  sentence written for a clinician to read. `allowInactive` exists for historical data: a note
  written years ago legitimately cites a code the publisher has since retired, and refusing it would
  make old records unopenable.
- **`expandValueSet({ valueSet, filter?, offset?, limit? })`** materializes a page of a value set's
  members, in a defined order, with the full `total` so a picker can say "showing 20 of 340".
- **`search({ system?, query, limit?, includeInactive? })`** finds concepts by display text for a
  picker. Prefix matches rank ahead of substring matches, because a clinician who has typed three
  characters is almost always starting a word. An empty query returns nothing rather than
  everything.

The failure arm is reserved for things a clinician cannot cause: an unconfigured value set, an
expansion larger than the cap, an unreachable store.

### Ordering, paging and one honest caveat

Order is defined rather than incidental, because an expansion whose order is incidental cannot be
paged (page two would overlap page one) and a picker that reshuffles between runs is a bug nobody
can reproduce.

- Expansions sort on `(system, display, code, version)`.
- Searches sort on `(display, system, code, version)` within a match bucket, prefix bucket first.

Both keys end in `version`, which completes the `(system, code, version)` identity the schema's
unique key uses, so both are total.

The caveat: JavaScript compares strings by UTF-16 code unit and Postgres compares them under the
database collation. For the ASCII alphanumeric displays that code systems publish, the two agree.
For mixed case and punctuation under a locale-aware collation they can differ at the margins. A
deployment that needs byte-identical ordering between the two implementations should give the
`display` column the `C` collation.

Page sizes are clamped rather than rejected (`[1, MAX_PAGE_SIZE]`, offsets floored at zero): a
picker asking for zero rows or for a million is a UI mistake, and a sensible page is more useful
than an error the screen has no way to render.

## Two implementations, one contract suite

`src/test-support/contract.ts` is written once and run against both. Two implementations of one
interface are only interchangeable if something checks that they behave the same, and a suite
written twice drifts the first time somebody fixes a bug in one copy. It is also why it is safe for
tests elsewhere in the monorepo to use the array-backed service: they are exercising production
behaviour, not a convenient mock.

Everything after the fetch (verdicts, exclusions, ranking, the page cut) lives in `evaluation.ts`
and exists in exactly one copy, so the two implementations can only differ in how they read rows.

### `createInMemoryTerminologyService(codes, valueSets?, options?)`

The array-backed implementation, for tests and development. It holds concepts in a plain array and
scans it, which is the right shape at this size and keeps the reference implementation obviously
correct. Anything that needs an index belongs in Postgres.

### `createStoreTerminologyService(store, context)`

The database-backed implementation. It takes a **port**, not a client:

```ts
interface TerminologyCodeStore {
  findMany(args: TerminologyCodeFindManyArgs): Promise<TerminologyCodeRow[]>;
  findFirst(args: TerminologyCodeFindFirstArgs): Promise<TerminologyCodeRow | null>;
  count(args: TerminologyCodeCountArgs): Promise<number>;
}
```

The argument shapes are the ones a Prisma model delegate already accepts, so in production the
composition root passes `prisma.terminologyCode` straight in and it satisfies the port structurally,
with no adapter:

```ts
const terminology = createStoreTerminologyService(prisma.terminologyCode, {
  tenantId,
  valueSets: tenantValueSets,
});
```

Why a port at all:

- **The package stays storage-free.** Terminology is a leaf library imported by the form engine, by
  mappers, by the API and by tests. If this file imported a database client, all of them would
  inherit one.
- **The interesting logic stays testable.** The query shapes are the part of this implementation
  nobody else can see, and a live Postgres in the loop means, in practice, untested. The tests run
  against a hand-written store that records every query and then assert on them: that each clause
  carries the tenant, that a single-rule value set pages in the database rather than in memory, that
  the expensive substring search only runs when the cheap prefix search did not fill the page.
- **Three read methods, no writes.** Loading content goes through `loadCodeSystem` and an ordinary
  insert, so nothing here needs write access to the table it reads.

The port takes whole rows and never sets `select`, although the argument type carries the field so a
projecting wrapper can. Prisma narrows a delegate's return type through `select` using generics the
port cannot express, and structural compatibility with a real delegate is worth more than projecting
away a few small columns. If a future client's typings do not line up, the fix is a three-method
object literal in the composition root, not a change in this package.

### Tenant scoping and index alignment

The tenant comes from the context handed to the factory and is stamped onto every where clause; no
request shape can influence it. The query shapes are chosen to be servable by the indexes
`TerminologyCode` already carries:

| Operation         | Where                                                               | Index                                                            |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lookup`          | `(tenantId, system, code)`, ordered by `version`                    | `@@unique([tenantId, system, code, version])`                    |
| expansion         | `(tenantId, system, isActive)`, ordered by `(system, display, ...)` | `[tenantId, system, isActive]` and `[tenantId, system, display]` |
| search, prefix    | `(tenantId, system, display startsWith)`                            | `[tenantId, system, display]` (range scan)                       |
| search, substring | same, minus what the prefix query already returned                  | not index-servable; runs only when the prefix page was short     |

A search without a `system` is a tenant-wide scan, so scope it whenever the caller knows the system.

Expansion takes one of two paths. A value set with a single include rule, no exclusions and no
display filter is paged entirely in the database: one `count` for the total, one windowed read for
the page. That is the shape almost every bound field has. Anything else issues one query per include
rule, merges on the `(system, code, version)` identity, and applies exclusions, filtering, sorting
and paging in memory. Both paths refuse an expansion larger than `maxExpansionSize` (default 10,000)
rather than serving a picker fifty thousand rows.

Validation never expands anything: membership is a predicate over the resolved concept, so checking
one code against a value set costs one pass over its rules whatever the size of the systems behind
them.

## Value sets are data

A value set is a small JSON document a deployment stores with its other configuration, never code.
That matters more here than almost anywhere else in the product: "which diagnoses may this order
form take" is a clinical decision made by the practice, and a practice cannot deploy a TypeScript
function. Keeping the model declarative also means a definition can be validated before it is saved,
diffed between environments, and evaluated against a single concept without expanding anything.

```ts
const definition: ValueSetDefinition = {
  url: 'http://example.invalid/vs/intake-problems',
  name: 'Intake problems',
  include: [
    { system: 'http://example.invalid/fs/demo-problems', parentCode: 'PB-100' },
    { system: 'http://example.invalid/fs/demo-problems', codes: ['PB-200', 'PB-210'] },
  ],
  exclude: [{ system: 'http://example.invalid/fs/demo-problems', codes: ['PB-201'] }],
};
```

A rule names a `system` and then narrows it: `codes` for an explicit member list, `parentCode` for
the children of one heading, `version` to pin one loaded release. A rule with only a system takes
the whole system. A concept is a candidate if any include rule selects it, and out if any exclude
rule does.

`parentCode` matches the publisher's parent link exactly, which is one level of hierarchy and not a
transitive descendant walk. That limit is deliberate: a descendant walk needs a recursive query, the
narrow store port does not expose one, and a value set built from a recursive walk would silently
change shape whenever a publisher reorganizes its hierarchy. Deeper selections are written as more
rules.

Retired codes are left out of an expansion unless the definition sets `includeRetired`, which exists
for sets whose whole job is to describe historical data.

Definitions that arrive from configuration should go through `parseValueSetDefinition`, which
validates them with Zod and returns a `Result`. Unknown keys are rejected rather than ignored: a
misspelled `parentcode` that silently widened a value set to an entire code system would be
discovered by a clinician, not by an operator.

## The loader

```ts
const result = loadCodeSystem({ manifest, content, format: 'ndjson' });
if (result.ok) {
  await prisma.terminologyCode.createMany({
    data: result.value.rows.map((row) => ({ id: uuidv7(), tenantId, ...row })),
  });
}
```

`loadCodeSystem` is synchronous and free of IO by construction. It takes the file's **content** as a
string and never opens a file, which keeps a leaf library away from the filesystem and makes every
failure case testable with a string literal. Reading the file is the CLI's job;
`CodeSystemContentReader` is the seam it fills.

Checks run in the order a sceptic would run them, and the first failure stops the load. Nothing is
partially applied, because half a code system is worse than none:

1. Is the manifest a manifest? (`invalid_manifest`)
2. Did somebody attest to the licence? (`missing_attestation`)
3. Is this the file the manifest describes? (`content_hash_mismatch`)
4. Did it contain anything? (`empty_content`)
5. Does every row parse? (`invalid_rows`, with a line number and a reason per row)
6. Is that as many rows as were promised? (`row_count_mismatch`)

### The manifest

```json
{
  "systemUri": "http://example.invalid/fs/demo-codes",
  "systemVersion": "2026-01",
  "sourceName": "demo-codes 2026-01 export",
  "sourceReleaseDate": "2026-01-15",
  "contentHash": "sha256:...",
  "rowCount": 4821,
  "attestation": {
    "attestedBy": "Testina Patientsson",
    "attestedRole": "Practice manager",
    "attestedAt": "2026-08-13T09:00:00Z",
    "licenceHeld": true,
    "licenceStatement": "This practice holds a current licence permitting use of this content in this deployment.",
    "licenceReference": "AGREEMENT-0001"
  }
}
```

Every field answers a question somebody asks later. `systemUri` and `systemVersion`: which system,
which release? A code means nothing without both, and a second load has to be able to supersede the
first rather than collide with it. `sourceName` and `sourceReleaseDate`: where did this come from?
`contentHash`: is this the file the manifest describes? `rowCount`: was it truncated?

`attestation` is the point of the whole module. `licenceHeld` is a boolean with exactly one
acceptable value, which is how a deployer says yes deliberately: there is no default, no absent
field that means consent, and nothing for a template to fill in silently. `licenceStatement` is the
assertion in their own words, so the record is readable years later. Validate a manifest with
`codeSystemManifestSchema` before reading a payload that might be very large.

The hash covers the payload exactly as delivered: no trimming, no line-ending translation, no
sorting. A deployer can reproduce it with `shasum -a 256 file`, which prints the bare hex that
`sha256:` prefixes. The algorithm travels with the digest so that moving off SHA-256 later is a
change to data, not a silent reinterpretation of every manifest ever written.

### Payload formats

Both formats produce the same normalized rows, ready to insert into `TerminologyCode` once the
caller adds an `id` and a `tenantId`.

**`ndjson`**: one JSON object per line, keys `code`, `display` (required) and `system`, `version`,
`parentCode`, `isActive`, `properties` (optional). Unknown keys are rejected rather than dropped, so
a typo is caught rather than silently losing a column.

**`tsv`**: tab-separated, no quoting, no escaping, in this fixed column order:

```text
system    code    display    version    parentCode    isActive
```

That is what a spreadsheet export and a `psql \copy` both produce and what a deployer can inspect
with `less`. The trade is that a display containing a tab or a newline cannot be represented; such a
file has to use `ndjson`. A first line that is exactly the column names is treated as a header and
skipped. `isActive` accepts `true`, `false`, `1`, `0` or an empty cell (which means active), and
`properties` is not representable.

In both formats, `system` and `version` may be left out, in which case the row inherits the
manifest's values. If they are present they must agree with the manifest: one file loads one release
of one system, and a row saying otherwise means two exports were concatenated, which would put half
a system's codes under a URI where nothing will ever find them.

Duplicate `(system, code, version)` rows are caught in the loader rather than by the database, so
the deployer gets a line number instead of a constraint violation halfway through an insert.
Reporting stops after 50 row problems: a malformed export usually has one problem repeated on every
line, and fifty examples is enough to diagnose it.

## Bundled reference content

**None. Deliberately, and this is the correct outcome rather than an omission.**

The bar for including anything would be a licence that unambiguously permits redistribution, in
every jurisdiction Openrunic is deployed in, without an agreement between the publisher and the
deployer. Almost every clinically useful code system fails that bar: the ones that are free to read
are frequently not free to redistribute, the ones that are free to redistribute in one country
require an affiliate agreement in another, and terms change between releases. When the answer is not
obviously yes, it is no.

Shipping nothing also avoids a subtler failure. A bundled "development subset" becomes a production
dependency within a release or two, someone builds a value set against it, and the project has
quietly taken on redistribution of content it never examined the licence for. There is no partial
version of this decision that stays partial.

If a future contributor is certain that a specific file is freely redistributable, its licence must
be stated in full in the file header, and the reasoning must be in the pull request. Anything less
does not merge. The development path in the meantime is `createInMemoryTerminologyService` with
invented codes: `src/test-support/fixture.ts` is exactly that, and every system URI in it is under
`example.invalid`, a domain reserved so that it can never resolve.

## Commands

```bash
pnpm --filter @openrunic/terminology test        # vitest with coverage thresholds
pnpm --filter @openrunic/terminology type-check
pnpm --filter @openrunic/terminology lint
```

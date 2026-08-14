# packages/fhir

FHIR R4 types and the mappers between them and this project's own domain shapes.

Read `docs/adr/0002-relational-postgres-fhir-boundary.md` before touching anything here. Its
decision governs this package entirely: **Postgres is the source of truth and FHIR is a boundary
format**. Nothing in the database is stored as a FHIR resource, and no mapper may push a FHIR-shaped
concern inward. If a change here needs a new column, that column belongs to the domain model on its
own merits, not because a resource has a field.

## Every mapper needs a round-trip test

Not "should". A mapper without one is an incomplete change, and the review will say so.

The test converts domain to FHIR and back, and asserts nothing was lost. When a field genuinely
cannot survive the trip, the test must name it, so the loss is a decision on the record rather than
a surprise found later by whoever is debugging a chart that lost a field. `fhir.test.ts` calls this
out explicitly: `names exactly the fields the round trip drops`.

## US Core must-support is the part that breaks quietly

A missing must-support element does not throw. It produces a resource that validates, renders, and
is wrong: race and ethnicity extensions, birth sex, the identifier system, the assigner. This
project has already shipped that bug once, in a duplicate Patient mapper that silently dropped the
US Core extensions.

So when you change a mapper:

- Run the round-trip suite and read which fields it reports as dropped. If that list grew, you
  removed something.
- The shared mapper is the one that knows about US Core. Do not write a second, local mapper for a
  resource that already has one; consolidate instead.

## Terminology never lives here

Code systems are licence-restricted and are never committed to this repository. A mapper carries a
system URI as a plain string and nothing else. `http://loinc.org` and similar are canonical
identifiers, not links to fetch: leave them as `http://`, because that is the identifier's actual
spelling, and Sonar's S5332 exclusion for them is already recorded with that reasoning.

## Watch for super-linear regular expressions

Five have been found in this repository so far, one of them in this package's `primitives.ts`. The
shape to avoid is a quantified class followed by a delimiter the class can also match, so the engine
can distribute input between them and backtrack. Parsing a value that arrived inside a FHIR resource
from another system is parsing untrusted input, whatever the resource claims about itself.

```bash
pnpm --filter @openrunic/fhir test
pnpm --filter @openrunic/fhir type-check
```

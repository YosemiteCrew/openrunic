# apps/api

Hono. The FHIR R4 boundary and the BFF the two apps call.

## Identity comes from the token, never from the body

This is the rule with the sharpest failure mode, and it has already been broken once here.

The sign routes take the signer from the verified principal. An addendum route once took `authorId`
from the request body, and the client obligingly sent the original note's author, so a correction
written by one clinician against another's signed note was stored under the other clinician's name,
permanently, on a locked clinical record. Nothing failed. The record was simply false.

So: any field naming _who did this_ is derived from the principal. If a request body carries one,
the schema refuses the request rather than ignoring the field, because ignoring it silently is how
a caller comes to believe it was honoured.

## Tenant isolation is structural

Repositories are bound to a scope and take no tenant argument. There is no call you can write that
asks for another practice's data, which is a stronger guarantee than remembering to filter.

A compartment-restricted principal reading a model with no chart column is refused outright rather
than served an unsatisfiable filter: a query that cannot return a row should not reach Postgres.

Answer **404, not 403**, for a row outside the caller's scope. A 403 confirms the row exists, which
turns the API into an enumeration oracle for patient identifiers.

Row-level security in `packages/database` sits underneath all of this as the second line. Neither
layer is a reason to relax the other.

## The audit chain

Events are hash-chained: `seq`, `prevHash`, `hash`, with timestamps deliberately outside the hash.
The API can read the log and verify it, and cannot write to it through any endpoint. An endpoint
that could insert an audit event would let an actor forge their own alibi.

Verification reports the first break by sequence number, which is where tampering began rather than
where it was noticed.

## Filters are spelled out

Identity lookups use `{ id: { equals: id } }` rather than the `{ id }` shorthand. They are
equivalent only while the value is a scalar: hand Prisma an object and the keys become filter
operators, so a value arriving as `{ not: '' }` would select every row instead of none. Every route
parses its id with `z.uuid()` first, so this is not reachable today, and the explicit form is what
keeps it unreachable when a future caller arrives from somewhere else.

## FHIR lives at the edge

Read `docs/adr/0002`. Resources are produced at the boundary from relational rows; they are never
what is stored. `packages/fhir` owns the mappers and its own rules about them.

```bash
pnpm --filter api test
pnpm --filter api type-check
pnpm turbo run build --filter=api
```

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

## One `where` key, one clause

A spec's `where` is built from conditional spreads, so two parameters constraining the same column
write the same key and the later spread wins at construction. The earlier clause does not conflict,
it disappears, and the query runs happily without it.

`matches`, answering the same filter in memory, tests both conditions independently. So the two ports
return different rows, and only when the two parameters disagree - which is why this survives review.
It also survives the test suite: every HTTP test runs against the memory registry, where `matches`
decides, so the port that is wrong is the one nothing exercises.

It has gone wrong four times: `Claim.status`/`statuses`, `RoleAssignment.userId`/`userIds`,
`ClaimLine.claimId`/`claimIds`, and `Referral.status`/`openOnly`, which shipped and returned the whole
outstanding-referral tray to a caller who had asked for one status inside it.

Resolve the parameters into one clause through a single function, so both ports read one decision:

```ts
function referralStatuses(query: ReferralListQuery): readonly ReferralStatus[] | undefined {
  const open = query.openOnly === true ? OPEN_REFERRAL_STATUSES : undefined;
  const { status } = query;
  if (open === undefined) return status === undefined ? undefined : [status];
  if (status === undefined) return open;
  return open.includes(status) ? [status] : [];
}
```

`undefined` means no filter. An empty array means one that matches nothing, which is the honest answer
to an impossible intersection - dropping the clause instead would widen the query to every row.

`repositories.port-agreement.test.ts` asserts the two ports agree for every spec, including with a
colliding pair deliberately in conflict, and the query table it drives from fails to compile when a
spec or a filter parameter is added. That is the guard; this section is why it exists.

## FHIR lives at the edge

Read `docs/adr/0002`. Resources are produced at the boundary from relational rows; they are never
what is stored. `packages/fhir` owns the mappers and its own rules about them.

```bash
pnpm --filter api test
pnpm --filter api type-check
pnpm turbo run build --filter=api
```

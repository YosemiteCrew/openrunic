# api

The openrunic API: a [Hono](https://hono.dev) server carrying two surfaces.

- **`/fhir`** is the public contract. FHIR R4, stable, versioned by FHIR itself, and the surface
  third parties build against.
- **`/bff/v0`** is the internal surface behind the web and portal apps. Explicitly unstable: it
  changes with the screens it serves. There is deliberately no second proprietary public API.

## Layout

```text
src/
  app.ts             createApp(): wires the chain, the routers and the one error boundary
  middleware/        the chain, in the order the plan fixes (see below)
  routes/            internal REST, one router per aggregate, mounted from one line each
  fhir/              the FHIR R4 boundary: registry, CapabilityStatement, mappers, search
  repositories/      data access behind an interface: in-memory for tests, Prisma at runtime
  audit/             request-scoped collector; batched reads, in-transaction writes
  policy/            the permission catalogue and the role bundles
  schemas/           request and response contracts, in zod
  openapi/           the spec, generated from those same zod contracts
  http/              the two error representations and the validation helpers
```

## The middleware chain

The order is law (implementation plan section 4.1), and `buildMiddlewareChain` returns it as data
so the suite asserts it directly:

| #   | Stage          | Sets                                         |
| --- | -------------- | -------------------------------------------- |
| 1   | `request-id`   | correlation id, error representation         |
| 2   | `authn`        | the principal, from a bearer token           |
| 3   | `tenant-scope` | the organisation, from the principal alone   |
| 4   | `policy`       | the permission set and facility grants       |
| 5   | `audit`        | the collector, and tenant-bound repositories |

Each stage depends on the one before it and on nothing after it. Authentication before scope means
a tenant can never come from an unverified request; scope before policy means a role is always
evaluated inside an organisation; policy before audit means a denial has somewhere to be recorded.

## Endpoints

| Route                                                             | Purpose                                          |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `GET /healthz`                                                    | Liveness probe (public)                          |
| `GET /openapi.json`                                               | OpenAPI 3.1 for `/bff/v0`, generated from zod    |
| `GET /fhir/metadata`                                              | CapabilityStatement, generated from the registry |
| `GET /fhir/Patient`                                               | Search, returning a `searchset` Bundle           |
| `GET /fhir/Patient/{id}`                                          | Read                                             |
| `POST /fhir/Patient`                                              | Create                                           |
| `GET /bff/v0/patients`                                            | Search with pagination                           |
| `POST /bff/v0/patients`                                           | Register                                         |
| `GET /bff/v0/patients/{id}`                                       | Read                                             |
| `PATCH /bff/v0/patients/{id}`                                     | Amend                                            |
| `GET /bff/v0/appointments`                                        | Schedule day view and Flow Board                 |
| `POST /bff/v0/appointments`                                       | Book                                             |
| `GET /bff/v0/appointments/{id}`                                   | Read                                             |
| `PATCH /bff/v0/appointments/{id}`                                 | Reschedule, re-room or advance                   |
| `/bff/v0/{encounters,orders,results,claims,payments,tasks,forms}` | Reserved: 501, behind the real permissions       |

The reserved aggregates run the full middleware chain and their real permission check, so an
unauthenticated caller still gets 401 and a caller with the wrong role still gets 403 and an audit
record. Only a caller who would have been allowed sees 501.

## Error contracts

One `ApiError` renders two ways, chosen by path so that failures raised before a handler is
reached still come back in the right shape:

- `/fhir/*` answers a FHIR `OperationOutcome` (`application/fhir+json`).
- Everything else answers an RFC 9457 problem document (`application/problem+json`) carrying the
  request id and, on a validation failure, one entry per offending field.

Statuses: 400 malformed (bad query, unsupported search parameter, unparseable body), 401
unauthenticated, 403 forbidden, 404 not found, 409 conflict, 422 understood but invalid, 501 not
implemented.

## Testing

Every test drives the real app through `app.request()` against the in-memory repository, so the
suite needs no database and nothing is green because a stub said yes. Cross-tenant isolation is
tested with both organisations' rows in one store: if the scoping came out, they would leak.

## Commands

```sh
pnpm dev        # tsx watch mode on src/index.ts
pnpm build      # compile to dist/
pnpm start      # run the compiled server
pnpm test       # vitest with istanbul coverage
pnpm lint       # eslint (type-checked)
pnpm type-check # tsc --noEmit
```

## Configuration

Environment variables are validated at startup (`src/env.ts`):

- `PORT` - listen port, default `4000`
- `NODE_ENV` - `development` (default) | `test` | `production`

Under `NODE_ENV=production`, `createApp` refuses to start without an explicit `repositories`,
`principalResolver` and `auditSink`. The defaults are an in-memory store and a table of public demo
tokens, and a convenience default that survives into production is how a demo token becomes a
credential.

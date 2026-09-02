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
  routes/            internal REST, one router per workstream, mounted from one line each
  routes/crud.ts     list, read, create and amend, written once and configured per aggregate
  fhir/              the FHIR R4 boundary: served resources, CapabilityStatement, projections
  repositories/      data access behind an interface: in-memory for tests, Prisma at runtime
  repositories/specs one CollectionSpec per aggregate; both implementations read it
  auth/              the principal, the OIDC verifier, the JWKS cache, SMART scope parsing
  audit/             request-scoped collector, the per-tenant hash chain and its verifier
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

`GET /healthz` and `GET /openapi.json` are public. Everything else needs a bearer token.

### The FHIR boundary

`GET /fhir/metadata` publishes the CapabilityStatement, generated from the mounted resource
modules. Twenty-six resource types are served with `read` and `search-type`; `Patient` also accepts
`create`.

Only `Observation` and `Claim` advertise `status`, and they arrive there by different routes.

`Observation` takes the lossless route: its domain enum and the FHIR value set agree one for one, so
the parameter is a plain scalar filter. Where a mapping loses states - the schedule has a code for
"roomed" and R4 does not - the parameter is left out rather than answered with a filter that
silently matches one collapsed state and misses the rest. `losslessStatus` in `resources.ts` decides
that per resource from the mapping itself, which is why those absences are visible here rather than
buried in a half-working filter.

`Claim` takes the other route. `CLAIM_STATUS` collapses ten domain states into three FHIR codes, so
a scalar filter would be exactly the half-working kind: `status=active` covers seven of the ten, and
answering it with one of them would look like a working search returning almost nothing. Instead
`statusTokens` resolves the FHIR code to the whole set of domain states it stands for, and the
collection filters on the set. `status=active` returns every submitted, acknowledged, rejected,
denied, paid, partial and rebilled claim.

A FHIR code no domain state maps to is refused rather than answered with an empty bundle, which is
how `Observation` already behaves for `status=unknown`. For `Claim` that code is `entered-in-error`:
it is inside R4's value set and this server has no state for it, so it is a 400 rather than a
truthful-looking "no claims". The domain names are no longer accepted through this parameter;
`/claims?status=SUBMITTED` on the collection endpoint is where they belong.

| Resource                | Search parameters implemented                                         |
| ----------------------- | --------------------------------------------------------------------- |
| `Patient`               | `_id`, `identifier`, `name`, `family`, `given`, `birthdate`, `gender` |
| `Practitioner`          | `name`                                                                |
| `PractitionerRole`      | `practitioner`, `specialty`                                           |
| `Organization`          | `name`                                                                |
| `Location`              | `name`                                                                |
| `Coverage`              | `patient`                                                             |
| `RelatedPerson`         | `patient`                                                             |
| `MedicationDispense`    | `patient`                                                             |
| `Questionnaire`         | `name`                                                                |
| `QuestionnaireResponse` | `patient`                                                             |
| `Appointment`           | `_id`, `patient`, `date`, `practitioner`, `location`                  |
| `Encounter`             | `patient`, `date`                                                     |
| `Condition`             | `patient`, `code`                                                     |
| `MedicationRequest`     | `patient`, `encounter`                                                |
| `MedicationStatement`   | `patient`                                                             |
| `AllergyIntolerance`    | `patient`                                                             |
| `Immunization`          | `patient`, `date`                                                     |
| `Observation`           | `patient`, `code`, `date`, `status`                                   |
| `DiagnosticReport`      | `patient`, `date`                                                     |
| `ServiceRequest`        | `patient`, `authored`                                                 |
| `ImagingStudy`          | `patient`, `accession`, `date`                                        |
| `Specimen`              | `patient`, `accession`                                                |
| `DocumentReference`     | `patient`, `category`, `date`                                         |
| `Task`                  | `patient`                                                             |
| `Provenance`            | `target`, `recorded`, `agent`                                         |
| `Claim`                 | `patient`, `status`, `created`                                        |

Every resource also accepts `_count` and `_offset`; a parameter that is not listed is refused with
a `not-supported` OperationOutcome rather than ignored. `fhir.conformance.test.ts` reads the
published statement and makes the request each claim implies, so the table above cannot drift from
the router in either direction.

`Organization` is served, and returns exactly one row: the caller's own practice. `Organisation` is
the only model in the schema with no `tenantId` column, because it is the tenant - its id is what
every other row's `tenantId` points at - so the narrowing is on the primary key and a read of any
other id is a 404 rather than a 403. `address` and `identifier` are must-support and unimplemented:
the columns do not exist, because the practice's postal address and NPI live on `Facility`, which is
what `Location` serves.

That makes the references pointing at the tenant resolve: `PractitionerRole.organization`,
`Location.managingOrganization`, and `Claim.provider` when the claim's encounter is unreadable and
the practice is the truthful biller. `Claim.provider` carries its own type for that reason - R4
allows Practitioner or Organization there, and naming the practice as a Practitioner shipped a
reference to somebody who does not exist.

Two references still do not resolve, and for a different reason: `Coverage.payor` and
`Claim.insurer` point at `Payer` rows, a separate table this server does not project as
`Organization`. Whether it should is a real design question - two row types through one resource,
sharing one id space - and it is not answered yet.

### The internal surface

160 documented operations under `/bff/v0`, every one of them in `/openapi.json`.

| Aggregate     | Path                                                    | Beyond list, read, create and amend                                                             |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Patients      | `/patients`                                             |                                                                                                 |
| Appointments  | `/appointments`                                         |                                                                                                 |
| Encounters    | `/encounters`                                           | `POST {id}/sign`                                                                                |
| Notes         | `/notes`                                                | `POST {id}/sign`, `GET`/`POST {id}/addenda`                                                     |
| Problems      | `/problems`                                             |                                                                                                 |
| Medications   | `/medications/statements`, `/medications/prescriptions` | `POST {id}/sign`, `/transmit`, `/cancel`                                                        |
| Allergies     | `/allergies`                                            |                                                                                                 |
| Immunisations | `/immunisations`                                        |                                                                                                 |
| Observations  | `/observations`                                         | the vitals flowsheet is `patientId` + `category=VITAL_SIGNS` + a window                         |
| Orders        | `/orders`, `/specimens`                                 | `POST orders/{id}/sign`, `/transmit`, `/cancel`; `POST specimens/{id}/receive`, `/reject`       |
| Results       | `/results`                                              | `POST {id}/review`, `GET {id}/observations`                                                     |
| Documents     | `/documents`                                            | `POST {id}/file`                                                                                |
| Tasks         | `/tasks`                                                | `POST {id}/complete`, `/cancel`                                                                 |
| Messages      | `/messages/threads`                                     | `POST {id}/close`, `GET`/`POST {id}/messages`, `POST /messages/{id}/read`                       |
| Coverage      | `/coverage`                                             | `POST {id}/eligibility`                                                                         |
| Charges       | `/charges`                                              | `POST {id}/void`                                                                                |
| Claims        | `/claims`                                               | `POST {id}/scrub`, `/submit`, `/status`; `GET {id}/lines`, `{id}/history`                       |
| Payments      | `/payments`                                             | `POST {id}/post`, `/void`, `/refund`; `GET {id}/allocations`                                    |
| Remittances   | `/remittances`                                          | `POST {id}/parse`, `/post`; `GET {id}/lines`                                                    |
| Statements    | `/statements`                                           | `POST {id}/generate`, `/send`                                                                   |
| Forms         | `/forms/definitions`, `/forms/submissions`              | `POST definitions/{id}/publish`, `/retire`; `POST submissions/{id}/complete`, `/sign`, `/amend` |
| Users         | `/users`                                                | `GET`/`POST {id}/roles`                                                                         |
| Roles         | `/roles`                                                |                                                                                                 |
| Facilities    | `/facilities`                                           |                                                                                                 |
| Terminology   | `/terminology`                                          | `GET /terminology/lookup?system=&code=`                                                         |
| Audit         | `/audit`                                                | read only: `GET /audit`, `/audit/{id}`, `/audit/verify`                                         |

There is deliberately no create or update on the audit log. An endpoint that could insert an audit
event would let an actor forge their own alibi.

### State transitions

A transition is a route of its own rather than a status field on a patch, and each aggregate's
allowed moves are a table next to the handler that enforces them. A refused move is a typed 409
`invalid-transition` naming the state the record is in and the states it could reach, so a screen
can re-render its buttons instead of retrying a request that will never succeed. Nothing is ever
deleted: a correction is a transition to `ENTERED_IN_ERROR`, `VOIDED` or `CANCELLED`.

## Authorisation

Three checks, and they answer different questions.

- **The role permission** says what the principal may do. Every route declares one, and
  `openapi.test.ts` fails if any operation does not.
- **The facility grant** says where. Facility-scoped aggregates check it before a write reaches
  the database, not after.
- **The SMART scope** says what the _application_ was authorised to ask for on the principal's
  behalf. It is checked at the FHIR boundary only, because that is the only surface tokens are
  issued against, and it is checked in addition to the permission: an app holding
  `user/Patient.write` on behalf of a read-only clerk is still refused.

A token whose scope resolves to the `patient` compartment carries a launch context, and that
context is handed to the repository registry rather than to the handlers. Every repository the
request touches is bound to that one chart, so "a patient can only ever read their own record" is
a property of the objects a handler is given and not a check a handler has to remember. Aggregates
that reach a chart only through a join are refused wholesale to such a principal rather than
served unnarrowed.

## The audit trail

Reads are buffered in a request-scoped collector and flushed after the response as one event
listing every record touched; a chart review must not pay a database round trip per row, and a
slow-by-default audit log is how audit logging ends up switched off. Writes are persisted in the
same transaction as the mutation they describe, because a mutation that commits without its audit
row is a hash chain that lies.

Every event joins a per-tenant hash chain: `seq` is contiguous from 1, `prevHash` is the previous
event's `hash`, and `hash` is `sha256(prevHash + "\n" + canonicalJson(payload))` over a
canonicalisation that sorts object keys at every depth. `GET /bff/v0/audit/verify` walks the chain
and reports the first break, so editing a past row, removing one, or relinking one is detectable
and the reported sequence number is where the tampering began rather than where it was noticed.
`createdAt` and `updatedAt` are outside the hash, so a row rewritten by a backup restore still
verifies.

## Error contracts

One `ApiError` renders two ways, chosen by path so that failures raised before a handler is
reached still come back in the right shape:

- `/fhir/*` answers a FHIR `OperationOutcome` (`application/fhir+json`).
- Everything else answers an RFC 9457 problem document (`application/problem+json`) carrying the
  request id and, on a validation failure, one entry per offending field.

Statuses: 400 malformed (bad query, unsupported search parameter, unparseable body), 401
unauthenticated, 403 forbidden, 404 not found, 409 conflict or refused state transition, 422
understood but invalid, 501 not implemented.

A record in another organisation, and a record outside a patient-scoped token's compartment, are
both reported as absent rather than as forbidden. A distinguishable 403 would confirm the id
exists, which is an enumeration oracle across exactly the boundary that matters most.

## Testing

Every test drives the real app through `app.request()` against the in-memory repository, so the
suite needs no database and nothing is green because a stub said yes. Cross-tenant isolation is
tested with both organisations' rows in one store: if the scoping came out, they would leak, and
the isolation suite is generated from the aggregate list so a new repository arrives with its
isolation test already written.

The Prisma adapter is covered twice. `repositories.prisma.test.ts` drives it through a fake port
that really evaluates the filters it is handed and applies the tenant narrowing the extension
applies in production, so a `where` clause that selected the wrong rows would fail there.
`repositories.database.test.ts` settles the handful of facts only Postgres can settle and is
skipped unless `DATABASE_URL` is set:

```sh
createdb openrunic_test
DATABASE_URL=postgresql://localhost/openrunic_test \
  pnpm --filter @openrunic/database exec prisma migrate deploy
DATABASE_URL=postgresql://localhost/openrunic_test pnpm --filter api test
```

Coverage floors are enforced by `vitest.config.mts`: 95% statements, lines and functions, 90%
branches.

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
- `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` - the identity provider. Set together or not at
  all; a partial configuration is refused, because falling back to the development principal table
  because one variable was missing is exactly the accident this validation exists to prevent.
- `OIDC_CLOCK_SKEW_SECONDS` - tolerance on `exp`, `nbf` and `iat`, default `60`
- `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT` - the authorisation server third-party
  SMART apps are sent to. Set together, and only alongside the three above, since a launch whose
  tokens this API cannot verify hands an app a redirect that ends in a 401. Leave both unset and
  `/fhir/.well-known/smart-configuration` omits the endpoints and claims no launch, which is how
  a client learns to stop before redirecting anyone.

With those set, the entry point installs the real bearer-token verifier: JWKS fetched and cached,
key rotation handled by a rate-limited refetch on an unknown `kid`, `alg` checked against an
accept list before any key lookup, and issuer, audience and expiry validated with the configured
skew. Any problem with a token resolves to one indistinguishable 401; a failure to reach the
identity provider is allowed to reject instead, so an outage surfaces as a 500 with a request id
rather than as "your credentials are wrong" for everybody at once.

Under `NODE_ENV=production`, `createApp` refuses to start without an explicit `repositories`,
`principalResolver` and `auditSink`. The defaults are an in-memory store and a table of public demo
tokens, and a convenience default that survives into production is how a demo token becomes a
credential.

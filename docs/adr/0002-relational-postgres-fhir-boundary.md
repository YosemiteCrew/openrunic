# 0002. Relational Postgres as source of truth, FHIR R4 at the API boundary

## Status

Accepted

## Date

2026-08-12

## Context

An EMR must interoperate: US Core profiles, SMART on FHIR apps, ONC certification criteria such as
§170.315(g)(10) (standardized API for patient and population services), and the emerging EU
European Health Data Space (EHDS) all speak FHIR. openrunic must therefore expose a credible
FHIR R4 API.

The question is where FHIR lives in the architecture. FHIR compliance is a property of the **API
surface**: certifications and integrations test what the server returns over HTTP, not how bytes
are laid out on disk. Nothing in these programs requires FHIR-shaped storage.

Meanwhile, the application itself needs fast, strongly typed, relational access: schedules join
practitioners to slots to appointments; audit queries filter events by actor and time range;
screens want narrow projections, not 4 KB resource documents. Prisma over Postgres gives us typed
queries, migrations as reviewable diffs, and referential integrity, and the first model in
`packages/database` (AuditEvent) already leans on exactly those properties.

## Decision

We will keep a **relational PostgreSQL schema, managed by Prisma 6, as the single source of
truth**, and perform **FHIR R4 serialization at the API boundary** in `apps/api`.

- `packages/database` owns the domain model: normalized tables designed for the application's
  access patterns, with migrations as the schema history.
- `packages/fhir` owns FHIR R4 types and bidirectional mappers (`domain -> FHIR` and
  `FHIR -> domain`) for each supported resource.
- `apps/api` (Hono) is the FHIR boundary: it accepts and returns FHIR R4 resources, converting at
  the edge.
- **Every mapped resource ships with round-trip tests** (`domain -> FHIR -> domain` and, where
  write support exists, `FHIR -> domain -> FHIR`) in `packages/fhir`. A mapper without round-trip
  tests does not merge. This is the mechanism that keeps the mapping layer honest.

## Consequences

### Good

- Application code gets typed, relational access with joins, constraints, and narrow projections;
  screens are not taxed by verbose resource documents.
- Schema evolution happens through Prisma migrations: reviewable, ordered, and enforceable
  ("never edit an applied migration").
- FHIR conformance is testable exactly where it is asserted: at the API. We can target US Core /
  g(10) style requirements without contorting storage.
- Postgres skills and tooling (backups, indexes, query analysis) apply directly; operational
  surface stays small.

### Bad

- The mapping layer is a permanent tax: every new resource or field requires domain schema, mapper
  code, and round-trip tests.
- **Domain/FHIR drift is an accepted risk**: the domain model can express states a mapper does not
  yet cover. Round-trip tests bound this risk but do not eliminate it; fields that are dropped in
  mapping must be dropped deliberately and visibly in the tests.
- Generic FHIR search (arbitrary search parameters, chaining, `_include`) must be implemented
  parameter by parameter against relational columns rather than inherited from a FHIR-native
  store. We accept starting with a deliberately small search surface.

## Alternatives considered

- **FHIR-native JSONB storage (Medplum-style)**: store FHIR resources as JSONB in Postgres and
  index for FHIR search. Rejected: we would be rebuilding FHIR search machinery (search parameter
  indexing, token/reference/date semantics) that mature servers took years to harden; verbose
  resources tax every screen with parsing and projection work; and typed access degrades to
  navigating loosely typed JSON, weakening exactly the compile-time guarantees a small team relies
  on.
- **External HAPI FHIR server**: delegate FHIR storage and search to HAPI, the reference Java
  implementation. Rejected: it drags a heavyweight JVM dependency into a stack that is otherwise
  Node-only, contradicting the "fast, lightweight" product goal; operationally it doubles the
  persistence surface (HAPI's schema plus our own) and makes the EMR's core data model something
  we do not fully control.

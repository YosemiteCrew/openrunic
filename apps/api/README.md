# api

The FHIR R4 boundary of the openrunic EMR. A lightweight [Hono](https://hono.dev) server that
exposes FHIR endpoints backed by relational Postgres (via sibling workspace packages).

## Endpoints

| Route                | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `GET /healthz`       | Liveness probe                                        |
| `GET /fhir/metadata` | FHIR R4 CapabilityStatement (`application/fhir+json`) |
| `* /fhir/*`          | Unknown FHIR routes return a 404 `OperationOutcome`   |

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

- `PORT` — listen port, default `4000`
- `NODE_ENV` — `development` (default) | `test` | `production`

# 0001. Monorepo with pnpm, Turborepo, and Node 22

## Status

Accepted

## Date

2026-08-12

## Context

openrunic ships multiple deployable applications (a Next.js web app and a Hono API service) plus
shared libraries (types, FHIR mappers, database client) that must evolve in lockstep. A change to
the Prisma schema or a FHIR mapper typically touches the API and the web app in the same PR.

The YosemiteCrew organization already operates a production monorepo (Yosemite Crew, the analogous
platform for animal health) on pnpm workspaces with task orchestration, conventional-commit
governance, sharded test CI, and supply-chain scanning. That machinery is proven and its failure
modes are known to the team.

## Decision

We will build openrunic as a single monorepo:

- **pnpm 10** workspaces (`apps/*`, `packages/*`), pinned via `packageManager` and installed
  through corepack.
- **Turborepo** for task orchestration (`build`, `lint`, `type-check`, `test`, `dev`) with
  dependency-aware caching.
- **Node.js 22** as the single runtime version, enforced with `engines` plus `engine-strict` and
  recorded in `.nvmrc`.
- **Vitest** as the test runner across all workspaces.
- **ESLint 9 flat config** for linting, with Prettier owning formatting.

## Consequences

### Good

- Cross-cutting changes (schema + mapper + API + UI) land atomically in one PR with one review.
- Shared packages are consumed by path, not by publishing; no internal registry to operate.
- Transplants the proven Yosemite Crew CI machinery (conventional-commit gates, sharded vitest
  coverage, aggregate required check, supply-chain scanning) with minimal adaptation.
- One toolchain to learn; `pnpm --filter` and turbo filters keep local iteration fast.

### Bad

- The repo grows monotonically; CI must rely on turbo caching and filtering to stay fast.
- A single Node version policy means coordinated upgrades (for example Node 22 to 24) touch
  everything at once.
- Contributors unfamiliar with pnpm workspaces face a small initial learning curve (filters,
  hoisting behavior).

## Alternatives considered

- **Nx**: comparable orchestration with more built-in generators and a plugin ecosystem. Rejected
  because the team's operational experience is with pnpm + turbo; Nx's added abstraction (project
  graph plugins, executors) buys little for a repo of this size and diverges from the Yosemite
  Crew setup we intend to reuse.
- **One repository per app**: independent repos for web, api, and each package. Rejected because
  the FHIR mapping layer and Prisma schema change in lockstep with their consumers; versioned
  publishing between repos would add release overhead and drift risk with no compensating benefit
  at this stage.

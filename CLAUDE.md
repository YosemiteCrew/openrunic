# CLAUDE.md

Instructions for coding agents working in this repository. AGENTS.md carries the same content for
other agent runtimes; keep the two files in sync when editing either.

## What this repo is

openrunic: open-source operating system for human health (AGPL-3.0-only). First product is a
lightweight EMR. pnpm 10 + Turborepo monorepo on Node 22; tests are Vitest; lint is ESLint 9 flat
config; formatting is Prettier (repo config).

## Layout

```text
apps/web            Next.js 16 (hospital and patient web)
apps/api            Hono (FHIR R4 API boundary)
packages/types      Shared TypeScript types
packages/fhir       FHIR R4 types + domain<->FHIR mappers; every mapper needs round-trip tests
packages/database   Prisma 7 + Postgres; relational source of truth
docs/adr            Architecture decisions; read 0002 before touching FHIR or schema code
```

## Commands

Always scope commands to the workspaces you are touching; repo-wide runs are the slow path.

```bash
pnpm --filter <workspace> dev|test|lint|type-check
pnpm turbo run build --filter=<workspace>
pnpm verify                     # full gate: lint + type-check + test + build
```

## Definition of done

Before declaring a task finished, run and pass, scoped to what you changed:

1. `pnpm --filter <ws> lint`
2. `pnpm --filter <ws> type-check`
3. Targeted Vitest run for the changed code (`pnpm --filter <ws> test`)
4. `pnpm turbo run build --filter=<ws>` when the change affects build output

## Commit and PR conventions

- Conventional Commits, enforced by commitlint. Types:
  `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`. Scopes:
  `web|api|database|fhir|types|lib|repo|ci|docs`.
- **PR titles require a scope**: `type(scope): subject`. A scopeless title fails the "Validate PR
  title" CI check even though commitlint accepts scopeless commits locally.
- **All PRs target `dev`**, never `main`. Releases are promotion PRs (see RELEASING.md).
- Header max length 100.

## Hard rules

- **Never edit an applied Prisma migration** (anything already merged to `dev` or `main`). Create
  a new migration instead.
- **Never commit secrets or `.env` files.** Only `.env.example` with placeholder values belongs in
  git. If a secret leaks: rotate immediately and tell maintainers; history rewriting is not
  sufficient.
- **Synthetic data only** in tests, fixtures, seeds, screenshots, and logs. Never real patient
  data (PHI/PII). Use Synthea output or obviously invented identities ("Testina Patientsson").
- **Do not add `eslint-disable` comments to silence issues.** Fix the root cause; if a rule is
  genuinely wrong for the repo, change the rule in the flat config with justification.
- Keep files Prettier-formatted with the repo config (the pre-commit hook formats staged files;
  do not fight or bypass it).
- Workflows, Dependabot config, and CI files are governance-sensitive; do not modify them unless
  the task explicitly asks for it.

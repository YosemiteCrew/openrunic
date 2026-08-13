# Contributing to openrunic

Thank you for your interest in contributing. openrunic is an open-source operating system for
human health, and we want contributing to it to be straightforward and safe. This document covers
the workflow, conventions, and the non-negotiable rules for a health-data project.

By participating, you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

- **Bugs**: open an issue using the bug report template. Fill in the reproduction steps and
  environment sections; incomplete reports are much harder to act on.
- **Features**: open an issue using the feature request template before writing significant code,
  so we can agree on scope first.
- **Security vulnerabilities**: never open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

Prerequisites: Node.js 22 (see `.nvmrc`) and pnpm 10 via corepack. Database work additionally
needs a local PostgreSQL instance.

```bash
corepack enable
pnpm install
# Database work only - Prisma reads the package-local .env:
cp packages/database/.env.example packages/database/.env
# The api reads PORT/NODE_ENV from the shell environment (PORT defaults to 4000).
```

Common commands:

```bash
pnpm dev               # run all apps in dev mode (turbo)
pnpm lint              # ESLint across the repo
pnpm type-check        # TypeScript across the repo
pnpm test              # Vitest across the repo
pnpm build             # build all workspaces
pnpm verify            # lint + type-check + test + build in one shot
```

Prefer scoped commands while iterating; they are much faster:

```bash
pnpm --filter web dev              # one workspace's dev server
pnpm --filter api test             # one workspace's tests
pnpm turbo run lint --filter=@openrunic/fhir  # one workspace via turbo (full package name)
```

## Repository structure

```text
apps/web            Next.js 16 app (hospital and patient web)
apps/api            Hono service (FHIR R4 API boundary)
packages/types      Shared TypeScript types
packages/fhir       FHIR R4 types + domain<->FHIR mappers with round-trip tests
packages/database   Prisma 7 schema, migrations, and client (Postgres)
packages/ui         React component library (design system implementation) + Storybook
docs/               ADRs and project documentation
```

Architectural decisions are recorded as ADRs in [docs/adr/](docs/adr/). If your change reverses or
significantly extends a recorded decision, include a new ADR in the same PR.

## Quality gates

Before opening a PR, make sure the following pass locally:

1. `pnpm lint` (or scoped to the workspaces you touched)
2. `pnpm type-check`
3. Targeted tests for what you changed, e.g. `pnpm --filter fhir test`
4. `pnpm build` if you touched build-relevant code

CI runs the full matrix, including sharded Vitest with coverage floors. New code should come with
tests; changes to `packages/fhir` mappers must keep the round-trip tests passing and cover any new
resource fields.

Formatting is handled by Prettier (repo config). A pre-commit hook formats staged files and runs
secret scanning; do not bypass it.

CI also holds the React surface to a **React Doctor score of 95**. Run `pnpm run doctor` to see
where you stand, or `pnpm run doctor:json` for the full report. Note that the score is calculated
by a remote service while the diagnostics are computed locally; `docs/quality-gates.md` explains
that trade-off, and the licence exception the tool needs, in full.

`docs/quality-gates.md` lists every gate CI enforces and what each one is for.

## Commit messages and PR titles

We use [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint.

Allowed **types**:

`build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`

Allowed **scopes**:

`web`, `api`, `database`, `fhir`, `types`, `ui`, `lib`, `repo`, `ci`, `docs`

Examples:

```text
feat(api): add Patient read endpoint
fix(database): make AuditEvent actor index case-insensitive
docs(repo): clarify release promotion flow
```

> **Warning**: the PR title is validated in CI and the **scope is required** there. A title like
> `feat: add patient search` passes commitlint locally for commits but will fail the "Validate PR
> title" check on your PR. Always use `type(scope): subject` for PR titles.

## Pull requests

- **All PRs target the `dev` branch.** `main` is the release branch and only receives promotion
  PRs and hotfixes (see [RELEASING.md](RELEASING.md)).
- Keep PRs focused. Unrelated cleanups belong in separate PRs.
- Fill in the PR template, link the issue you are addressing, and confirm the checklist.
- The "CI Required" aggregate check must be green before merge.

## Database migrations

**Never edit a Prisma migration that has already been applied** (that is, any migration already
merged into `dev` or `main`). Create a new migration instead. Editing applied migrations breaks
every existing database, including other contributors' local environments.

## Secret hygiene

- Never commit `.env` files or credentials of any kind. `.env.example` with placeholder values is
  the only environment file that belongs in git.
- Secret scanning (secretlint locally, Gitleaks in CI) runs on every change.
- **If a secret leaks anyway**: rotate it immediately and tell the maintainers (see
  [SECURITY.md](SECURITY.md)). Removing the commit from history is NOT enough; assume anything
  that was pushed is compromised.

## Synthetic data only

This is critical for a health project and is enforced without exception:

- **Never include real patient data (PHI/PII) anywhere**: not in issues, PRs, commit messages,
  code, tests, fixtures, seed data, screenshots, or logs.
- Use obviously synthetic data: [Synthea](https://github.com/synthetichealth/synthea)-generated
  records, or invented identities that could not be mistaken for real people (for example
  "Testina Patientsson", born 1900-01-01).
- If you need to report a bug that involves real data, reproduce it with synthetic data first and
  report that.
- Any issue, PR, or attachment containing real patient data will be scrubbed or deleted on sight,
  and we will treat it as a data incident.

## Licensing of contributions

We keep the process simple: there is no CLA and no DCO sign-off requirement. By submitting a
contribution, you agree that it is your own work (or that you have the right to submit it) and
that it is provided under the project license, [AGPL-3.0-only](LICENSE).

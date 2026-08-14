# AGENTS.md

Instructions for coding agents working in this repository. CLAUDE.md carries the same content for
Claude Code; keep the two files in sync when editing either.

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
pnpm verify                     # every gate that runs from this repo's own dependencies
```

## Repo-wide gates

These are not per-workspace. CI runs them on every pull request whatever changed, because the
per-workspace lint and type-check matrix is empty for a change that only touches docs, workflows or
scripts, and that is precisely the change these catch.

```bash
pnpm run format:check           # Prettier, whole tree
pnpm run lint:css               # stylelint, every .css file
pnpm run check:secrets          # secretlint, working tree
pnpm run lint:workflows         # actionlint, .github/workflows (also shellchecks inline run: blocks)
pnpm run lint:shell             # shellcheck, tracked .sh files
pnpm run lint:docker            # hadolint, tracked Dockerfiles
```

`pnpm verify` runs the first three; they need nothing beyond `pnpm install`. The last three need
native binaries (`brew install actionlint shellcheck hadolint`, or the distribution equivalent), so
they stay out of `verify` rather than failing on a machine that has not installed them. CI installs
its own pinned, checksum-verified copies, so a passing local run and a passing CI run mean the same
thing.

`pnpm run lint:css:fix` applies the stylelint fixes that are safe to automate. Read the diff: a fix
that changes the cascade is not safe to automate, and stylelint does not know the difference.

## Definition of done

Before declaring a task finished, run and pass, scoped to what you changed:

1. `pnpm --filter <ws> lint`
2. `pnpm --filter <ws> type-check`
3. Targeted Vitest run for the changed code (`pnpm --filter <ws> test`)
4. `pnpm turbo run build --filter=<ws>` when the change affects build output
5. `pnpm run format:check`, plus `pnpm run lint:css` if you touched CSS, `pnpm run lint:workflows`
   if you touched `.github/`, `pnpm run lint:shell` if you touched a `.sh` file, and
   `pnpm run lint:docker` if you touched a Dockerfile

## Commit and PR conventions

- Conventional Commits, enforced by commitlint. Types:
  `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`. Scopes:
  `web|api|database|fhir|types|ui|lib|repo|ci|docs`.
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
- **The same rule applies to `stylelint-disable`.** If a stylelint rule is wrong for this codebase,
  turn it off in `stylelint.config.mjs` with the reason and the condition that would bring it back,
  the way every entry in that file already does. A scoped `stylelint-disable-next-line` is
  acceptable only for a single genuine exception and only with a `--` reason attached.
- **No colour literals in CSS.** Colour reaches a component through a design token, never as a hex
  value or a named colour; stylelint enforces this for every property that is not a custom property
  definition. If a value seems to need a new colour, propose a token in
  `packages/ui/src/styles/tokens/colors.css` in the pull request rather than inlining it.
- Keep files Prettier-formatted with the repo config (the pre-commit hook formats staged files;
  do not fight or bypass it). CI checks this independently, so a `--no-verify` commit does not get
  past it.
- Workflows, Dependabot config, and CI files are governance-sensitive; do not modify them unless
  the task explicitly asks for it.

# CLAUDE.md

Instructions for coding agents working in this repository. AGENTS.md carries the same content for
other agent runtimes; keep the two files in sync when editing either.

## What this repo is

openrunic: open-source operating system for human health (AGPL-3.0-only). First product is a
lightweight EMR. pnpm 10 + Turborepo monorepo on Node 22; tests are Vitest; lint is ESLint 9 flat
config; formatting is Prettier (repo config).

## Layout

```text
apps/web              Next.js 16, the staff EMR. Sign-in, schedule, chart, orders, results,
                      billing, admin, plus the public marketing pages and the clinician assistant
apps/portal           Next.js 16, the patient portal, including the patient assistant surface
apps/api              Hono, the FHIR R4 API boundary and the BFF the apps call

packages/types        Shared TypeScript types
packages/fhir         FHIR R4 types and domain<->FHIR mappers; EVERY mapper needs round-trip tests
packages/database     Prisma 7 + Postgres, the relational source of truth, plus row-level security
packages/ui           The design system: tokens, components, Storybook
packages/agent        The assistant loop and provider wiring (ADR-0005)
packages/agent-tools  The tool catalogue, allowlist and compartment rules the loop may reach
packages/x12          X12 eligibility, claims, remittance and prior-authorisation codecs
packages/collections  Chasing an unpaid patient balance: when the next notice is due, when to stop
packages/pricing      Fee schedules and sliding-scale discounts; what is billed, what is allowed
packages/quality      Electronic clinical quality measures; what a practice did, and what this will not claim
packages/ccda         C-CDA R2.1 document codec; generate and import, with its own XML reader
packages/inventory    Stock, lots and dispensing: what is on the shelf, which lot it leaves from
packages/i18n         Message catalogues: what a screen says, in the reader's language
packages/hl7v2        HL7 v2 codec: ADT, ORU, ORM, VXU and acknowledgements
packages/cds-hooks    CDS Hooks 2.0 protocol: discovery, request validation, cards
packages/growth       Growth percentiles; CDC LMS reference data, generated and verified
packages/forms-engine The form definition and rendering engine
packages/terminology  Bring-your-own terminology; nothing licence-restricted is ever committed
packages/adapters     Partner seams (eRx, payments, video, clearinghouse), demo implementations

docs/adr              Architecture decisions. Read them before the code they govern:
                      0002 relational Postgres with FHIR at the boundary (schema and FHIR work)
                      0004 no ML runtime in the core deployment
                      0005 the agentic layer, and its binding rules
                      0006 the patient assistant surface
docs/quality-gates.md Every gate CI enforces, what it is for, and where its exceptions live
```

Each app and most packages carry their own `AGENTS.md` with the rules specific to it. Read the one
for the directory you are working in; it says the things that are true there and nowhere else.

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

## The bar

Numbers, not adjectives. CI enforces all of these, so a change that lowers one is a change that
needs an argument rather than a nudge.

- **Coverage floors**: `web`, `api` and `portal` at statements 95, functions 95, lines 95, with
  branches at 90 for the two Next.js apps and 95 for `api`. Set in `COVERAGE_FLOORS` in
  `.github/workflows/_test.yaml`. Raise them as suites grow; never lower one to land a change.
- **Sonar**: 95% coverage, zero duplication and zero open issues. Whole-branch figures on a push
  to `main`; on a pull request, coverage and duplication are whole-project figures while
  `violations` counts the issues open on the PR itself (see `docs/quality-gates.md` for the scope
  semantics). Enforced by `scripts/ci/sonar-thresholds.mjs` in `_sonar.yaml`,
  because this organisation's SonarCloud plan will not accept a custom quality gate;
  `docs/quality-gates.md` has the detail. A finding that is genuinely wrong gets a narrow exclusion
  in the app's `sonar-project.properties`, with rationale and a revisit condition - never a lower
  number.
- **React Doctor**: 95 minimum, run with `pnpm run doctor`. Note that the score comes from a remote
  service while the diagnostics are computed locally; `docs/quality-gates.md` explains the
  trade-off.
- **Accessibility**: every Storybook story passes axe in CI. `apps/web` has no stories, so its
  accessibility evidence is keyboard-driven tests, named in the file that relies on them.

## Writing for the next reader

This codebase is commented unusually heavily and deliberately so. Match it.

- A comment says **why**, in full sentences. What the code does is already on the screen.
- **A comment must be true of the code it sits on.** More review rounds have been spent here on
  comments that described the code as it used to be than on any other class of defect: a header
  saying "from the three routes that exist" after a fourth was added, a doc claiming a hash proved
  something it never compared, a security note promising a property the code did not have. A stale
  comment is worse than none, because the next reader trusts it.
- The same applies to a PR body, an ADR and a README. If you change what the code does, find every
  sentence that described the old behaviour.
- When you suppress a finding, the rationale goes next to the suppression, names what was verified,
  and carries a revisit condition. `apps/web/sonar-project.properties` and `.github/zizmor.yml` are
  the worked examples.

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
  `web|portal|api|database|fhir|types|ui|lib|repo|ci|docs`. `commitlint.config.cjs` is the
  list CI reads; keep this line matching it.
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

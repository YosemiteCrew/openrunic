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

To run the assembled product instead of a development tree, Docker needs neither Node.js nor
PostgreSQL on the host:

```bash
cp .env.example .env
chmod 600 .env
# Replace every `generate-me` in .env with a fresh value:
openssl rand -hex 32
docker compose up --build
```

That brings up Postgres, the API and the web app, applies every migration and seeds a demo
practice. `POSTGRES_PASSWORD` and `SESSION_COOKIE_SECRET` arrive as the `generate-me` sentinel and
the stack starts without replacing them, so replace both or you are running on a password published
in this repository. `pnpm setup:selfhost` generates them for you. [`docs/self-hosting.md`](docs/self-hosting.md) is the operator's guide to that
stack: backups, restores, upgrades, and what has to be true before it can hold a real record.

Common commands:

```bash
pnpm dev               # run all apps in dev mode; turbo builds the packages they import first
pnpm lint              # ESLint across the repo
pnpm type-check        # TypeScript across the repo
pnpm test              # Vitest across the repo
pnpm build             # build all workspaces
pnpm verify            # every gate that runs from this repo's own dependencies, in one shot
```

Optional native tools, needed only for the three gates that lint workflow YAML, shell scripts and
Dockerfiles (see [Repo-wide gates](#repo-wide-gates)):

```bash
brew install actionlint shellcheck hadolint   # or your distribution's equivalent
```

Prefer scoped commands while iterating; they are much faster:

```bash
pnpm turbo run dev --filter=web    # one app's dev server, with the packages it imports built first
pnpm --filter api test             # one workspace's tests
pnpm turbo run lint --filter=@openrunic/fhir  # one workspace via turbo (full package name)
```

Run a dev server through turbo rather than as `pnpm --filter web dev`. Every package resolves to
its `dist/`, and only turbo knows to build those first; the bare filter form starts the app against
packages a fresh clone has never built.

## Repository structure

```text
apps/web                  Next.js 16, the staff EMR, plus the public marketing pages
apps/portal               Next.js 16, the patient portal
apps/api                  Hono, the FHIR R4 API boundary and the BFF both apps call
apps/e2e                  The full-day clinical drill: the acceptance test for the whole product

packages/types            Shared primitive types: environments, branded identifiers, Result
packages/database         Prisma 7 schema, migrations, client, and row-level security (Postgres)
packages/ui               React component library (design system implementation) + Storybook
packages/i18n             Message catalogues and locale fallback
packages/ops              Self-host operations: install, backup, restore, upgrade

packages/fhir             FHIR R4 types + domain<->FHIR mappers with round-trip tests
packages/ccda             C-CDA R2.1 document codec: generate and import
packages/hl7v2            HL7 v2 codec: ADT, ORU, ORM, VXU and acknowledgements
packages/x12              X12 5010: 270/271, 837P, 835, 277, 999, 278
packages/cds-hooks        CDS Hooks 2.0: discovery, request validation, cards
packages/terminology      Bring-your-own terminology; nothing licence-restricted is committed

packages/clinical-safety  Allergy and duplicate-therapy screening at prescribing
packages/growth           Growth percentiles from CDC LMS reference data
packages/forms-engine     Form definitions, validation, rendering, promotion
packages/inventory        Stock, lots and dispensing from an append-only ledger
packages/collections      Patient-balance collections: dunning schedule, ageing, write-off
packages/mips             MIPS scoring on top of the quality measures
packages/pricing          Fee schedules and sliding-scale discounts
packages/quality          Electronic clinical quality measures (eCQM)
packages/adapters         Partner seams (eRx, payments, video, clearinghouse) with demo mocks

packages/agent            The assistant loop, approval gating and budget caps (ADR-0005)
packages/agent-tools      The tool catalogue and compartment rules the loop may reach

docs/                     ADRs, the capability map, self-hosting, and the gate documentation
```

Architectural decisions are recorded as ADRs in [docs/adr/](docs/adr/). If your change reverses or
significantly extends a recorded decision, include a new ADR in the same PR.

## Quality gates

Before opening a PR, make sure the following pass locally:

1. `pnpm lint` (or scoped to the workspaces you touched)
2. `pnpm type-check`
3. Targeted tests for what you changed, e.g. `pnpm --filter fhir test`
4. `pnpm build` if you touched build-relevant code
5. The repo-wide gates below that your change touches

CI runs the full matrix, including sharded Vitest with coverage floors. New code should come with
tests; changes to `packages/fhir` mappers must keep the round-trip tests passing and cover any new
resource fields.

### Repo-wide gates

Steps 1 to 4 above are per-workspace: CI works out which workspaces a change affects and runs them
only for those. That leaves a gap, because a pull request touching only documentation, only a
workflow file or only a shell script affects no workspace at all. The gates in this section close
it. They run on every pull request whatever changed, and their results are folded into the
`CI Required` check alongside everything else.

| Gate       | Local command             | What it is there for                                          |
| ---------- | ------------------------- | ------------------------------------------------------------- |
| Prettier   | `pnpm run format:check`   | Formatting, whole tree                                        |
| stylelint  | `pnpm run lint:css`       | CSS correctness and the design-token rules                    |
| secretlint | `pnpm run check:secrets`  | Secret scanning, including a committed `.env` of any content  |
| actionlint | `pnpm run lint:workflows` | Workflow YAML, plus shellcheck over every inline `run:` block |
| shellcheck | `pnpm run lint:shell`     | Tracked `.sh` scripts, which actionlint does not see          |
| hadolint   | `pnpm run lint:docker`    | Tracked Dockerfiles                                           |

`pnpm verify` runs the first three, since they need nothing beyond `pnpm install`. The last three
need native binaries; install them once (see [Development setup](#development-setup)) and run them
when you touch the files they cover. CI installs its own pinned, checksum-verified copies of all
three, so it never depends on what happens to be on a contributor's machine.

Formatting is handled by Prettier (repo config). A pre-commit hook formats staged files and runs
secret scanning; do not bypass it. The Prettier and secretlint gates above exist because the hook
only sees an ordinary local commit: a `--no-verify` commit, an edit made through the GitHub web UI
and a bot commit all go straight past it.

### CSS and the design system

`packages/ui` is a design system, so its CSS is source code and is linted as such. The full rule
set and the reasoning behind every choice live in `stylelint.config.mjs`; the two rules worth
knowing before you write any CSS are:

- **No colour literals.** A hex value or a named colour is rejected in any property that is not a
  custom property definition. Colour reaches a component through a token. If you need a colour that
  no token provides, propose the token in `packages/ui/src/styles/tokens/colors.css` as part of your
  PR rather than inlining the value.
- **BEM class names**: `block`, `block__element`, `block--modifier`, kebab-case within each part.

If a stylelint rule is wrong for this codebase, say so in your PR and turn it off in
`stylelint.config.mjs` with the reason and the condition that would bring it back, which is what
every other entry in that file does. Do not scatter `stylelint-disable` comments. A single
`stylelint-disable-next-line` with a `--` reason attached is fine for a genuine one-off exception.

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

`web`, `portal`, `api`, `database`, `fhir`, `types`, `ui`, `lib`, `repo`, `ci`, `docs`

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

### The guard that enforces it

`scripts/ci/phi-guard.mjs` runs on every pull request (the "Synthetic data only" check). Run it
yourself before pushing:

```bash
pnpm run check:phi          # scan the tree
pnpm run check:phi:test     # the guard's own tests
```

It reports the file, the line and the rule, and **redacts the middle of every value**, so a finding
never puts an identifier into a public CI log.

**What trips it, and what to write instead.**

| It fails on                                                      | Write this instead                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A US Social Security number that could have been issued          | The never-issued ranges: area `000`, `666`, or `900`-`999`; group `00`; serial `0000` |
| An NHS number that passes its mod-11 checksum                    | The reserved synthetic range, which starts `999`                                      |
| A card number that passes Luhn with a real issuer prefix         | A publicly documented test card number                                                |
| An email on a real domain                                        | `example.com`, `example.org`, or anything on a `.invalid` / `.test` domain            |
| A routable phone number                                          | NANP `555-0100` to `555-0199`, or an Ofcom drama range for UK numbers                 |
| A name next to a date of birth, where the name could be a person | A name that obviously could not be: `Testina Patientsson`, `Exampla Testperson`       |

That last one is the only rule that needs judgement, so here is exactly how it works. When a
fixture pairs a full identity with a date of birth, the guard checks the identity for a marker that
makes it unmistakably invented - `test`, `example`, `demo`, `mock`, `fixture`, `placeholder`,
`synth`, `stub`, `sample`, and others. `PATIENT_NAMES` in `packages/database/src/seed/data.ts` is
the reference: every row carries one across the given/family pair. Follow that convention and the
rule never fires. Invent a plausible-sounding person and attach a birth date, and it will.

**Where it looks.** Two tiers, because the cost of a false positive differs by rule:

- The checksum rules (SSN, NHS number, payment card) run over the **whole tree**. A valid one has no
  legitimate place in any file here, source included.
- The contact-detail and identity rules run only over **seeds, fixtures, test files, snapshots,
  stories and docs**. Application source legitimately contains LOINC, CPT and SNOMED codes and FHIR
  canonical URIs; scanning it would generate noise and find nothing.

**If you believe a finding is wrong**, do not silence it in passing. Either the fixture needs
fixing, or the rule needs calibrating in `scripts/ci/phi-guard.mjs` - with a test that pins the new
behaviour, and a comment saying why. The allowlists in that file each carry a reason and a revisit
condition; anything added to them should too.

A broader map of every automated control is in [docs/security-gates.md](docs/security-gates.md).

## Licensing of contributions

We keep the process simple: there is no CLA and no DCO sign-off requirement. By submitting a
contribution, you agree that it is your own work (or that you have the right to submit it) and
that it is provided under the project license, [AGPL-3.0-only](LICENSE).

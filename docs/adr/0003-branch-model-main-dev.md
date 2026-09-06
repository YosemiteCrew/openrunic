# 0003. Branch model: main plus dev with a single aggregate check

## Status

Accepted

Amended 2026-08-19, in the hotfix clause only. The Decision below allows a second way into `main`:
"Moves only via promotion PRs from `dev` and via hotfixes", and the **Hotfixes** bullet that spells
that route out as branch from `main`, PR to `main`, back-merge into `dev`. That clause has been
superseded by the **single-route model**, in which every change reaches `main` through `dev` and a
promotion PR however urgent it is. It is not a convention any more: the "Promotion source" check in
`.github/workflows/promotion-guard.yaml` is required by the `main` ruleset, and it refuses any pull
request into `main` whose head is not `dev`. The reasoning, and the cost we knowingly accepted (a
promotion
carries everything sitting on `dev`, so an urgent fix ships the rest with it), is in the
[Hotfixes](../../RELEASING.md#hotfixes) section of RELEASING.md, which also records the one
deliberate, reviewed way to widen the guard.

Decisions are immutable history, so the hotfix clause is left standing below and read as history,
along with the Bad consequence that follows from it ("hotfixes must be back-merged promptly"), which
describes work the single-route model removed. The protection and gating bullets, and the
consequences that describe them, were separately corrected on the same date to name the status
checks the live rulesets actually require rather than the one the ADR originally claimed; the
"CI Required" aggregate is unchanged, and the additions are contexts the aggregate is structurally
unable to cover. One further parenthetical below has been overtaken by events rather than reversed:
"Tags (when releases begin)" was written before there were any, and releases begin at 0.1.0. This
ADR is amended, not superseded, and everything else in it stands.

## Date

2026-08-12

## Context

openrunic needs a branching model that supports continuous integration of many small PRs (from
humans and coding agents alike) while keeping a stable, releasable branch. It also needs branch
protection that does not have to be reconfigured every time the CI matrix changes shape, since the
CI pipeline (sharded tests, scanners) will evolve quickly during the scaffold phase.

The YosemiteCrew organization runs the same model on Yosemite Crew and has already paid for the
lessons: required-check lists that name individual jobs go stale the moment jobs are renamed or
resharded, and classic branch protection is less expressive and harder to audit than rulesets.

## Decision

We will use a two-branch model:

- **`main`**: default and release branch. Moves only via promotion PRs from `dev` and via
  hotfixes. Tags (when releases begin) are created on `main` only.
- **`dev`**: integration branch. **All feature, fix, and docs PRs target `dev`.**
- **Promotion**: a PR from `dev` to `main` titled
  `chore(repo): promote dev to main - <summary>`, merged without squashing.
- **Hotfixes**: branch from `main`, PR to `main`, then back-merge `main` into `dev` immediately.

Protection and gating:

- CI is orchestrated by `ci.yaml`, which ends in a single aggregate job, **"CI Required"**, that
  succeeds only if every leg it fans out to succeeded.
- **"CI Required" is the only check `ci.yaml` contributes to the required list.** No job inside it
  (lint, type-check, test shards, the scanners it calls) is ever named as a required check, so the
  matrix can be resharded and renamed without touching repository settings.
- **Checks that `ci.yaml` cannot observe are required by name, because nothing else can hold
  them.** An aggregate can only depend on jobs its own workflow calls. A check produced somewhere
  else is invisible to it, and leaving it unrequired would mean it could fail without blocking a
  merge. Three fall in that class:
  - `Detect secrets (Gitleaks)`, from `.github/workflows/secret-scan.yml`. It is a separate
    workflow rather than a leg of `ci.yaml` because a push run scans only its own commit range,
    which needs concurrency behaviour opposite to the rest of CI: superseding a push run would
    leave those commits unscanned.
  - `GitGuardian Security Checks` and `Aikido Security: check code`, posted by GitHub Apps. There
    is no workflow in this repository for either, so there is nothing for the aggregate to depend
    on even in principle.
- `main` requires one more, `Promotion source`, from `.github/workflows/promotion-guard.yaml`.
  Rulesets cannot express "only `dev` may be the source branch", so that constraint is expressed as
  a status check instead. It is required on `main` alone because it only runs on pull requests
  targeting `main`.
- The live lists are therefore **five required contexts on `dev`** (`CI Required`,
  `Detect secrets (Gitleaks)`, `GitGuardian Security Checks`, `Aikido Security: check code`,
  `No named external product`) and **five on `main`** (the first four plus `Promotion source`).
  `No named external product` was added to `dev` on 2026-09-06 and deliberately not to `main`: a
  promotion carries content already checked on `dev`, so the marginal value is lower and the blast
  radius is a release. Read the live lists with
  `gh api repos/YosemiteCrew/openrunic/rulesets/<id> --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context'`
  rather than trusting this sentence - it has been stale before. The exception to the single-aggregate
  rule is deliberately narrow: a check earns its own entry only when the aggregate is structurally
  incapable of covering it, never because a job feels important enough to name.
- Branch protection is implemented with **repository rulesets**, not classic branch protection:
  rulesets are auditable, exportable as JSON, can layer, and apply consistently to admins.

## Consequences

### Good

- `main` is always in a releasable state; integration churn is absorbed by `dev`.
- Because no job inside `ci.yaml` is required by name, CI evolution (adding shards, renaming jobs,
  moving a scanner between legs) never requires a settings change, and a green "CI Required" has a
  single unambiguous meaning.
- Rulesets give reviewable, versionable protection configuration.
- The model is identical to Yosemite Crew's, so contributors and agents working across both
  organizations follow one set of habits.

### Bad

- Two long-lived branches require discipline: hotfixes must be back-merged promptly, and files
  that GitHub reads from the default branch must be kept in sync (see RELEASING.md for the list).
- The aggregate check is a single point of truth: a bug in the aggregation job can block or,
  worse, falsely green a merge. The aggregate must fail closed (any skipped or failed leg fails
  the aggregate).
- Promotion PRs batch changes, so a regression discovered on `main` may need bisecting across the
  promoted range.
- The four externally produced contexts are named by name, so they carry exactly the staleness the
  single-aggregate rule was meant to avoid. If a GitHub App renames its check, or `secret-scan.yml`
  renames its job, the ruleset keeps waiting for a context nobody reports and every pull request
  stops being mergeable. That fails closed, which is the right direction, but it fails confusingly:
  whoever renames one of those jobs has to update both rulesets in the same change.

## Alternatives considered

- **Trunk-based (main only)**: every PR targets `main`. Rejected for now: with parallel agent
  workstreams and a pre-alpha CI matrix still stabilizing, an integration buffer is worth more
  than the simpler topology. Revisit once releases and release branches exist.
- **Git flow (release + hotfix + develop branches)**: rejected as heavier than needed; we take
  only the dev/main split and skip release branches until there is something to release.
- **Per-job required checks with classic branch protection**: rejected from direct experience;
  the required-check list goes stale on every matrix change and classic protection is less
  auditable than rulesets.

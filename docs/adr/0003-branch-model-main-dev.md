# 0003. Branch model: main plus dev with a single aggregate check

## Status

Accepted

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
- **"CI Required" is the only required status check** on both branches. Individual jobs (lint,
  type-check, test shards, scanners) are never listed as required checks, so the matrix can be
  reshaped without touching repository settings.
- Branch protection is implemented with **repository rulesets**, not classic branch protection:
  rulesets are auditable, exportable as JSON, can layer, and apply consistently to admins.

## Consequences

### Good

- `main` is always in a releasable state; integration churn is absorbed by `dev`.
- One required check means CI evolution (adding shards, renaming jobs) never requires settings
  changes, and a green "CI Required" has a single unambiguous meaning.
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

## Alternatives considered

- **Trunk-based (main only)**: every PR targets `main`. Rejected for now: with parallel agent
  workstreams and a pre-alpha CI matrix still stabilizing, an integration buffer is worth more
  than the simpler topology. Revisit once releases and release branches exist.
- **Git flow (release + hotfix + develop branches)**: rejected as heavier than needed; we take
  only the dev/main split and skip release branches until there is something to release.
- **Per-job required checks with classic branch protection**: rejected from direct experience;
  the required-check list goes stale on every matrix change and classic protection is less
  auditable than rulesets.

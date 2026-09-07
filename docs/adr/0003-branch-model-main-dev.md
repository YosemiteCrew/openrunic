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
  merge. This document named three of them and there were seventeen, which is what #317 was filed
  about: the rule was stated, applied to three, and fourteen more sat in its stated class being
  read by reviewers rather than blocking anything. Ten were added to `dev` on 2026-09-07.

  The ones with no workflow in this repository at all, so the aggregate could not depend on them
  even in principle:
  - `GitGuardian Security Checks` and `Aikido Security: check code`, posted by GitHub Apps.

  The ones from standalone workflows, which `ci.yaml` does not call and therefore cannot observe:
  - `Detect secrets (Gitleaks)` and `Detect secrets (secretlint)`, from `secret-scan.yml`. That
    workflow is separate from `ci.yaml` because a push run scans only its own commit range, which
    needs concurrency behaviour opposite to the rest of CI: superseding a push run would leave
    those commits unscanned. It has two jobs and for a year only one of them was required.
  - `Cited advisories exist` (`advisory-ids.yml`) and `Accepted findings are still current`
    (`exception-expiry.yml`). Each is the sole enforcement of a rule written down in this
    repository, and each enforced it by being read.
  - `Synthetic data only` (`phi-guard.yml`).
  - `Storybook Required` (`storybook.yml`) and `Supply Chain Required` (`supply-chain.yml`). Both
    were written as aggregates _to be_ required and their own comments said they were. Supply
    Chain has been required on Yosemite Crew since before this.
  - `Scan infrastructure files (Trivy config + Compose guard)` (`iac-scan.yml`),
    `Review dependency changes` (`dependency-review.yml`),
    `Audit workflow security (zizmor)` (`workflow-audit.yml`) and
    `Validate PR title` (`pr-governance.yml`).

  **Deliberately not required, each for a stated reason** - this is the part that goes stale
  silently, so it is written down rather than left as an absence:
  - `Analyze (actions)` and `Analyze (javascript-typescript)`, CodeQL. Held unrequired on purpose;
    #283 turns on exactly that distinction.
  - `React Doctor score`. It answers _is the aggregate above a number_ rather than _did a thing
    happen_, and the number moves for reasons that are not defects: a two-pass `.flatMap().map()`
    written for readability cost six points of the three available above the floor of 95, measured
    on #404. Requiring it converts "a refactor annotated the build" into "a refactor blocks the
    merge". If it is ever required, the floor wants deciding at the same time.
  - `Vulnerability scan (grype)` and `License compliance (grant)`. Both are legs of
    `Supply Chain Required`, which fails on any leg that failed, was cancelled **or was skipped**.
    Requiring the aggregate covers them; requiring the legs as well would be a second list to keep
    in step with the first.
  - `Scan container images (grype) (...)`, twice. The context name embeds the Dockerfile path from
    a matrix, so **the name changes when a Dockerfile is added or renamed** and a required entry
    would become permanently absent - which fails closed and deadlocks the branch. That workflow
    has no aggregate; giving it one is a code change rather than a settings change, and is the
    prerequisite for requiring this class at all.
  - `Validate commit messages`. Its job carries
    `github.event.pull_request.user.login != 'dependabot[bot]'`, so on a Dependabot pull request
    it is **skipped**, and a skipped context never becomes success. `dependabot.yml` sets
    `target-branch: dev` for all three ecosystems, so every Dependabot pull request lands on the
    branch this ruleset protects. Measured: `skipped` on #232 and #171, `success` on a
    human-authored one as the control.

    This one was required for four minutes on 2026-09-07 and removed. It is the case an
    empirical sweep cannot find - eleven pull requests across five change shapes were all
    human-authored, so the shape that deadlocks was not in the sample - and that a scan of
    workflow-level `on:` blocks also cannot find, because the condition is on the **job**. The
    check that finds it is: for each context, read the `if:` of the job whose `name:` produces
    it, and then test the shape that condition excludes.

    Requiring it needs the carve-out resolved first. Dropping the carve-out makes Dependabot's
    commit messages a merge gate, which is a decision about a bot nobody writes messages for;
    keeping it means this context can never be required. Neither is obvious and it is not a
    settings change.

- `main` requires one more, `Promotion source`, from `.github/workflows/promotion-guard.yaml`.
  Rulesets cannot express "only `dev` may be the source branch", so that constraint is expressed as
  a status check instead. It is required on `main` alone because it only runs on pull requests
  targeting `main`.
- The live lists are therefore **fifteen required contexts on `dev`** and **five on `main`**
  (`CI Required`, `Detect secrets (Gitleaks)`, `GitGuardian Security Checks`,
  `Aikido Security: check code`, `Promotion source`). `No named external product` was added to
  `dev` on 2026-09-06 and the ten above on 2026-09-07, and deliberately none of them to `main`:
  a promotion carries content already checked on `dev`, so the marginal value is lower and the
  blast radius is a release.

  One entry cannot be promoted to `main` even in principle today. `forbidden-terms.yml` checks out
  the **base** ref and reads three files from it, and neither the workflow nor those files exists
  on `main`; required there, every promotion would exit 2 as "a guard that could not run", and the
  files can only reach `main` through a promotion. The order is forced - a release carries them
  first, then the context is added - and a release should not be scheduled to satisfy a gate.
  Absence from `main` is not by itself a blocker: `advisory-ids.yml` is also absent there and is
  unaffected, because its default checkout gives it the merge ref. It is the **base-reading**
  pattern that makes a check unpromotable, so it is worth checking per workflow rather than
  assuming either way.

  Read the live lists with
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

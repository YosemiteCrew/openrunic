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

Amended 2026-09-07, in the gating bullets only, after two sentences in this document were
measured false. It said a `skipped` context "never becomes success" - it passes, and the
consequence is that the `Validate commit messages` carve-out would have exempted Dependabot rather
than deadlocking it. And it said rulesets "apply consistently to admins" - both rulesets carry an
always-bypass for repository admin, which GitHub's own evaluation record shows being used. Both
sentences read as settled reasoning and neither had an instrument behind it. The corrections are in
place below, alongside a new _What a required context guarantees_ section that states which
conclusions pass, which of those are measured here, and which are not measurable at all.

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

  And one context that is posted by neither a workflow job nor a third-party app:
  - `CodeQL`, added 2026-09-07. **This is not one of the two `Analyze (...)` legs**, and the
    distinction is the reason it was missed: `codeql.yml` declares a single job named
    `Analyze (${{ matrix.language }})`, so the matrix produces `Analyze (actions)` and
    `Analyze (javascript-typescript)` and there is **no job whose `name:` produces `CodeQL`**.
    That context is the Code Scanning aggregate, posted by the Advanced Security app once the
    analyses upload, and it is the one that carries the verdict: on #409 the two `Analyze` legs
    were `success` while `CodeQL` was `failure`, on a `high` severity `js/redos` alert in a
    regular expression added by that pull request.

    An earlier version of this document excluded "CodeQL" by naming the two `Analyze` legs and
    citing #283 as holding it unrequired on purpose. Both halves were wrong: the legs are not the
    context that fails, and #283 is `ci(repo): gate named external products on every pull
request` - the forbidden-terms work, merged, and required here as of the same change. The
    citation was carried from an issue body into this document without being opened. **A stated
    reason with an issue number in it reads as checked**, which is what made it survive.

    Requiring it needed a different disqualifier from the rest, because the method that made the
    rest safe - read the `if:` of the job whose `name:` produces the context - has nothing to
    read. So it is empirical: `codeql.yml` has `pull_request` on `[dev, main]` with no `paths`
    filter and its one job has no `if:`, and the context is `success` on **fifteen of fifteen**
    pull requests examined - thirteen human ones spanning `ts`-only, `md`+`yml`-only, `css`/`mjs`
    and mixed shapes, plus **both Dependabot pull requests**, which is the shape that disqualified
    `Validate commit messages`.

  **Deliberately not required, each for a stated reason** - this is the part that goes stale
  silently, so it is written down rather than left as an absence:
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
    it is **skipped**. `dependabot.yml` sets `target-branch: dev` for all three ecosystems, so
    every Dependabot **version** pull request lands on the branch this ruleset protects. Measured:
    `skipped` on #232 and #171, `success` on a human-authored one as the control.

    That "every" is conditional on a repository **setting**, not on this file: Dependabot
    _security_ updates ignore `target-branch` entirely and open against the default branch, and
    `dependabot.yml` records that they are deliberately disabled and must stay disabled. Turning
    them back on puts Dependabot pull requests on `main`, where this ruleset does not apply and a
    different list of five does.

    **This bullet originally said "a skipped context never becomes success" and that is false** -
    see _What a required context guarantees_ below, where it is measured. The removal was right
    and the reason was backwards: requiring this context would not have deadlocked Dependabot, it
    would have **silently exempted** it, leaving a commit-message gate required, green, and never
    run on the author that opens the most pull requests here. A deadlock is loud and an exemption
    is not, so the defect the carve-out would have created is the worse of the two.

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
- The live lists are therefore **sixteen required contexts on `dev`** and **five on `main`**
  (`CI Required`, `Detect secrets (Gitleaks)`, `GitGuardian Security Checks`,
  `Aikido Security: check code`, `Promotion source`). `No named external product` was added to
  `dev` on 2026-09-06, the ten above and `CodeQL` on 2026-09-07, and deliberately none of them to `main`:
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
  rulesets are auditable, exportable as JSON, and can layer.

  **They do not apply to admins here, and an earlier version of this sentence said they did.**
  Both rulesets carry a bypass, present on every version since the first on 2026-08-12:

  ```
  rules/branches/dev    bypass_actors  [RepositoryRole 5, bypass_mode: always]
  rules/branches/main   bypass_actors  [OrganizationAdmin always, RepositoryRole 5 always]
  ```

  Role 5 is repository admin, and both accounts that merge here hold it. It is not theoretical:
  `rulesets/rule-suites?ref=refs/heads/dev` is GitHub's own evaluation record, and in a
  twenty-four hour window it showed **3 of 49 pushes with `result: bypass`** - one over
  `Required status check "CI Required" is expected`, two over the approving-review requirement.
  The other 46 are `pass`, so the field is not defaulting.

  That endpoint retains roughly a day, so 3 is a floor rather than a total, and its `pushed_at`
  is the one GitHub time that is **not** `Z` - it carries a local offset, as does
  `rulesets/{id}/history`. Truncating either to nineteen characters silently converts a local
  time into a false UTC.

  The bypass is deliberately retained for now: it is the only recovery path from a ruleset write
  that deadlocks the branch, which has happened. Removing it is an owner's decision, not a
  cleanup, and it is tracked in #411. Until then, **sixteen required contexts on `dev` are a
  strong default and not an enforced boundary**, and any statement that a gate "cannot be
  merged past" is wrong as written.

### What a required context guarantees

Enumerating required contexts measures the list, not the enforcement. Three conclusions and one
absence decide what "required" buys, and only two of the four are measured here:

| the context ...     | effect on the merge | status                                                                    |
| ------------------- | ------------------- | ------------------------------------------------------------------------- |
| concludes `success` | passes              | measured, continuously                                                    |
| concludes `skipped` | **passes**          | **measured**, #412, this ruleset, 2026-09-07                              |
| concludes `neutral` | passes              | **inferred** - see the bound below                                        |
| never posts at all  | **fails the rule**  | measured; whether it blocks the _merge_ depends on the bypass - see below |

`skipped` was settled by manufacturing it: a throwaway pull request gave one required job a
never-true event condition, and with the other fifteen `success` and that one `skipped`,
`mergeStateStatus` reached `CLEAN`/`MERGEABLE` under an approval and returned to `BLOCKED` the
moment the review was dismissed. Controls: a fully green pull request reaching `CLEAN` on the same
ruleset the same day, the dismissal as a reversibility arm, and a context name nothing reports
returning zero rows.

**The blocking row is weaker than it looks and the distinction is the table's whole value.** The
evidence is #258's rule evaluation, recorded `FAIL` with
`Required status check "CI Required" is expected` - so what is measured is that the **rule** fails
when a required context never posts. #258 then **merged**, over that failed rule, on the admin
bypass described above. So "never posts blocks the merge" holds only where nobody uses the bypass,
and this repository has no instance of a merge actually being stopped by it. Read the row as: the
rule fails, and the bypass decides whether that is the end of the matter.

**`ABSENT` has no transient form, and the two readings are far apart.** `mergeStateStatus` says
`BLOCKED` both for a required context whose producing workflow is still running and for one that
will never post at all, and the distance between them is _wait four minutes_ and _edit a ruleset_.
The discriminator is cheap and belongs here rather than in anyone's notes:

```
gh api "repos/O/R/actions/runs?head_sha=<the full 40 characters>"    # read total_count too

no run at all on this head                       -> TOO EARLY. Poll again; decide nothing.
runs exist and the producing workflow has none   -> permanent
the producing run's status != "completed"        -> transient
that run completed and the context never posted  -> permanent
```

**Read the workflow _run_, not its check runs.** A run creates its downstream jobs as its upstream
ones finish, so in the first minute after a push the check-run list under-reports: measured on this
document's own head, the number of check runs not yet `completed` went `1` at t=60s, `31` at t=80s,
`28` at t=100s and `8` at t=120s. At t=60s "one thing still running" did not mean nearly finished;
it meant the thirty jobs that would block had not been created yet. Keying the transient reading on
check runs makes the empty case - nothing from that workflow on the head - read as **permanent**
during exactly the window when nothing has started, which is the wrong answer in the direction that
sends someone to edit a ruleset. The run exists from the moment it is queued and is `in_progress`
while its jobs are still appearing.

**The same defect exists one level up, so the empty case is its own answer.** Runs are not created
instantaneously either: for a few seconds after a push `actions/runs?head_sha=` returns nothing for
a workflow that is about to start. Moving from check runs to runs shrinks that window from minutes
to seconds without closing it, and a rule that reads _no run_ as _permanent_ is wrong in the same
direction. `total_count` is what separates the two - if fifteen runs exist on this head and the
producing workflow is not among them, it is **missing**; if nothing at all is there, the
measurement is early. An empty list is the one state that cannot be told from a dead instrument,
so it must never be a verdict.

**And the transient test is a complement, not a list.** `queued or in_progress` enumerates two
non-terminal states, and GitHub documents others (`waiting`, `requested`, `pending`); a run in any
of them would read permanent under an allowlist. Neither desk that wrote this paragraph has an
instance - a 300-run sample on this repository returned `completed` 292 and `in_progress` 8 and
nothing else - which is precisely why the rule is written as `status != "completed"`: it is immune
to a state we cannot enumerate from evidence.

`head_sha` needs all forty characters; a short sha silently returns `total_count: 0` with no error,
which is the same false permanent by a second route - one about timing and one about the query, and
both failing toward _edit a ruleset_. (Measured independently on a sibling repository, where ten
merge commits queried with nine-character shas returned a uniform, plausible "no CI run".)

One assumption worth naming, because it is currently true and need not stay so: **one run per
workflow per head**, so _the producing run_ is unambiguous. On this document's own head all fifteen
runs are `event: pull_request`, `run_attempt: 1`, with no workflow appearing twice. A re-run or a
`merge_group` head is where that stops holding and the rule needs the newest attempt rather than
the only one.

`neutral` is **not measurable from history**, which is a stronger statement than "not yet
measured". The `CodeQL` aggregate has concluded `neutral` on nine pull requests here - seven on
2026-08-12 where **both `Analyze` legs were `failure`** and the SARIF could not be processed, two
on 2026-08-23 where both legs were green and the base branch's recorded configuration was missing.
All nine predate `CodeQL` becoming a required context, so none of them measures what a ruleset
does with the state. And they cannot be supplemented: the Advanced Security app **rewrites its
check run in place**, keeping the id and the original `completed_at` and replacing the conclusion,
so any run that concluded `neutral` and was later rewritten to `success` leaves no trace at all.
A sweep sees where each aggregate stopped, never where it passed through. Treat `neutral` as
passing, and treat the nine as evidence that an analysis can fail while its aggregate does not.

**Which of ours can reach `skipped`: none, as of this commit.** Each required context mapped to
the job whose `name:` produces it - five carry a job-level `if:` (`always()` twice,
`always() && github.event_name != 'release'`, `github.event_name != 'schedule'` twice) and all
five evaluate true on a `pull_request`; eight carry neither a condition nor a `needs:` nor a
`paths` filter; three have no job at all because an app posts them.

**Two ways to convert one of those eight, not one.** An added `if:` is the obvious one. A `needs:`
is the other: a job with a dependency and no `if:` is skipped when that dependency skips or fails,
so the context goes green having not run. That is precisely why all three aggregates below carry
`always()`, which means the repository already knows the mechanism - it is the sentence that was
short, not the state. The check before requiring a context is therefore per context and on both
axes: the `if:` of the job whose `name:` produces it, and whether it has a `needs:` without one.

**And "none of the contexts can skip" is not "nothing can skip".** Three of the sixteen are
aggregates over stage jobs, and the platform's own answer - `skipped` passes - is re-implemented
one level down as a shell predicate, in two opposite ways:

```
CI Required          if: always()  needs: [core, repo, test, agent-disabled, migration, ops, sonar]
Storybook Required   if: always()  needs: [stories, publish]
  both:  contains(needs.*.result,'failure') || contains(needs.*.result,'cancelled') -> exit 1
         a `skipped` stage falls through to GREEN, deliberately, with the reason in the file

Supply Chain Required                                          <- the contrast, same repository
  grep -qE '"result": *"(failure|cancelled|skipped)"' -> exit 1
         a `skipped` stage FAILS the aggregate
```

Both policies are defensible where they stand - `publish` only runs on a push to `main`, and a
packages-only change legitimately skips `test`'s app shards - and this is not hypothetical: on
this document's own pull request `Storybook Required` is `success` with `Publish to GitHub Pages`
`skipped`. The point is that a reader who takes "none of the sixteen can skip" as the guarantee
has the wrong picture: the stages inside `CI Required` that can go quiet include `ops`, which is
where the full-day clinical drill runs.

Both files state their own reasoning, and quoting them exactly is the point:
`ci.yaml` at its aggregate, _"Because `skipped` passes, a stage that can skip is a stage that can
go quiet"_, and `supply-chain.yml` at its opposite one, _"Required checks treat a skipped job as
satisfied, so a failed SBOM stage silently passing its dependents is exactly what this aggregate
exists to prevent"_. Neither sentence had ever been written for the **context** level, which is
what this section is for.

### The three app-posted contexts are a fourth class

`CodeQL`, `GitGuardian Security Checks` and `Aikido Security: check code` have no job in this
repository. Two of them - GitGuardian and Aikido - depend on no workflow here at all, so their
silence modes are entirely external: an app disabled, uninstalled, or out of credits. `Aikido
Security: check code` is protection rather than decoration and has posted `failure` on real
findings repeatedly, most recently on #413 (2026-09-07, a `MEDIUM` path traversal in a script
added by that pull request, fixed rather than suppressed) - a running count is left out of this
document deliberately, because it is a number somebody then has to keep; its sibling `Aikido Deep Review` has been `skipped` for want of credits on every
run since the app was installed, and that residual is tracked in #408.

`CodeQL` is the fourth class and the one worth naming separately: **posted by an app _and_
downstream of a workflow this repository owns.** It has both silence modes.

- _App side_, invisible from here: code scanning turned off at repository or organisation level.
- _Repository side_: `codeql.yml` stops uploading. A `paths:` filter on its `on:` block or an
  `if:` on its one job leaves the aggregate unposted, and a context that never posts blocks
  every pull request into `dev`. One line, in this repository, with nothing recording the link.

That coupling is now a comment at the top of `codeql.yml`'s `jobs:` block, following the
convention `forbidden-terms.yml` already uses for the mirror hazard. `.github/codeql/codeql-config.yml`
reads `paths-ignore: []`, so the scan is not narrowed there either; both files have to stay that
way for the required context to keep meaning what it says.

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

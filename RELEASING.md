# Releasing

This document describes openrunic's branching and release model. The rationale is recorded in
[docs/adr/0003-branch-model-main-dev.md](docs/adr/0003-branch-model-main-dev.md).

## Branch model

- **`main`** is the default and release branch. It only moves via promotion PRs from `dev` and via
  hotfixes. What is on `main` is what we consider releasable.
- **`dev`** is the integration branch. **All feature and fix PRs target `dev`.**
- Both branches are protected by rulesets; the "CI Required" aggregate check must pass before
  merge.
- **Only `dev` may merge into `main`.** The "Promotion source" check refuses any pull request into
  `main` whose head is another branch, and the `main` ruleset requires that check. Rulesets cannot
  express "only this branch may be the source", so the rule lives in
  `.github/workflows/promotion-guard.yaml`.
- **Dependency updates never reach `main` directly.** Dependabot targets `dev` and pools every
  update into one pull request. Dependabot _security_ updates are disabled in repository settings
  and must stay that way: they ignore `target-branch` and open one pull request per advisory
  against the default branch. Alerts stay on, and the pooled pull request carries the fix.

```text
feature branch ──PR──> dev ──promotion PR──> main ──tag──> release
```

## Promotion: dev to main

When `dev` is in a state we want to release:

1. Open a PR from `dev` to `main` titled:

   ```text
   chore(repo): promote dev to main - <summary>
   ```

   where `<summary>` briefly describes what the promotion contains (for example
   `chore(repo): promote dev to main - patient scheduling MVP`).

2. Wait for the "CI Required" aggregate check to pass on the promotion PR.
3. Merge. Do not squash promotion PRs; preserve the commit history from `dev`.

## Hotfixes

Urgent fixes take the same route as everything else, because there is only one route:

1. Branch from `dev` (for example `hotfix/audit-event-timestamps`).
2. Open a PR targeting `dev` with a normal conventional title, e.g. `fix(api): ...`.
3. Merge it, then open a promotion PR immediately.

The cost is stated rather than hidden: a promotion carries **everything** on `dev`, so an urgent
fix also ships whatever else is sitting there unreleased. The older model - branch from `main`,
merge to `main`, back-merge into `dev` - avoided that, at the price of a second way into `main`
that skips integration. We chose the single route, and the guard enforces it.

If a genuine emergency ever needs the other shape, it is a deliberate, reviewed change rather than
a workaround: add the branch pattern to the allowed heads in
`.github/workflows/promotion-guard.yaml`, and say in the PR why this fix cannot wait for a
promotion. Do not disable the check.

## Versioning and tags

openrunic is pre-release; nothing is tagged yet. When releases begin:

- We follow [Semantic Versioning](https://semver.org/).
- Tags are created on `main` only.
- Components are tagged independently with component-scoped tags:

  ```text
  web-vX.Y.Z    # apps/web
  api-vX.Y.Z    # apps/api
  ```

  Packages (`types`, `fhir`, `database`) version with the app releases unless they are published
  independently later.

- Every tag points at a commit on `main` that passed the full CI matrix.

## Files that must stay identical on dev and main

Some files are read by GitHub from the **default branch** (`main`) regardless of which branch you
edit, or otherwise behave badly when the two branches diverge. Keep these identical on `dev` and
`main`, and include them in every promotion PR rather than editing them on `main` directly:

| File / directory                   | Why it must stay in sync                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/dependabot.yml`           | Dependabot reads only the default branch copy; a dev-only edit does nothing, and a divergent copy causes conflicts on every promotion |
| `.github/workflows/**`             | Scheduled and default-branch triggers run from `main`; drift means CI behaves differently per branch                                  |
| `.github/CODEOWNERS`               | Review routing should not depend on which branch a PR targets                                                                         |
| `.github/ISSUE_TEMPLATE/**`        | Issue forms are served from the default branch                                                                                        |
| `.github/PULL_REQUEST_TEMPLATE.md` | Served from the default branch                                                                                                        |
| `SECURITY.md`                      | The Security tab reads the default branch copy                                                                                        |

The practical rule: change these files on `dev` like everything else, then promote. Never patch
them on `main` alone, and if a hotfix touches them, back-merge immediately.

## Release checklist (once releases begin)

1. `dev` is green and contains everything intended for the release.
2. Promotion PR opened with the correct title format and merged.
3. Component tags pushed on `main`.
4. Release notes drafted from the conventional commit history since the last tag.
5. Announce as appropriate.

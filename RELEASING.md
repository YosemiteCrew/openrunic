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

openrunic's first release is **0.1.0**. It is an early release of software that is not finished:
read the capability map in [docs/emr-capabilities.md](docs/emr-capabilities.md) before installing
anything, and the "What this release does not do" section of the release notes before deploying it
anywhere near patients.

- We follow [Semantic Versioning](https://semver.org/). While the major version is `0`, a minor
  bump may carry a breaking change.
- Tags are created on `main` only.
- Components are tagged independently with component-scoped tags:

  ```text
  web-vX.Y.Z    # apps/web
  api-vX.Y.Z    # apps/api
  ```

  Packages (`types`, `fhir`, `database` and the rest of `packages/`) version with the app releases
  unless they are published independently later.

- Every tag points at a commit on `main` that passed the full CI matrix.

### Why `apps/portal` has no component tag

The patient portal ships in the source tree and its `package.json` version moves with the apps at
every release, but it deliberately has **no `portal-vX.Y.Z` tag**.

A component tag exists to publish and attest one container image. The discovery job in
`.github/workflows/release-attest.yml` finds images by looking for Dockerfiles, and the tree
contains exactly two: `apps/api/Dockerfile` and `apps/web/Dockerfile`. The portal has none, so
there is no image a portal tag could point at.

Worse than nothing, in fact. That job recognises a component-scoped tag by matching `api-v*` or
`web-v*`; an unrecognised tag is treated as unscoped and publishes **every** image it finds. A
`portal-v0.1.0` tag would therefore republish the api and web images under a portal version number,
which is the opposite of what the tag claims. The portal gets a component tag when it gets a
Dockerfile and the discovery job learns to match it, and not before.

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

## Release checklist

The order matters. Steps 2 and 3 change files, so they have to land on `dev` and travel through the
promotion; doing them afterwards means patching `main` directly, which this model does not allow.

1. `dev` is green and contains everything intended for the release.

2. **Bump the version on `dev`, before the promotion PR is opened.** Nothing in this repository
   derives a version from a tag: the version a released commit advertises is whatever is written in
   its `package.json` files. The root package and the three apps currently sit at `0.0.0`, so a tag
   pushed today would name `0.1.0` while the code inside it still says `0.0.0`, and every SBOM,
   image label and `--version` output taken from that commit would repeat the wrong number. Set the
   root `package.json` and every workspace under `apps/` and `packages/` to the release version in
   one commit on `dev`, and check the result with `git grep -n '"version"' -- '**/package.json'`.

3. **Retire the statements that say openrunic has no releases.** Several files assert it, and each
   becomes false the moment the release is published. They are not all in this document, so find
   them rather than trying to remember them:

   ```bash
   git grep -nEi "nothing (is )?(released|tagged)|no (versioned )?releases (yet|exist)"
   ```

   At the time of writing that finds `docs/verifying-releases.md`, the marketing site footer in
   `apps/web`, and the header comment in `.github/workflows/release-attest.yml`. Correct what is
   now untrue; do not delete the warnings that are still true.

4. Promotion PR opened with the correct title format and merged.

5. Component tags pushed on `main`.

6. Release notes drafted from the conventional commit history since the last tag.

7. **The release notes carry a "What this release does not do" section.** Build it from
   [docs/emr-capabilities.md](docs/emr-capabilities.md): every row whose state is not **Done** goes
   in, which means the **Seam only**, **Partial**, **Missing** and **Not startable** rows, each with
   the reason the map already gives (buildable, needs licensed content, or needs certification).
   This is the part of the notes that matters most. Someone evaluating an open-source EMR is
   deciding whether it can run their clinic, and a release note listing only what shipped invites
   them to assume the rest is there. Say what is absent in the same breath as what is present.

8. **Publish the GitHub Release.** Pushing the tag is not enough on its own: the provenance workflow
   in `.github/workflows/release-attest.yml` triggers on `release: published` (and on a manual
   `workflow_dispatch` run from the tag), not on `push: tags`. Until the release is published there
   are no container images and no signed provenance for an operator to verify with
   `gh attestation verify`, so the release exists as a tag and nothing else. Publish it against the
   tag from step 5, with the notes from steps 6 and 7.

9. Announce as appropriate.

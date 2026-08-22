# Quality gates

What CI enforces, what each gate is for, and where the judgement calls are. A gate nobody
understands is a gate somebody eventually deletes.

## React Doctor

`react-doctor` scores the React surface (`apps/web`, `apps/portal`, `packages/ui`) and reports
diagnostics: dead code, unreachable exports, circular imports, and a set of React and accessibility
rules.

- **Floor: 95.** Set in `MINIMUM_SCORE` in `.github/workflows/react-doctor.yml`. Raise it as the
  codebase improves; never lower it to land a change.
- Run it yourself with `pnpm run doctor`, or `pnpm run doctor:json` to write the full report.
- Scope exclusions live in `doctor.config.json`: build output, coverage and generated Prisma code.

### The network trade-off, stated rather than buried

**The score is computed by a remote service** operated by the tool's authors. It is not calculated
on the runner. Passing `--no-score` (alias `--no-telemetry`) disables that call, along with the
share URL and crash reporting, and the score comes back `null`.

So the score gate and a no-outbound-calls posture are mutually exclusive. This repository currently
chooses the gate.

The **diagnostics are computed locally**. If the remote call ever becomes unacceptable, most of the
value survives by switching the workflow's run step to:

```bash
pnpm exec react-doctor -y --no-score --blocking error
```

That keeps every rule and the dead-code analysis and gives up only the number. Delete the threshold
step at the same time, or it will fail on the now-null score, which it is written to do
deliberately: a gate that silently disappears when a service is unreachable is not a gate.

### Its licence, and why there is an exception for it

`react-doctor`, `oxlint-plugin-react-doctor` and `deslop-js` declare `SEE LICENSE IN LICENSE`, which
is not an SPDX identifier, so the licence-compliance gate cannot classify them and denies them by
default. That default is correct; `.grant.yaml` carries a deliberate package-level exception with
the full reasoning.

In short: all three carry a "Modified MIT License" - the MIT grant verbatim, plus two uses that need
prior written permission (using the software as ML training data, and selling or hosting it as a
service whose value derives substantially from it). Neither is engaged by running it as a dev-time
analyser. It is a devDependency, so it is not linked into or shipped with the product, and no AGPL
combination question arises.

The exception names the packages specifically rather than allow-listing the licence string, so the
permission cannot generalise to some other package that happens to ship the same nonstandard field.
Each carries an owner and a re-review date.

## The licence policy, and what an exception in it is worth

`.grant.yaml` is deny-by-default: a dependency licence is either on an allow list of SPDX
identifiers verified as AGPL-compatible, or it is a named package exception with the reason written
down.

**It currently adjudicates far fewer packages than it appears to.** The SBOM the gate reads reports
1190 of 1202 packages as having no licence, against 850 that declare one on disk, so the allow list
is deciding twelve of them. That is a defect in how the SBOM is catalogued rather than in this
policy, it is why `require-license` cannot be turned on, and it is tracked separately. Read the gate
as a floor on the packages it can see, not as coverage of the tree.

Two things an exception in that file is **not**.

It is not a finding that the licence is compatible. `elkjs` is Eclipse Public License 2.0, which is
not on the FSF GPL-compatible list, and its exception says so in as many words. What the exception
records is that no combination exists to be incompatible: it arrives under the dev-time Prisma
Studio GUI, nothing in `apps/` or `packages/` imports it, and `apps/api/Dockerfile` deletes it by
name before the image is published. Each such entry names the condition that would invalidate it.

It is not a grant of rights over third-party content either. The licensed clinical terminology this
project deliberately does not vendor - the code sets behind CPT, the VSAC value sets a quality
measure reads - is governed by its publishers, and nothing openrunic writes in a policy file changes
what a deployment may redistribute. That separation is `packages/terminology`'s subject, and
`THIRD-PARTY-NOTICES.md` records what actually ships.

## The other gates

| Gate                                   | Where                                | Enforces                                            |
| -------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| ESLint, `tsc`                          | `_core.yaml`, per affected workspace | Correctness and types                               |
| Vitest with coverage floors            | `_test.yaml`, `COVERAGE_FLOORS`      | Test coverage per app                               |
| SonarCloud                             | `_sonar.yaml`                        | 95% coverage, zero duplication, zero open issues    |
| CodeQL                                 | `codeql.yml`                         | Semantic security analysis                          |
| Gitleaks, GitGuardian, secret scanning | `secret-scan.yml`, apps              | Committed secrets                                   |
| syft, grype, grant                     | `supply-chain.yml`                   | SBOM, dependency vulnerabilities, licence policy    |
| Dependency review                      | `dependency-review.yml`              | New vulnerable or badly-licensed dependencies       |
| OpenSSF Scorecard                      | `scorecard.yml`                      | Supply-chain posture, published                     |
| Storybook + axe                        | `storybook.yml`                      | Every story renders and passes accessibility checks |
| Promotion source                       | `promotion-guard.yaml`               | Only `dev` may merge into `main`                    |

`CI Required` and `Supply Chain Required` are fail-closed aggregates: a skipped dependency passes,
a cancelled one fails. Do not edit an aggregate to make a branch green.

## The Sonar bar, and why it is not a quality gate

Every scanned app is held to three numbers:

| Measure                                | Limit  |
| -------------------------------------- | ------ |
| `coverage`                             | >= 95% |
| `duplicated_lines_density`             | 0%     |
| `violations` (open issues of any kind) | 0      |

Three projects are scanned: `yosemitecrew_openrunic_Web`, `_Api` and `_Portal`, each configured by
the `sonar-project.properties` in its app directory.

The obvious place to state those numbers is a SonarCloud quality gate, and that is not where they
live. Attaching a custom gate to a project needs a plan this organisation does not have -
`api/qualitygates/select` answers `Organization ... is not allowed to modify Quality gates` - so the
only verdict SonarCloud will produce is the built-in **Sonar way**: 80% coverage and 3% duplication
on new code, ratings at A, hotspots reviewed, and no condition on the issue count at all.

`_sonar.yaml` still waits on that gate, because ratings and hotspot review are real checks and cost
nothing to keep. The three numbers above are then enforced by `scripts/ci/sonar-thresholds.mjs`,
which reads the measures the analysis just published and fails the job when any of them is missed.

Enforcing them in the job rather than on the server also closes two gaps that any gate written
against new code has by construction:

- A pull request analysis evaluates **new-code conditions only**, and drops even those when the
  pull request introduces no new lines. A change can pass a green gate while the project as a whole
  sits well below the bar.
- Sonar way has no issue condition, so a project accumulating smells passes it indefinitely as long
  as each individual change is clean.

What the three measures mean depends on the analysis scope, verified against live analyses rather
than assumed:

- A push to `main` analyses the main branch, and all three measures are whole-branch figures: the
  project as a whole must sit at 95% coverage, zero duplication and zero open issues.
- A pull request analysis publishes whole-project `coverage` and `duplicated_lines_density` as of
  the PR head, while its `violations` counts the issues open on the pull request itself. A PR leg
  therefore enforces that the whole project meets the coverage and duplication bar and that the
  change introduces zero issues; the whole-branch zero-issues condition is carried by the
  push-to-`main` scan.

A measure the analysis did not publish fails the check rather than passing it. Sonar publishes no
`coverage` at all when it resolved no coverage report, and reading that absence as either zero or as
fine would turn a broken pipeline into a verdict.

To move a number, edit the flags in the "Enforce the openrunic Sonar bar" step and this table
together. To exempt a specific finding, the exclusion goes in the app's `sonar-project.properties`
with its rationale and revisit condition, the way the entries there already do - never by lowering
one of these three.

## Which gates block a merge

A gate that cannot block is a gate that reports. Both are useful, but only one of them stops
something reaching a clinic, and the difference has to be a decision rather than an accident of which
integration happened to be wired first.

These are **required** on both `dev` and `main`, and a red one makes a pull request unmergeable:

| Check                               | What it stops                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CI Required`                       | The aggregate: lint, types, tests, coverage floors, migrations, the agent-disabled build, the ops drills |
| `Detect secrets (Gitleaks)`         | A credential entering the history                                                                        |
| `GitGuardian Security Checks`       | A credential entering the history, from a second vendor with different detectors                         |
| `Aikido Security: check code`       | SAST findings in application and infrastructure code                                                     |
| `Promotion source` (on `main` only) | Anything reaching `main` other than a promotion of `dev`                                                 |

Two scanners for secrets is deliberate rather than redundant. They disagree: Gitleaks matches
patterns, GitGuardian scores entropy and validates some findings against live services, and each has
caught things the other did not. In a repository that will hold clinical records, the cost of running
both is a few seconds per pull request and the cost of running one is finding out later which one
had the blind spot.

**Aikido and GitGuardian were advisory until 2026-08-14.** That was wrong for what this project is:
"the security scanner is red but the merge went through" is a sentence that should not be possible in
a health record system, whatever the finding turns out to be. Making them required means a false
positive now blocks a merge until somebody looks at it, which is the intended cost - the alternative
is a red badge nobody has to answer for.

The exception process below is what keeps that cost bounded: a verified false positive is recorded,
with its reasoning and a revisit condition, and stops blocking. What it does not do is stop being
read.

## Dependency upgrades

Three rules, each learned from a grouped bump that carried thirteen updates and four independent
breaks.

**`engines.node` states what CI tests, not what happens to work.** It reads `^22.12`, matching
`.nvmrc` and the Node the workflows install. It used to read `>=22.12`, which admitted Node 25 and
26 - versions nothing here has ever run. A contributor on one of those gets a local result that
disagrees with CI, and the disagreement is invisible: during that bump a failure was diagnosed twice
as "an artifact of my local Node" and was neither time. Say the supported range and let the install
refuse rather than let the drift happen quietly.

**Majors arrive in their own pull request.** Minor and patch updates - which are nearly always safe,
and which carry most security fixes - stay pooled and land quickly. Majors are the ones that break,
and pooling them meant one broken major held every routine patch behind it, while a failing build
skipped the test stage so the breaks surfaced one CI cycle at a time. Separated by blast radius, a
broken major now blocks only itself.

**A held major is re-tested monthly, not just annotated.** Every `ignore` entry in
`.github/dependabot.yml` carries a reason and a revisit condition. A revisit condition nobody
evaluates is not a plan - it is how a repository stops upgrading without deciding to.
`.github/workflows/deferred-deps.yml` installs the newest version of each held package, runs the gate
that failed, and writes the answer into one tracking issue. It opens no pull request: a green result
is evidence that an upgrade is worth attempting, not permission to take it unread.

## Where each gate's exceptions live

A suppression is only defensible if the next reader can find it and see why. Every exception in
this repository sits beside the gate it applies to, names what was verified, and carries a revisit
condition.

| Gate                    | Exceptions file                                            |
| ----------------------- | ---------------------------------------------------------- |
| Sonar                   | `apps/<app>/sonar-project.properties`, one per scanned app |
| Licence policy (grant)  | `.grant.yaml`                                              |
| Workflow audit (zizmor) | `.github/zizmor.yml`                                       |
| GitGuardian             | `.gitguardian.yaml`                                        |
| Trivy / IaC             | `.trivyignore`                                             |

`.gitguardian.yaml` ignores **matches, never paths**. Path-ignoring a file means a real credential
pasted there later goes unreported, and the file we would most be tempted to ignore is a test about
credential handling: exactly where a real one is most likely to land by accident.

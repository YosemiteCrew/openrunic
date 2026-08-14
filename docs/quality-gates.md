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

`react-doctor` and `oxlint-plugin-react-doctor` declare `SEE LICENSE IN LICENSE`, which is not an
SPDX identifier, so the licence-compliance gate cannot classify them and denies them by default.
That default is correct; `.grant.yaml` carries a deliberate package-level exception with the full
reasoning.

In short: both carry a "Modified MIT License" - the MIT grant verbatim, plus two uses that need
prior written permission (using the software as ML training data, and selling or hosting it as a
service whose value derives substantially from it). Neither is engaged by running it as a dev-time
analyser. It is a devDependency, so it is not linked into or shipped with the product, and no AGPL
combination question arises.

The exception names the two packages specifically rather than allow-listing the licence string, so
the permission cannot generalise to some other package that happens to ship the same nonstandard
field. It carries an owner and a re-review date.

## The other gates

| Gate                                   | Where                                | Enforces                                            |
| -------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| ESLint, `tsc`                          | `_core.yaml`, per affected workspace | Correctness and types                               |
| Vitest with coverage floors            | `_test.yaml`, `COVERAGE_FLOORS`      | Test coverage per app                               |
| SonarCloud                             | `_sonar.yaml`                        | Smells, duplication, reliability, security ratings  |
| CodeQL                                 | `codeql.yml`                         | Semantic security analysis                          |
| Gitleaks, GitGuardian, secret scanning | `secret-scan.yml`, apps              | Committed secrets                                   |
| syft, grype, grant                     | `supply-chain.yml`                   | SBOM, dependency vulnerabilities, licence policy    |
| Dependency review                      | `dependency-review.yml`              | New vulnerable or badly-licensed dependencies       |
| OpenSSF Scorecard                      | `scorecard.yml`                      | Supply-chain posture, published                     |
| Storybook + axe                        | `storybook.yml`                      | Every story renders and passes accessibility checks |
| Promotion source                       | `promotion-guard.yaml`               | Only `dev` may merge into `main`                    |

`CI Required` and `Supply Chain Required` are fail-closed aggregates: a skipped dependency passes,
a cancelled one fails. Do not edit an aggregate to make a branch green.

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

## Where each gate's exceptions live

A suppression is only defensible if the next reader can find it and see why. Every exception in
this repository sits beside the gate it applies to, names what was verified, and carries a revisit
condition.

| Gate                    | Exceptions file                                                          |
| ----------------------- | ------------------------------------------------------------------------ |
| Sonar                   | `apps/web/sonar-project.properties`, `apps/api/sonar-project.properties` |
| Licence policy (grant)  | `.grant.yaml`                                                            |
| Workflow audit (zizmor) | `.github/zizmor.yml`                                                     |
| GitGuardian             | `.gitguardian.yaml`                                                      |
| Trivy / IaC             | `.trivyignore`                                                           |

`.gitguardian.yaml` ignores **matches, never paths**. Path-ignoring a file means a real credential
pasted there later goes unreported, and the file we would most be tempted to ignore is a test about
credential handling: exactly where a real one is most likely to land by accident.

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

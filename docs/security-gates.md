# Security gates

Every automated control that runs against a change, what it protects, and where its exception
process lives. If you are here because a gate failed, find it in the table and read its row.

Nothing in this document is aspirational: each gate is a workflow in `.github/workflows/` that runs
today. Where a gate is dormant because the files it inspects have not been written yet, that is
stated explicitly.

## The gates

| Gate                                             | Workflow                | Protects against                                                  | Exceptions                               |
| ------------------------------------------------ | ----------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| CodeQL                                           | `codeql.yml`            | Injection, unsafe deserialisation, and the rest of the SAST set   | Dismiss in the Security tab              |
| Secret scan (Gitleaks)                           | `secret-scan.yml`       | Credentials committed to history                                  | None: rotate, do not allowlist           |
| Dependency review                                | `dependency-review.yml` | A pull request introducing a vulnerable or badly-licensed package | Change the dependency                    |
| SBOM, dependency vulnerabilities, licence policy | `supply-chain.yml`      | Known CVEs in dependencies; non-AGPL-compatible licences          | `.grype.yaml`, `.grant.yaml`             |
| **Container image vulnerabilities**              | `container-scan.yml`    | CVEs in the operating-system layer of the images clinics install  | `.grype.yaml` (shared)                   |
| **Infrastructure misconfiguration**              | `iac-scan.yml`          | Production-hostile container and Compose defaults                 | `.trivyignore`                           |
| **Workflow security**                            | `workflow-audit.yml`    | Template injection, credential persistence, over-broad tokens     | `.github/zizmor.yml`                     |
| **Synthetic data only**                          | `phi-guard.yml`         | Real patient data reaching the repository                         | Allowlists in `scripts/ci/phi-guard.mjs` |
| **Release provenance**                           | `release-attest.yml`    | An operator installing an image nobody can trace                  | Not applicable                           |
| PR governance                                    | `pr-governance.yml`     | Untitled or unscoped changes entering history                     | None                                     |

The five in bold are the subject of the rest of this page. The others are documented where they are
configured.

## Container image vulnerabilities

`supply-chain.yml` runs `syft scan dir:.`, which inventories the **dependency tree**. It never sees a
built image, so the operating-system packages in the base layer - openssl, zlib, busybox, the
packages CVEs are actually filed against - were scanned by nothing.

That matters more here than in a typical project: openrunic ships images that clinics install and
run on their own hardware. A vulnerable base layer is a vulnerable hospital server.

`container-scan.yml` builds every Dockerfile in the tree and runs grype over the resulting image with
`--fail-on critical`, the same threshold `supply-chain.yml` uses for dependencies. grype rather than
another scanner so both gates share one vulnerability database, one severity vocabulary, and one
exception file (`.grype.yaml`).

It also runs weekly on a schedule, because a base layer becomes vulnerable when a CVE is published,
not when somebody commits.

**Currently dormant.** No Dockerfile exists on this branch yet. Discovery exits 0 with an explanatory
message, and the gate starts working on the first pull request that adds one - there is no switch to
remember to flip.

## Infrastructure misconfiguration

Two scanners, for a reason worth knowing before you go looking for the second one:

- **Trivy in config mode** covers Dockerfiles, and Kubernetes, Terraform, Helm and CloudFormation if
  any of those arrive. It fails the build on MEDIUM and above, which catches a root user, a missing
  `USER` directive, privileged mode and an unpinned base image tag. A missing `HEALTHCHECK` is LOW
  and is reported without failing.
- **`scripts/ci/compose-guard.mjs`** covers the Compose file, because Trivy has no Docker Compose
  policy set - `trivy config docker-compose.yml` reports the file as "not scanned" - and Checkov has
  no `docker_compose` framework either. The Compose file is what decides whether a clinic's Postgres
  is reachable from the internet, so leaving it to nothing was not an option.

What the Compose guard checks, and why each one:

| Check                       | Severity | Why                                                                    |
| --------------------------- | -------- | ---------------------------------------------------------------------- |
| `privileged-container`      | critical | Privileged is the host kernel; one application bug becomes host access |
| `secret-in-environment`     | critical | A literal credential in a file that ships in the repository            |
| `docker-socket-mount`       | critical | The Docker socket is root on the host by another name                  |
| `datastore-port-published`  | high     | A database bound to every interface rather than to loopback            |
| `host-namespace`            | high     | `network_mode`/`pid`/`ipc: host` removes the isolation                 |
| `dangerous-capability`      | high     | `SYS_ADMIN` and friends are privileged with extra steps                |
| `unpinned-image`            | high     | `:latest` means every clinic runs something slightly different         |
| `no-user` / `root-user`     | high     | The container runs as root unless told otherwise                       |
| `writable-root-filesystem`  | low      | `read_only: true` makes a foothold much harder to keep                 |
| `no-new-privileges-missing` | low      | A setuid binary inside the container can still escalate                |
| `no-healthcheck`            | low      | An operator cannot tell a hung container from a healthy one            |

The guard reads the Compose file as JSON, converted by a pinned, checksum-verified `yq`. It does not
parse YAML itself, because hand-rolled parsing is how static analysis quietly starts passing files it
never understood. Its unit tests (`scripts/ci/compose-guard.test.mjs`) run on **every** pull request,
even while no Compose file exists, so a regression in the guard is caught by the change that causes
it.

Run it locally:

```bash
yq -o=json '.' docker-compose.yml | node scripts/ci/compose-guard.mjs -
pnpm run check:compose:test
```

**Currently dormant** for the same reason as the container scan, with the same automatic activation.

## Workflow security

`actionlint` checks whether a workflow is **correct**. It does not check whether a workflow is
**safe**. This repository has roughly 1,700 lines of workflow YAML, much of it handling untrusted
pull-request input, and the failures that matter there are template injection through
`${{ github.event.* }}` interpolated into a `run:` block, credential persistence leaving
`GITHUB_TOKEN` in `.git/config`, over-broad token permissions, and `pull_request_target` misuse.

`workflow-audit.yml` runs zizmor at the `pedantic` persona, failing on LOW and above. Pedantic is
deliberate: it is what enforces the conventions this repository already writes down - least-privilege
permissions on every job, a documented reason for every permission beyond `contents: read`, and
pinned container images.

Findings that cannot be fixed from the branch that added this gate are allowlisted in
`.github/zizmor.yml`, each with a reason and a revisit condition. So the allowlist cannot quietly
become a graveyard, the workflow also runs the audit a second time with `--no-config` and writes the
unfiltered result into the job summary: suppressed findings stay visible on every run, they just do
not fail the build.

Run it locally:

```bash
uvx zizmor@1.17.0 --persona=pedantic --min-severity=low .github/
```

## Synthetic data only

The rule is in `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md`: synthetic patient data only, never
real PHI or PII, in tests, fixtures, seeds, screenshots or logs. `phi-guard.yml` enforces it.

Contributor-facing detail - what trips it and how to write fixtures that will not - is in the
["Synthetic data only" section of CONTRIBUTING.md](../CONTRIBUTING.md#synthetic-data-only). The
rationale for every rule and every allowlist entry is in `scripts/ci/phi-guard.mjs` itself.

The design constraint worth repeating here: a naive regex sweep over a medical codebase produces
overwhelming false positives, and a gate that cries wolf gets switched off within a week, which is
strictly worse than no gate. So every rule answers one question - what distinguishes real patient
data from the synthetic data this repository legitimately contains - and the guard's unit tests
assert both halves: that each rule catches its shape, and that it stays silent on the repository's
real fixtures.

## Release provenance

See [verifying-releases.md](verifying-releases.md) for the operator-facing side: what is published,
and the exact command to verify an image before installing it.

`release-attest.yml` runs on `release: published` only. It builds each image from the released tag,
pushes it to the container registry, and records a Sigstore-signed SLSA provenance attestation bound
to the image digest. It never runs on a pull request, and it exits cleanly when the tree has no
Dockerfile, so it cannot fail a release that has no images.

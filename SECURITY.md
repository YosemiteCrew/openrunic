# Security Policy

openrunic is health software. Vulnerabilities in this codebase may expose protected health
information (PHI) in downstream deployments, so we treat every report with high urgency and we are
grateful to researchers who report responsibly.

## Supported versions

openrunic is pre-release. There are no versioned releases yet; only the current state of the
`dev` and `main` branches is supported. Once releases begin, this table will list supported
release lines.

| Branch / version | Supported |
| ---------------- | --------- |
| `main`           | Yes       |
| `dev`            | Yes       |
| Anything else    | No        |

## Reporting a vulnerability

**Primary channel**: use GitHub's private vulnerability reporting. Go to the repository's
**Security** tab and click **"Report a vulnerability"**. This keeps the report private between you
and the maintainers and gives us a shared workspace to fix it.

**Fallback**: if you cannot use GitHub's reporting flow, email
[security@yosemitecrew.com](mailto:security@yosemitecrew.com).

Please do **not** report vulnerabilities through public issues, discussions, or pull requests.

Include what you can: affected component, reproduction steps or proof of concept, impact
assessment, and any suggested fix. Partial reports are welcome; do not sit on a finding because
the write-up is not polished.

## What to expect

- **Acknowledgement within 2 business days** of your report.
- A maintainer will triage the report, keep you informed of progress, and credit you in the fix
  (unless you prefer otherwise).
- **Coordinated disclosure**: we ask that you give us up to **90 days** from acknowledgement to
  ship a fix before any public disclosure. We will usually be much faster, and we are happy to
  coordinate on a timeline if the fix is complex.

## Safe harbor

We will not pursue or support legal action against you for good-faith security research that:

- stays within the scope described below,
- avoids privacy violations, data destruction, and service degradation for others,
- does not exfiltrate more data than needed to demonstrate the issue, and
- gives us reasonable time to remediate before disclosure.

If you are ever unsure whether something is in scope, ask first via the reporting channels above.

## Scope

**In scope**: vulnerabilities in the code in this repository (apps, packages, CI configuration)
and in official release artifacts once they exist.

**Out of scope**:

- Issues in third-party deployments of openrunic that we do not operate. Report those to the
  deployment's operator; they control the environment, configuration, and data.
- Social engineering, phishing, or physical attacks against maintainers or contributors.
- Denial of service via volumetric traffic.
- Vulnerabilities in third-party dependencies with no demonstrated impact on openrunic (report
  upstream, though a heads-up is appreciated).

## Bug bounty

There is no bug bounty program at this time. We still deeply appreciate reports and will credit
researchers in release notes and advisories.

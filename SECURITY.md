# Security Policy

openrunic is health software. Vulnerabilities in this codebase may expose protected health
information (PHI) in downstream deployments, so we treat every report with high urgency and we are
grateful to researchers who report responsibly.

## Supported versions

openrunic follows [Semantic Versioning](https://semver.org/).

Security fixes are made on the **most recent release line only**. There is no long-term-support
line and nothing is backported to an older minor. With a `0.x` major and a small maintainer group,
a support promise we cannot keep would be worse than an honest one, so the remedy for an older
install is always to upgrade. Security fixes are free of charge.

| Release line                       | Supported                                                              |
| ---------------------------------- | ---------------------------------------------------------------------- |
| The most recent minor release line | Yes                                                                    |
| Every earlier line                 | No. A line stops receiving fixes the day the next minor ships          |
| `dev` and `main` branches          | Yes. Fixes land here first and reach installations in the next release |

Which line that is appears on the
[Releases page](https://github.com/YosemiteCrew/openrunic/releases), not here.

Two consequences worth stating plainly. Because the major version is `0`, upgrading to collect a
security fix can mean absorbing a breaking change; that is a real cost, and you should not first
meet it during an incident. And an unreleased fix already sitting on `dev` or `main` is visible in
public git history before any release carries it, so track releases rather than waiting to be told.

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

## How fixes are announced

Once a fix is released, we publish a security advisory on this repository and list the fix in the
release notes. The advisory names the affected versions, the impact and severity, and how to
update.

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

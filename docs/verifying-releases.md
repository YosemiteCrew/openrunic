# Verifying a release before you install it

openrunic is a self-hosted EMR. The images you pull run on your hardware and hold your patients'
records, so before you install one you should be able to answer a simple question: **was this image
built from the openrunic source, by openrunic's CI, or by somebody who pushed a tag to a registry?**

This page is how you answer that.

> **Status:** nothing is released yet. The commands below are the ones that will work from the first
> release onwards; there is no tag to try them against today.

## What is published

For every release, CI publishes:

| Artefact                     | Where                                 | Produced by                            |
| ---------------------------- | ------------------------------------- | -------------------------------------- |
| Container images             | `ghcr.io/yosemitecrew/openrunic-*`    | `.github/workflows/release-attest.yml` |
| Build provenance attestation | Alongside each image, in the registry | `.github/workflows/release-attest.yml` |
| SBOMs (SPDX and CycloneDX)   | Attached to the GitHub release        | `.github/workflows/supply-chain.yml`   |

The provenance attestation is an in-toto SLSA statement, signed through Sigstore's keyless flow
(a short-lived certificate issued by Fulcio, recorded in the Rekor transparency log) and bound to
the image **digest** rather than its tag. A tag can be moved after the fact; a digest cannot.

## Verify an image

You need the [GitHub CLI](https://cli.github.com/) (`gh` 2.49 or later), signed in or not - the
verification is against public transparency-log data.

```bash
gh attestation verify \
  oci://ghcr.io/yosemitecrew/openrunic-api:1.0.0 \
  --repo YosemiteCrew/openrunic
```

A successful run prints the predicate type, the workflow that built the image, and the commit it was
built from. If verification fails, **do not install the image** - either it was not built by this
repository, or it was modified after it was built.

To pin what you install to exactly what you verified, resolve the digest first and use that
everywhere:

```bash
DIGEST=$(docker buildx imagetools inspect \
  ghcr.io/yosemitecrew/openrunic-api:1.0.0 --format '{{.Manifest.Digest}}')

gh attestation verify \
  "oci://ghcr.io/yosemitecrew/openrunic-api@${DIGEST}" \
  --repo YosemiteCrew/openrunic

docker pull "ghcr.io/yosemitecrew/openrunic-api@${DIGEST}"
```

### Tightening the check

By default the command above accepts any workflow in this repository. If you want to assert that a
specific workflow produced the image - which is what you actually care about - add the signer
identity:

```bash
gh attestation verify \
  "oci://ghcr.io/yosemitecrew/openrunic-api@${DIGEST}" \
  --repo YosemiteCrew/openrunic \
  --signer-workflow YosemiteCrew/openrunic/.github/workflows/release-attest.yml
```

### Without the GitHub CLI

`cosign` can read the same attestation from the registry:

```bash
cosign verify-attestation \
  --type slsaprovenance \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/YosemiteCrew/openrunic/' \
  "ghcr.io/yosemitecrew/openrunic-api@${DIGEST}"
```

## Verify the SBOM

Each release also carries an SPDX and a CycloneDX SBOM of the source tree, attached as release
assets. To see what is in a release before installing it:

```bash
gh release download 1.0.0 --repo YosemiteCrew/openrunic --pattern 'openrunic.spdx.json'
grype sbom:openrunic.spdx.json
```

That is the same scan CI runs, against the same file, so you can reproduce the gate rather than
trust it.

## What this does not do

Being precise about this matters more than sounding complete.

- **The image itself is not separately signed.** The provenance _statement_ is signed - that is what
  Sigstore keyless signing produces, and it is what `gh attestation verify` checks - but there is no
  detached `cosign sign` signature over the image manifest in addition to it. Adding one is worth
  doing; it is deferred until the release process itself is settled, because a signature nobody has
  been told how to verify is decoration rather than security. When it lands, the command will be
  documented here alongside the ones above.
- **Provenance says where an image came from, not that it is safe.** It proves the build ran in this
  repository from a given commit. Whether that commit is good is what code review, CodeQL, the
  dependency and container scans, and the licence policy are for.
- **Nothing here protects you from a compromised base image at build time.** The container scan
  (`.github/workflows/container-scan.yml`) is the control for that, and it runs on a schedule as
  well as on every change, because a base layer can become vulnerable without anyone committing
  anything.

## If verification fails

Treat it as an incident, not a tooling problem:

1. Do not install or run the image.
2. Do not delete it - the digest is evidence.
3. Report it privately following [SECURITY.md](../SECURITY.md).

# 0004. No ML runtime in the core deployment

## Status

Accepted

Amended by [ADR-0005](0005-agentic-layer.md), narrowly and in one clause only. ADR-0005 defines a
deployer-configured remote inference endpoint as a new adapter class and amends "never on the
request path" to read "never on a **clinical** request path" for that class alone. Everything else
below stands unchanged, and the prohibition on an in-image ML runtime - no weights, no Python, no
second language runtime, no in-image inference - is preserved in full. This ADR is not superseded.

## Date

2026-08-13

## Context

Clinical NLP toolkits are now good enough to be tempting. A local-first suite of clinical
named-entity-recognition and PII de-identification models was evaluated for six candidate uses:
guarding CI against real patient data, de-identifying support bundles, explaining clinical terms to
patients, extracting problems and medications from outside records, drafting notes, and searching
notes.

The evaluation surfaced four constraints that matter more than the capability itself.

**Runtime shape.** These toolkits are Python and PyTorch. ADR-0002 already rejected an external
FHIR server because it dragged a heavyweight JVM dependency into an otherwise Node-only stack. A
Python and PyTorch runtime is the same decision, and it lands on the same target: a clinic must be
able to run this with `docker compose up` on a stock Linux box, from install to first appointment
in under thirty minutes.

**Licence provenance.** The SDKs are Apache-2.0, which is one-way compatible with AGPL-3.0-only and
already on our allow list. Model weights are a different question. Several widely published
biomedical models are domain-adapted on corpora that include credentialed clinical data whose
licence forbids redistribution, and are then published under a permissive tag with no documented
chain of title. That is structurally the same problem as vendoring terminology content, and this
project's differentiator is precisely that it does not do that.

**Deployability.** The clinically useful models are 434M parameters and roughly 870MB on disk; the
strongest PII model is larger still. The vendor's own device tiers place them at workstation class,
and their own ARM benchmark shows p95 latency of about 1.5 seconds for a single short message on a
much smaller model. A browser path for patients needs roughly 800MB of download and about 1GB of
device storage before it renders anything.

**Regulatory line.** Extraction that displays information already present in a source document, and
de-identification, are not medical-device functions. Ranking findings by clinical risk, inferring
anything not stated in the source, auto-committing extracted values without human review, or
directing clinical interpretation at a patient rather than a clinician, all move toward device
classification. Patient-facing interpretation is the weakest position of all, because the
non-device decision-support carve-out is written around supporting a clinician.

## Decision

We will not put a machine-learning runtime inside the core deployment.

Machine learning, if it ever ships, arrives as an **optional, out-of-process adapter** behind the
existing partner-adapter seam: a separate container, opt-in, never on the request path, and never
required for the product to run.

Specifically:

- Plain-language explanation of clinical terms is served by a curated code-to-plain-language
  mapping keyed on the codes we already store, not by a model.
- Search over notes uses Postgres full-text search, which the relational canonical model gives us
  for free.
- Extraction from outside records begins with structured import and a human reconciliation surface.
  A model may later pre-highlight candidates for that human, never commit on their behalf.
- Note drafting remains a seam, not a bundled model, as the product scope already states.
- Enforcing the synthetic-data-only rule is a provenance problem, not a detection problem. A model
  that flags text shaped like patient data flags correct synthetic fixtures too, so it would report
  almost nothing but false positives on a healthy repository.

If an adapter is ever adopted, these rules bind it: never auto-commit to the chart, always display
the source span so a clinician can review the basis, never rank by clinical risk, never emit
content absent from the source, and state the intended purpose as documentation support.

## Consequences

### Good

- The self-host story stays one `docker compose up` on a stock Linux box, and the install-time bar
  stays reachable.
- No licence-encumbered model weights can enter the repository or the image, which keeps the
  bring-your-own-content posture intact for weights exactly as it already is for terminology.
- The product stays clearly outside medical-device classification, which is an explicit
  out-of-scope-forever commitment.
- The supply-chain gate keeps meaning what it says. Our SBOM is generated from the package tree; a
  Python environment would be invisible to it, so adopting one without extending SBOM coverage
  would leave the most sensitive dependency unscanned.

### Bad, accepted

- Unstructured outside records still require a human to read and code them. That is real work we
  are choosing not to automate yet.
- Free-text patient identifiers in prose (a name mid-sentence inside an exception payload) cannot
  be caught by deterministic redaction alone. We accept that residual and address it by not logging
  free text in the first place.
- If a future certification or partner integration requires on-premise inference, this decision
  will need revisiting through a new ADR rather than an incremental change.

## Alternatives considered

**Adopt a clinical NLP toolkit in-process.** Rejected: it contradicts ADR-0002's precedent, doubles
the operational surface of a self-host install, and makes the deployment depend on a project with a
single dominant maintainer and a fast-growing surface area.

**Ship a model to the patient's browser for plain-language explanations.** Rejected on three
independent grounds: the download and storage cost on a mid-range phone, the regulatory position of
patient-directed interpretation, and the fact that entity recognition locates a term without
explaining it, so a curated mapping is needed regardless.

**Use a model as a pre-commit or CI guard for real patient data.** Rejected: correct synthetic data
is deliberately shaped like real patient data, so precision approaches zero and the gate would be
muted within a week. Provenance controls and the existing deterministic secret scanning are the
right tools.

**Do nothing and leave the question open.** Rejected: the capability is tempting enough that
without a written rule it would be adopted incidentally, one screen at a time.

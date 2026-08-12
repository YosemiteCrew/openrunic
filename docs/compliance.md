# Regulatory posture

This page states openrunic's position on healthcare regulation, for contributors and for anyone
evaluating the software. It is deliberately conservative: we claim nothing we cannot demonstrate.

## What openrunic is not

- **Not a medical device.** openrunic is not certified, cleared, or approved by the FDA, by an EU
  MDR notified body, or by any other regulator, and it is not intended to provide medical advice,
  diagnosis, or treatment recommendations.
- **Not a certified EHR.** openrunic holds no ONC Health IT Certification and no equivalent
  national certification.
- **Not HIPAA-compliant or GDPR-compliant out of the box.** Compliance is a property of a
  deployment: the organization, its agreements (for example HIPAA BAAs), its configuration, its
  operational practices, and its jurisdiction. Source code cannot be "HIPAA-compliant" by itself,
  and we do not describe openrunic that way anywhere. Deployers are responsible for their own
  regulatory obligations, including GDPR Article 9 safeguards for health data and any local law.

## Design principles

While openrunic cannot make a deployment compliant, it is designed so that a competent deployer
can build a compliant deployment on top of it:

- **Audit logging from day one.** The first model in `packages/database` is `AuditEvent`.
  Security-relevant actions (who did what, to which record, when) are recorded as a core feature,
  not a bolt-on, because access accounting is a baseline expectation in every healthcare
  regulatory regime.
- **Least-privilege access design.** Authorization is designed around granting the minimum access
  a role needs, and access decisions are auditable.
- **Encryption guidance, not assumptions.** Deployments are expected to use TLS in transit and
  encryption at rest (Postgres-level or disk-level); documentation will state this explicitly
  rather than assuming a hosting provider handles it.
- **No telemetry that exfiltrates health data.** openrunic does not phone home with patient data.
  Any future telemetry must be opt-in, documented, and structurally incapable of carrying PHI.

## The synthetic data rule

No real patient data (PHI/PII) may ever appear in this repository or its surrounding spaces:
issues, PRs, commit messages, code, tests, fixtures, seed data, screenshots, or logs. Use
obviously synthetic data such as Synthea-generated records or invented identities like
"Testina Patientsson". Anything containing real data is scrubbed on sight and treated as an
incident. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full policy.

## Interoperability roadmap notes

Findings that shape the FHIR boundary (researched August 2026):

- **FHIR R4 (4.0.1) exclusively.** US Core/USCDI and the HL7 Europe EHDS implementation guides
  are all R4-based; R4B and R5 have no regulatory driver. The next regulatory jump is R6
  (US Core v10 + USCDI v7, expected around May 2027). Resource handling stays behind the mapping
  layer in `packages/fhir` so a future R4-to-R6 migration is a mapper change, not a rewrite.
- **Terminology is bring-your-own.** SNOMED CT content is license-restricted and must never be
  vendored into this repository. Terminology support will be a pluggable service interface
  (for example Snowstorm Lite, HAPI terminology, or tx.fhir.org). LOINC, ICD-10-CM, and RxNorm
  have friendlier licensing but still ship as deployment-time content, not repo content.
- **Auth: OIDC first, SMART on FHIR later.** First-party apps use plain OIDC with role-based
  access. SMART App Launch (v2 granular scopes) and SMART Backend Services come when third-party
  apps and bulk export arrive; the data-access layer is designed to enforce scope-to-filter rules
  from the start so that layering is additive.

## Future considerations, not current claims

Two regulatory tracks inform openrunic's architecture (notably the decision to expose FHIR R4 at
the API boundary, see [ADR-0002](adr/0002-relational-postgres-fhir-boundary.md)), but neither is a
claim we make today:

- **US: ONC certification.** Criteria such as §170.315(g)(10) (standardized FHIR API) shape what
  our API surface should be able to do. Pursuing certification is a possible future milestone, not
  a current status.
- **EU: European Health Data Space (EHDS).** EHDS will impose interoperability and access
  requirements on EHR systems in the EU. We track it as a design input; openrunic makes no EHDS
  conformance claim.

If you see wording anywhere in this project that overstates our regulatory status, treat it as a
bug and open an issue.

# EMR capability map

What this system does, what it does not, and for each gap the honest reason. Written because
"an EMR" is a category with about two hundred features in it, and a roadmap that says "build the EMR"
tells nobody what is left.

Three kinds of gap appear below, and they are not the same kind of work:

- **Buildable** - needs engineering time and nothing else.
- **Needs licensed content** - the code is easy, the data is not ours to ship. Drug interaction
  databases (First Databank, Medi-Span), full SNOMED CT, CPT and ICD-10 code sets are commercial
  licences. AGPL software cannot bundle them, so the pattern is always the same: build the seam, let
  the deployer supply the content.
- **Needs certification** - cannot be switched on by writing code at all. Electronic prescribing of
  controlled substances requires DEA-audited identity proofing and a certified application; routing
  prescriptions to pharmacies requires Surescripts certification; ONC certification requires a
  testing body.

## Clinical core

| Capability                                | State         | Note                                                                                                                                                                     |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Patient registration, demographics        | **Done**      | Plus identifiers, related persons, coverage                                                                                                                              |
| Scheduling, flow board                    | **Done**      | Day view, check-in, rooming, status flow                                                                                                                                 |
| Encounters, clinical notes                | **Done**      | Sign, lock, addenda with author attribution                                                                                                                              |
| Problem list, allergies, medications      | **Done**      | Coded, with FHIR mappers                                                                                                                                                 |
| Orders, specimens, results                | **Done**      | Order lifecycle, result review and sign                                                                                                                                  |
| Immunisations                             | **Done**      | Recorded and mapped; registry submission below                                                                                                                           |
| **Allergy screening at prescribing**      | **Done**      | `packages/clinical-safety`, warns and requires acknowledgement on HIGH criticality                                                                                       |
| **Duplicate therapy screening**           | **Done**      | Same package, from the practice's own medication list                                                                                                                    |
| Drug-drug interactions                    | **Seam only** | _Needs licensed content._ `MedicationSafetyPort` is the interface; `capabilities` tells the UI what was actually checked so an empty result never reads as a clean bill  |
| Dose range, renal and weight dosing       | **Seam only** | _Needs licensed content_, same port                                                                                                                                      |
| **Vitals with growth percentiles**        | **Done**      | `packages/growth` plus `GET /bff/v0/patients/{id}/growth`; CDC LMS data generated and checked against the CDC's own published percentiles, points and curves for a chart |
| **Clinical decision support (CDS Hooks)** | **Done**      | `/cds-services`; three services over the existing allergy and duplicate-therapy screening. Every card names what was not checked                                         |
| **Referral management**                   | **Done**      | `Referral` plus the lifecycle at `/bff/v0/referrals`; four separate timestamps rather than one status, so a referral cannot look closed with nothing having come back    |

## Interoperability

| Capability                                                   | State            | Note                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FHIR R4 boundary                                             | **Done**         | 19 resources with US Core profiles, search parameters validated against the CapabilityStatement                                                                                                                                                                                                     |
| **SMART on FHIR discovery**                                  | **Done**         | `.well-known/smart-configuration`, unauthenticated, claiming only implemented launch modes                                                                                                                                                                                                          |
| **SMART app launch and token exchange**                      | **Done**         | Discovery publishes the deployment's own authorisation server (`OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`), authorization code with PKCE S256, and standalone launch. A deployment that configures none omits the endpoints and claims no launch rather than naming one it does not serve |
| X12 eligibility (270/271)                                    | **Done**         | `packages/x12`                                                                                                                                                                                                                                                                                      |
| X12 claims (837P), remittance (835), status (277), ack (999) | **Done**         | Same package                                                                                                                                                                                                                                                                                        |
| **Prior authorisation (278)**                                | **Done**         | `packages/x12`; request and response, with the five decision codes kept apart - pended is neither yes nor no                                                                                                                                                                                        |
| **Bulk FHIR export (`$export`)**                             | **Done**         | System and Patient-compartment level, `_type`/`_since`, ndjson manifest; `facility.all` plus the caller's own per-type scopes                                                                                                                                                                       |
| **C-CDA generate and import**                                | **Done**         | `packages/ccda` plus `GET /bff/v0/patients/{id}/ccd` and `POST /bff/v0/ccd/import`; sections withheld per permission and named, import writes nothing                                                                                                                                               |
| **HL7 v2 interfaces (ADT, ORU, ORM, VXU)**                   | **Done (codec)** | `packages/hl7v2`; acknowledgements included. Per-partner configuration lives with each interface                                                                                                                                                                                                    |
| Direct secure messaging                                      | **Missing**      | _Needs certification_ - requires a HISP                                                                                                                                                                                                                                                             |
| **Immunisation registry submission**                         | **Done**         | `/bff/v0/immunisations/registry/*`; three steps, so nothing is recorded as reported until the registry acknowledges it. Per-jurisdiction onboarding still belongs to each interface                                                                                                                 |

## Prescribing

| Capability                           | State             | Note                                                                                      |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| Prescription authoring, sign, cancel | **Done**          | Status transitions with a legal-transition graph                                          |
| Safety screening before signing      | **Done**          | See clinical core                                                                         |
| Transmission to pharmacy             | **Seam only**     | _Needs certification_ - Surescripts. `packages/adapters` holds the eRx seam               |
| Controlled substances (EPCS)         | **Not startable** | _Needs certification_ - DEA identity proofing, two-factor at signing, audited application |
| Formulary and benefit check          | **Missing**       | _Needs licensed content_                                                                  |

## Revenue cycle

| Capability                                               | State              | Note                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Charge capture, claims, payments, remittance, statements | **Done**           | Full ledger with claim lines and status history                                                                                                                                                                                                                                       |
| Eligibility checking                                     | **Done**           | Via X12 270/271                                                                                                                                                                                                                                                                       |
| **Fee schedules, contract rates**                        | **Done (library)** | `packages/pricing`; billed and allowed kept apart, modifier-specific rates, effective dating. Persistence and charge capture are the follow-up                                                                                                                                        |
| **Sliding scale, self-pay discounts**                    | **Done (library)** | Same package; practice-configured bands against a supplied poverty guideline, nominal fees, and a validator that runs on save                                                                                                                                                         |
| **Collections and dunning**                              | **Done**           | `packages/collections` plus `/bff/v0/statements/{id}/notice`, `/hold`, `/write-off` and the ageing worklist at `/bff/v0/collections`. The policy decides which notice is due, not the caller, and written off is a separate state from void so bad debt and billing errors stay apart |
| CPT and ICD-10 code sets                                 | **Seam only**      | _Needs licensed content_ - `packages/terminology` is bring-your-own by design                                                                                                                                                                                                         |

## Quality and compliance

| Capability                                  | State             | Note                                                                                |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Hash-chained audit log                      | **Done**          | Append-only, verifiable, now also served as FHIR Provenance                         |
| Row-level security                          | **Done**          | Postgres RLS, forced, fails closed                                                  |
| Break-glass access                          | **Done**          | Recorded on the audit event                                                         |
| eCQM / quality measures                     | **Missing**       | _Buildable_ - measure specifications are public, though each measure is substantial |
| MIPS / promoting interoperability reporting | **Missing**       | _Buildable_ on top of eCQM                                                          |
| ONC certification                           | **Not startable** | _Needs certification_ - a testing body, not a sprint                                |

## Platform

| Capability                             | State         | Note                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Authentication and identity**        | **Done**      | OIDC. The API verifies bearer tokens against the provider's published key set (`OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`), and the web app signs a person in with the authorization code flow and PKCE (`OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`). openrunic is not itself an identity provider and does not store passwords. A deployment that configures no issuer keeps the demo tokens and says so loudly at boot |
| Multi-tenant, multi-facility           | **Done**      | Structural isolation, not filtered isolation                                                                                                                                                                                                                                                                                                                                                                             |
| Roles and permissions                  | **Done**      | Capability-based, seeded roles, enforced per route by `requirePermission` and audited on denial. Authorisation and not authentication: it attaches to whoever the bearer token named, and the first row of this table is what that is worth                                                                                                                                                                              |
| Patient portal                         | **Done**      | Record, visits, bills, messages, forms, assistant                                                                                                                                                                                                                                                                                                                                                                        |
| Forms engine                           | **Done**      | Definitions, submissions, promoted values                                                                                                                                                                                                                                                                                                                                                                                |
| Self-hosting, backup, restore, upgrade | **Done**      | With a clinical-day drill in CI                                                                                                                                                                                                                                                                                                                                                                                          |
| Assistant / agentic layer              | **Done**      | Off by default; propose-never-commit; see ADR-0005 and ADR-0006                                                                                                                                                                                                                                                                                                                                                          |
| Document management and scanning       | **Partial**   | Documents are modelled and stored; no scanning workflow                                                                                                                                                                                                                                                                                                                                                                  |
| DICOM / imaging                        | **Missing**   | _Buildable_, large                                                                                                                                                                                                                                                                                                                                                                                                       |
| Telehealth                             | **Seam only** | `packages/adapters` holds the video seam                                                                                                                                                                                                                                                                                                                                                                                 |
| Internationalisation                   | **Partial**   | `packages/i18n`: catalogues, locale fallback, measured coverage, CLDR plurals. Not yet wired into the apps, and no catalogue ships but the source one                                                                                                                                                                                                                                                                    |
| Inventory and dispensing               | **Done**      | `packages/inventory` behind four tables and the seven daily jobs at `/bff/v0/inventory`. On-hand is summed from an append-only ledger, never stored; UPDATE and DELETE are revoked on it                                                                                                                                                                                                                                 |

**On authentication.** openrunic verifies identity, it does not issue it. The API checks a bearer
token's signature against the issuer's published key set (`apps/api/src/auth/oidc-resolver.ts`,
installed by `apps/api/src/index.ts` when `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URI` are
set), and the staff application signs a person in with the authorization code flow and PKCE
(`apps/web/src/lib/auth/oidc.ts`, `OIDC_CLIENT_ID` and `OIDC_REDIRECT_URI`). The token the browser
ends up holding is the same one the API verifies, so the two halves meet without either trusting
the other. S256 is required and a provider that offers only `plain` is refused rather than
downgraded to.

There are no passwords here, and that is the design. A clinic already has a directory, and an EMR
that grew its own second one would be a place for accounts to be forgotten in rather than a
feature.

A deployment that configures no issuer falls back to `OPENRUNIC_AUTH_MODE=demo-tokens`, which maps
the three tokens printed in `apps/api/src/server/demo-principals.ts` onto the seeded demo users and
prints a banner on every boot saying so. That path is for a laptop. What the other rows say about
roles, scopes, break-glass and the audit log is true of a request once it carries an identity, and
on the demo path the identity is whatever token the caller pasted.

## How to read this

The **Done** rows are the ones with tests behind them. The **Seam only** rows are where the interface
exists and a deployer supplies the implementation - that is the deliberate architecture for anything
requiring a licence, and it is why `MedicationSafetyPort` reports its own `capabilities` rather than
letting a caller assume.

The **Not startable** rows are the honest ones: no amount of engineering makes them true, because
they are gated on an external body granting something.

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

| Capability                            | State         | Note                                                                                                                                                                    |
| ------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient registration, demographics    | **Done**      | Plus identifiers, related persons, coverage                                                                                                                             |
| Scheduling, flow board                | **Done**      | Day view, check-in, rooming, status flow                                                                                                                                |
| Encounters, clinical notes            | **Done**      | Sign, lock, addenda with author attribution                                                                                                                             |
| Problem list, allergies, medications  | **Done**      | Coded, with FHIR mappers                                                                                                                                                |
| Orders, specimens, results            | **Done**      | Order lifecycle, result review and sign                                                                                                                                 |
| Immunisations                         | **Done**      | Recorded and mapped; registry submission below                                                                                                                          |
| **Allergy screening at prescribing**  | **Done**      | `packages/clinical-safety`, warns and requires acknowledgement on HIGH criticality                                                                                      |
| **Duplicate therapy screening**       | **Done**      | Same package, from the practice's own medication list                                                                                                                   |
| Drug-drug interactions                | **Seam only** | _Needs licensed content._ `MedicationSafetyPort` is the interface; `capabilities` tells the UI what was actually checked so an empty result never reads as a clean bill |
| Dose range, renal and weight dosing   | **Seam only** | _Needs licensed content_, same port                                                                                                                                     |
| Vitals with growth percentiles        | **Missing**   | _Buildable_ - CDC and WHO growth data are public domain                                                                                                                 |
| Clinical decision support (CDS Hooks) | **Missing**   | _Buildable_ - the hook contract is open                                                                                                                                 |
| Referral management                   | **Missing**   | _Buildable_                                                                                                                                                             |

## Interoperability

| Capability                                                   | State       | Note                                                                                                                          |
| ------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FHIR R4 boundary                                             | **Done**    | 19 resources with US Core profiles, search parameters validated against the CapabilityStatement                               |
| **SMART on FHIR discovery**                                  | **Done**    | `.well-known/smart-configuration`, unauthenticated, claiming only implemented launch modes                                    |
| SMART app launch and token exchange                          | **Partial** | Discovery is served; the authorisation server itself arrives with OIDC                                                        |
| X12 eligibility (270/271)                                    | **Done**    | `packages/x12`                                                                                                                |
| X12 claims (837P), remittance (835), status (277), ack (999) | **Done**    | Same package                                                                                                                  |
| Prior authorisation (278)                                    | **Missing** | _Buildable_                                                                                                                   |
| **Bulk FHIR export (`$export`)**                             | **Done**    | System and Patient-compartment level, `_type`/`_since`, ndjson manifest; `facility.all` plus the caller's own per-type scopes |
| C-CDA generate and import                                    | **Missing** | _Buildable_ - format work, no licence needed                                                                                  |
| HL7 v2 interfaces (ADT, ORU, ORM, VXU)                       | **Missing** | _Buildable_ - the format is open; each interface is per-partner configuration                                                 |
| Direct secure messaging                                      | **Missing** | _Needs certification_ - requires a HISP                                                                                       |
| Immunisation registry submission                             | **Missing** | _Buildable_, but each jurisdiction has its own onboarding                                                                     |

## Prescribing

| Capability                           | State             | Note                                                                                      |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| Prescription authoring, sign, cancel | **Done**          | Status transitions with a legal-transition graph                                          |
| Safety screening before signing      | **Done**          | See clinical core                                                                         |
| Transmission to pharmacy             | **Seam only**     | _Needs certification_ - Surescripts. `packages/adapters` holds the eRx seam               |
| Controlled substances (EPCS)         | **Not startable** | _Needs certification_ - DEA identity proofing, two-factor at signing, audited application |
| Formulary and benefit check          | **Missing**       | _Needs licensed content_                                                                  |

## Revenue cycle

| Capability                                               | State         | Note                                                                          |
| -------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| Charge capture, claims, payments, remittance, statements | **Done**      | Full ledger with claim lines and status history                               |
| Eligibility checking                                     | **Done**      | Via X12 270/271                                                               |
| Fee schedules, contract rates                            | **Missing**   | _Buildable_                                                                   |
| Sliding scale, self-pay discounts                        | **Missing**   | _Buildable_                                                                   |
| Collections and dunning                                  | **Partial**   | Statements carry dunning cycle; no workflow on top                            |
| CPT and ICD-10 code sets                                 | **Seam only** | _Needs licensed content_ - `packages/terminology` is bring-your-own by design |

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

| Capability                             | State         | Note                                                            |
| -------------------------------------- | ------------- | --------------------------------------------------------------- |
| Multi-tenant, multi-facility           | **Done**      | Structural isolation, not filtered isolation                    |
| Roles and permissions                  | **Done**      | Capability-based, seeded roles                                  |
| Patient portal                         | **Done**      | Record, visits, bills, messages, forms, assistant               |
| Forms engine                           | **Done**      | Definitions, submissions, promoted values                       |
| Self-hosting, backup, restore, upgrade | **Done**      | With a clinical-day drill in CI                                 |
| Assistant / agentic layer              | **Done**      | Off by default; propose-never-commit; see ADR-0005 and ADR-0006 |
| Document management and scanning       | **Partial**   | Documents are modelled and stored; no scanning workflow         |
| DICOM / imaging                        | **Missing**   | _Buildable_, large                                              |
| Telehealth                             | **Seam only** | `packages/adapters` holds the video seam                        |
| Internationalisation                   | **Missing**   | _Buildable_ - no message catalogue yet                          |
| Inventory and dispensing               | **Missing**   | _Buildable_                                                     |

## How to read this

The **Done** rows are the ones with tests behind them. The **Seam only** rows are where the interface
exists and a deployer supplies the implementation - that is the deliberate architecture for anything
requiring a licence, and it is why `MedicationSafetyPort` reports its own `capabilities` rather than
letting a caller assume.

The **Not startable** rows are the honest ones: no amount of engineering makes them true, because
they are gated on an external body granting something.

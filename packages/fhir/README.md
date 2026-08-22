# @openrunic/fhir

FHIR R4 serialization layer for the Openrunic EMR. Postgres (via Prisma) is the source of truth;
this package owns the boundary where domain shapes become FHIR resources, per
[ADR-0002](../../docs/adr/0002-relational-postgres-fhir-boundary.md).

It pins `FHIR_VERSION` (`4.0.1`), re-exports the R4 types the API surface needs as proper module
types on top of `@types/fhir`'s ambient `fhir4` globals, and ships a mapper pair per resource, a
search-parameter registry, a Bundle builder and an OperationOutcome helper.

## Resources mapped

| Group        | Resources                                                                           |
| ------------ | ----------------------------------------------------------------------------------- |
| Registration | Patient, Coverage, Consent, DocumentReference                                       |
| Directory    | Practitioner, PractitionerRole, Organization, Location                              |
| Scheduling   | Appointment, Encounter                                                              |
| Clinical     | Condition, AllergyIntolerance, MedicationRequest, MedicationStatement, Immunization |
| Results      | Observation (vitals and result lines), DiagnosticReport, ServiceRequest, Specimen   |
| Workflow     | Task                                                                                |
| Financial    | Claim                                                                               |
| Audit        | Provenance                                                                          |

Every resource has a `toFhirX` / `fromFhirX` pair, a `DomainX` boundary type and an
`X_DROPPED_FIELDS` manifest.

## The rules every mapper follows

1. **Round-trip or it does not merge.** ADR-0002's honesty mechanism. `describeRoundTrips` asserts
   `domain -> FHIR -> domain`, `FHIR -> domain -> FHIR` and FHIR JSON validity for every fixture,
   including a sparse and a fully degenerate one.
2. **FHIR JSON validity is structural, not aspirational.** No empty arrays, no empty-string values,
   no `null`, no undefined keys, `resourceType` always set. `compact()` enforces it once per
   resource instead of every mapper restating the guards.
3. **Dropped fields are named.** Each mapper exports a `*_DROPPED_FIELDS` manifest with a doc
   comment saying why each column stays inside Openrunic, and a test proves the manifest matches
   the boundary type.
4. **Loss is derived, never assumed.** Openrunic's workflow enums are wider than the FHIR value
   sets they serialize into (an appointment can be `ROOMED`; FHIR R4 cannot say that). `enumMapping`
   computes which values are lossy, and the mapper writes the exact domain value into the
   `local-status` extension for exactly those values. The standard element always carries a valid
   FHIR code.

## Domain shapes

A `DomainX` interface is the JSON-serializable projection of its Prisma row: dates and instants are
ISO 8601 strings, decimals are numbers, money is integer cents, and enum columns carry their Prisma
value (`CHECKED_IN`, not `checked-in`). A required list is `[]` when empty; an optional list is
absent when empty, because FHIR cannot represent an empty array.

## Search, bundles and outcomes

- `SEARCH_SUPPORT` is the typed **catalogue** of search parameters per resource type, with
  `mustSupport` marking the US Core ones. It is what a parameter means, not what the API implements:
  a parameter can be catalogued here and unimplemented, and `apps/api`'s
  `fhir.must-support.test.ts` is what keeps that gap written down. `findSearchParam` /
  `isSupportedSearchParam` let the API reject an unknown parameter with an OperationOutcome instead
  of ignoring it, and the API's `/metadata` takes the list of parameters from the mounted resource
  modules and their definitions from here, so the published CapabilityStatement describes what is
  actually answered.
- `searchsetBundle` and `transactionBundle` build the two bundle types the API serves.
- `operationOutcome` plus the named helpers (`notFound`, `invalid`, `required`, `forbidden`,
  `loginRequired`, `notSupported`, `unsupportedSearchParameter`, `conflict`, `exception`) cover the
  standard R4 issue codes.

## Extensions

Openrunic-local extensions live under `https://openrunic.org/fhir/StructureDefinition/` and exist
only where R4 has nowhere to put a fact: local status and priority values, the medication source,
the compendium specimen type, the abnormal flag, a result's parent report, the 837P claim frequency,
and the breakglass flag and outcome on an audited action. US Core race, ethnicity, birth sex and
gender identity extensions are populated on Patient.

## Commands

```bash
pnpm --filter @openrunic/fhir test        # vitest with coverage thresholds
pnpm --filter @openrunic/fhir type-check
pnpm --filter @openrunic/fhir lint
```

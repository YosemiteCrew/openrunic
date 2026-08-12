# @openrunic/fhir

FHIR R4 serialization layer for the Openrunic EMR. Postgres (via Prisma) is the source of truth;
this package owns the boundary where domain shapes become FHIR resources. It re-exports the R4
types the API surface needs (`CapabilityStatement`, `Patient`, `Bundle`, `OperationOutcome`,
`Reference`) as proper module types on top of `@types/fhir`'s ambient `fhir4` globals, pins
`FHIR_VERSION` (`4.0.1`), and ships the first mapper pair — `toFhirPatient` / `fromFhirPatient`
with a round-trip test — as the pattern every future resource mapping follows.

# Third-party notices

openrunic is licensed under AGPL-3.0-only. That licence covers the code in this repository. It does
not cover the small amount of third-party reference content the repository redistributes alongside
it, which arrives under its own terms and carries its own attribution requirements. This file is
where those requirements are met.

This file is about content, not about dependencies. The licences of the npm packages openrunic
builds on are read from the installed packages into the SBOM and gated by the supply-chain
workflow, so nothing here restates them.

Two rules keep this file true:

- If you add third-party reference content to the repository, add its notice here in the same pull
  request, and name the file that carries it. A notice that does not name a file cannot be checked.
- If you remove the last file a notice covers, remove the notice. A stale attribution is a claim
  about content that is not here.

## LOINC

**Carried by:** `packages/database/src/seed/data.ts` (the demo vitals and laboratory panels).

LOINC codes and their names also appear as literals in tests and fixtures across the repository,
`packages/adapters`, `packages/ccda`, `packages/fhir`, `packages/hl7v2`, `apps/api` and the mock
data in `apps/web` among them. This notice covers all of them.

> This material contains content from LOINC (https://loinc.org). LOINC is copyright © 1995 to the
> present, Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes
> (LOINC) Committee and is available at no cost under the licence at https://loinc.org/license/.
> LOINC® is a registered United States trademark of Regenstrief Institute, Inc.

No LOINC release ships in this repository. What ships is a handful of individual codes, written out
by hand for demonstration data, so no release version is claimed for them and they are not a
substitute for a LOINC release. A deployment that needs the vocabulary loads its own copy through
`@openrunic/terminology`.

## CDC growth charts

**Carried by:** `packages/growth/src/reference/*.ts` (LMS parameters, generated and verified).

The tables are the CDC growth chart z-score data published by the National Center for Health
Statistics, Centers for Disease Control and Prevention. Each generated file names the CSV it came
from and the SHA-256 of that CSV in its header. The data is a work of the United States federal
government and is in the public domain, so no permission is required to redistribute it; the
attribution is here because the reader of a percentile deserves to know whose reference produced it.

## ICD-10-CM and CVX

**Carried by:** `packages/database/src/seed/data.ts` (demo problem list and immunisations).

ICD-10-CM is maintained by the National Center for Health Statistics and the Centers for Medicare
and Medicaid Services. CVX vaccine codes are maintained by the CDC's National Center for
Immunization and Respiratory Diseases. Both are works of the United States federal government,
published without a redistribution restriction. As with LOINC, only a handful of individual codes
appear, as demonstration data rather than as a release.

## RxNorm

**Carried by:** `packages/database/src/seed/data.ts` (demo medications and allergy substances).

RxNorm is produced by the United States National Library of Medicine. The RxNorm concept
identifiers and names used here are the freely available part of it. The full RxNorm release draws
on source vocabularies with restrictions of their own, and no part of that release is redistributed
in this repository.

## Identifiers referenced but not redistributed

Some vocabularies are named by this codebase without any of their content being shipped. Naming a
system is not redistributing it, and the distinction is the reason these are listed separately:

- **SNOMED CT.** Bare concept identifiers appear as cross-references in demo data. No SNOMED CT
  description, hierarchy or release ships here. SNOMED CT is licensed by SNOMED International and
  requires an affiliate licence in most countries.
- **Procedure and service code sets used for billing.** Their canonical system URIs appear as
  column defaults in `packages/database/prisma/schema.prisma`, and their names appear in comments
  and in `packages/ccda/src/oids.ts`, `packages/fhir/src/systems.ts` and
  `apps/api/src/repositories/specs/financial.ts`. **No release, subset or descriptor file from any
  of them is committed, and nothing a deployment runs bills one of their codes**: the demo seed
  bills invented codes under a system URI on `example.invalid`, and the comment on
  `PROCEDURE_SYSTEM` in `packages/database/src/seed/data.ts` says why that must not be changed back.

  What does appear, and is deliberately not claimed away: individual five-digit billing code
  numbers are used as test data in the X12, pricing, C-CDA and FHIR suites and in the web layer's
  mock billing fixtures, in a few cases beside a short English phrase describing the visit. Those
  are isolated identifiers chosen to exercise a codec, not a code set and not a descriptor
  distribution. They are listed here rather than asserted out of existence, because a notices file
  that overstates its own cleanliness is worth less than one that does not.

- **HL7 and X12.** FHIR canonical URLs, CDA template OIDs and X12 segment and element identifiers
  appear throughout the codecs, because a codec cannot be written without them. No specification
  text and no implementation guide ships in this repository.

`packages/terminology/README.md` explains the arrangement these last entries follow: the deployer
supplies the code system release under whatever licence applies to them, the loader verifies it
against a content hash, and a load without a licence attestation is refused.

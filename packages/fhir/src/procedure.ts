/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  codeableConcept,
  codeableConcepts,
  compact,
  period,
  present,
  readCode,
  readConceptText,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * Something done to a patient, as opposed to something ordered or billed.
 *
 * The distinction is why US Core requires it. `ServiceRequest` records what was
 * asked for and may never have happened; `Claim` records what is being billed
 * and exists only when somebody bills. A receiving system reconciling a
 * patient's history cannot read intent or billing and call it care, so a
 * procedure carried out and not billed - most of a clinical day - has to be
 * exchangeable on its own.
 *
 * ## An instant and a span are one field here
 *
 * FHIR splits them into `performedDateTime` and `performedPeriod`, which are a
 * choice: a resource carrying both is malformed. The row has one start and a
 * nullable end, so the choice is made by whether the end is there, and a
 * procedure cannot claim to have happened at an instant and also lasted an
 * hour. Reading back collapses the same way.
 */

export type DomainProcedureStatus =
  | 'PREPARATION'
  | 'IN_PROGRESS'
  | 'NOT_DONE'
  | 'ON_HOLD'
  | 'STOPPED'
  | 'COMPLETED'
  | 'ENTERED_IN_ERROR'
  | 'UNKNOWN';

/**
 * The domain status and the FHIR code are the same value set spelled twice.
 *
 * Kept as a mapping rather than a lowercase-and-hyphenate, because two of them
 * do not survive that rule: `NOT_DONE` is `not-done` and `IN_PROGRESS` is
 * `in-progress`, but `ENTERED_IN_ERROR` is `entered-in-error` while a naive
 * transform of `ON_HOLD` would give `on-hold`, which is right, and there is no
 * way to tell from the code which of those is luck. A table cannot drift.
 */
const PROCEDURE_STATUS = enumMapping<DomainProcedureStatus, fhir4.Procedure['status']>({
  map: {
    PREPARATION: 'preparation',
    IN_PROGRESS: 'in-progress',
    NOT_DONE: 'not-done',
    ON_HOLD: 'on-hold',
    STOPPED: 'stopped',
    COMPLETED: 'completed',
    ENTERED_IN_ERROR: 'entered-in-error',
    UNKNOWN: 'unknown',
  },
  fallback: 'UNKNOWN',
});

export interface DomainProcedure {
  id: string;
  patientId: string;
  encounterId?: string;
  /** Primary code, normally CPT. */
  code: string;
  codeSystem: string;
  display: string;
  /** SNOMED CT equivalent, which is the coding US Core prefers. */
  snomedCode?: string;
  status: DomainProcedureStatus;
  /** ISO instant it was performed, or the start of the period. */
  performedStart: string;
  /** ISO instant it finished, for a procedure that took a span. */
  performedEnd?: string;
  bodySiteCode?: string;
  outcomeCode?: string;
  /** Why it was not done. Only meaningful when the status says so. */
  notDoneReason?: string;
  note?: string;
  performedById?: string;
}

/** Maps a {@link DomainProcedure} to a FHIR R4 `Procedure`. */
export function toFhirProcedure(input: DomainProcedure): fhir4.Procedure {
  const performed = period(input.performedStart, input.performedEnd);

  return compact<fhir4.Procedure>({
    resourceType: 'Procedure',
    id: input.id,
    status: PROCEDURE_STATUS.toFhir(input.status),
    /* Both codings on one concept. The practice bills the CPT and an exchange
       partner reads the SNOMED, and dropping either to satisfy the other loses
       a code somebody downstream needs. */
    code: {
      coding: present<fhir4.Coding>([
        { system: input.codeSystem, code: input.code },
        input.snomedCode === undefined
          ? undefined
          : { system: SYSTEMS.snomed, code: input.snomedCode },
      ]),
      text: input.display,
    },
    subject: fhirReference('Patient', input.patientId),
    encounter:
      input.encounterId === undefined ? undefined : fhirReference('Encounter', input.encounterId),
    /* One or the other, never both: they are a choice in FHIR and a resource
       carrying each is malformed. The end decides which. */
    ...(input.performedEnd === undefined
      ? { performedDateTime: input.performedStart }
      : { performedPeriod: performed }),
    bodySite:
      input.bodySiteCode === undefined
        ? undefined
        : codeableConcepts([input.bodySiteCode], SYSTEMS.snomed),
    outcome:
      input.outcomeCode === undefined
        ? undefined
        : codeableConcept({ system: SYSTEMS.snomed, code: input.outcomeCode }),
    /* `statusReason` rather than a note. FHIR has a field for why something was
       not done, and putting it in `note` would leave a client reading the
       status with no machine-readable reason beside it. */
    statusReason: input.notDoneReason === undefined ? undefined : { text: input.notDoneReason },
    performer:
      input.performedById === undefined
        ? undefined
        : [{ actor: fhirReference('Practitioner', input.performedById) }],
    note: input.note === undefined ? undefined : [{ text: input.note }],
  });
}

/** Maps a FHIR R4 `Procedure` back to a {@link DomainProcedure}. */
export function fromFhirProcedure(resource: fhir4.Procedure): DomainProcedure {
  const concept = resource.code;
  /*
   * The primary coding is the first that is not SNOMED, because SNOMED is the
   * one this mapper appends. A resource written elsewhere that codes only in
   * SNOMED falls back to the first coding, which is that same SNOMED entry, so
   * it arrives as the primary code rather than as nothing.
   */
  const codings = concept?.coding ?? [];
  const primary = codings.find((coding) => coding.system !== SYSTEMS.snomed) ?? codings[0];

  const domain: DomainProcedure = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    code: readString(primary?.code) ?? '',
    codeSystem: readString(primary?.system) ?? '',
    display: readConceptText(concept) ?? '',
    status: PROCEDURE_STATUS.fromFhir(resource.status),
    performedStart:
      readString(resource.performedDateTime) ?? readString(resource.performedPeriod?.start) ?? '',
  };

  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  /* Only from a period. A `performedDateTime` has no end, and inventing one
     equal to the start would turn a moment into a zero-length span. */
  setOptional(domain, 'performedEnd', readString(resource.performedPeriod?.end));
  const snomed = codings.find(
    (coding) => coding.system === SYSTEMS.snomed && coding.code !== domain.code
  );
  setOptional(domain, 'snomedCode', readString(snomed?.code));
  setOptional(domain, 'bodySiteCode', readCode(resource.bodySite?.[0], SYSTEMS.snomed));
  setOptional(domain, 'outcomeCode', readCode(resource.outcome, SYSTEMS.snomed));
  setOptional(domain, 'notDoneReason', readConceptText(resource.statusReason));
  setOptional(domain, 'note', readString(resource.note?.[0]?.text));
  setOptional(domain, 'performedById', referenceId(resource.performer?.[0]?.actor, 'Practitioner'));
  return domain;
}

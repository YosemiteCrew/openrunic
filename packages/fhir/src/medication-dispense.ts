/// <reference types="fhir" preserve="true" />

import {
  compact,
  present,
  readCode,
  readConceptText,
  readQuantityUnit,
  readQuantityValue,
  readString,
  setOptional,
  simpleQuantity,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * Medicine actually handed to a patient, as opposed to medicine prescribed.
 *
 * The distinction is the whole point of the resource and the reason US Core
 * requires it: `MedicationRequest` says what the prescriber intended, and only
 * this says what left the shelf, in what quantity, from which lot and when. A
 * client reconciling a patient's medicines against a recall has to read this
 * one, because the prescription carries no lot number.
 *
 * The row behind it is a posting of kind `DISPENSE` in the stock ledger, which
 * is why the lot travels with it for free: the ledger cannot record a dispense
 * without saying which lot it came from.
 *
 * ## Why the medication is a concept rather than a reference
 *
 * FHIR allows either a coded concept or a reference to a `Medication`. This
 * server serves no `Medication` resource, so a reference would point at
 * something no client can resolve. The concept carries whichever of RxNorm and
 * NDC the stock item records, plus the name the practice types, so a reader
 * with neither code still sees what was handed over.
 */

export interface DomainMedicationDispense {
  id: string;
  patientId: string;
  /** The visit it was handed over during, when it happened at one. */
  encounterId?: string;
  /** The `MedicationRequest` this fills, when it fills one. */
  prescriptionId?: string;
  /** RxNorm concept for the product, when the stock item carries one. */
  rxnormCode?: string;
  /** NDC package code, when the stock item carries one. */
  ndcCode?: string;
  /** What the practice calls it. Always present: the item has a name. */
  medicationDisplay: string;
  quantityValue?: number;
  /** The stock item's unit of issue, for example `tablet` or `mL`. */
  quantityUnit?: string;
  /** ISO instant the medicine was handed over. */
  whenHandedOver: string;
  /** Who posted the dispense. */
  performerId?: string;
  /** The lot it left from, which no prescription records. */
  lotNumber?: string;
}

/**
 * `MedicationDispense.status`.
 *
 * Always `completed`, and that is a property of the ledger rather than a
 * simplification. A posting is the record of stock having moved; there is no
 * row for a dispense that was prepared and not handed over, so no other status
 * has anything to describe. If cancellation ever gets a row, this becomes a
 * mapping and not a constant.
 */
const DISPENSED: fhir4.MedicationDispense['status'] = 'completed';

/** The lot number, which FHIR carries on the dispense rather than the product. */
const LOT_EXTENSION = 'https://openrunic.org/fhir/StructureDefinition/dispense-lot-number';

/** Maps a {@link DomainMedicationDispense} to a FHIR R4 `MedicationDispense`. */
export function toFhirMedicationDispense(
  input: DomainMedicationDispense
): fhir4.MedicationDispense {
  const codings = present<fhir4.Coding>([
    input.rxnormCode === undefined ? undefined : { system: SYSTEMS.rxnorm, code: input.rxnormCode },
    input.ndcCode === undefined ? undefined : { system: SYSTEMS.ndc, code: input.ndcCode },
  ]);

  return compact<fhir4.MedicationDispense>({
    resourceType: 'MedicationDispense',
    id: input.id,
    status: DISPENSED,
    /* The display is set even when a code is, because a reader without either
       code system loaded still has to know what was handed over. */
    medicationCodeableConcept: {
      ...(codings.length > 0 ? { coding: codings } : {}),
      text: input.medicationDisplay,
    },
    subject: fhirReference('Patient', input.patientId),
    context:
      input.encounterId === undefined ? undefined : fhirReference('Encounter', input.encounterId),
    authorizingPrescription:
      input.prescriptionId === undefined
        ? undefined
        : [fhirReference('MedicationRequest', input.prescriptionId)],
    quantity: simpleQuantity(input.quantityValue, input.quantityUnit),
    whenHandedOver: input.whenHandedOver,
    performer:
      input.performerId === undefined
        ? undefined
        : [{ actor: fhirReference('Practitioner', input.performerId) }],
    extension:
      input.lotNumber === undefined
        ? undefined
        : [{ url: LOT_EXTENSION, valueString: input.lotNumber }],
  });
}

/** Maps a FHIR R4 `MedicationDispense` back to a {@link DomainMedicationDispense}. */
export function fromFhirMedicationDispense(
  resource: fhir4.MedicationDispense
): DomainMedicationDispense {
  const concept = resource.medicationCodeableConcept;
  const domain: DomainMedicationDispense = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    medicationDisplay: readConceptText(concept) ?? '',
    whenHandedOver: readString(resource.whenHandedOver) ?? '',
  };

  setOptional(domain, 'encounterId', referenceId(resource.context, 'Encounter'));
  setOptional(
    domain,
    'prescriptionId',
    referenceId(resource.authorizingPrescription?.[0], 'MedicationRequest')
  );
  setOptional(domain, 'rxnormCode', readCode(concept, SYSTEMS.rxnorm));
  setOptional(domain, 'ndcCode', readCode(concept, SYSTEMS.ndc));
  setOptional(domain, 'quantityValue', readQuantityValue(resource.quantity));
  setOptional(domain, 'quantityUnit', readQuantityUnit(resource.quantity));
  setOptional(domain, 'performerId', referenceId(resource.performer?.[0]?.actor, 'Practitioner'));
  setOptional(
    domain,
    'lotNumber',
    (resource.extension ?? []).find((entry) => entry.url === LOT_EXTENSION)?.valueString
  );
  return domain;
}

export { LOT_EXTENSION as DISPENSE_LOT_EXTENSION };

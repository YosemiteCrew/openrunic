import { describe, expect, it } from 'vitest';

import {
  DISPENSE_LOT_EXTENSION,
  fromFhirMedicationDispense,
  toFhirMedicationDispense,
  type DomainMedicationDispense,
} from './medication-dispense.js';
import { SYSTEMS } from './systems.js';

/**
 * Medicine handed over, across the boundary and back.
 *
 * The lot is the field worth watching. It is the reason this resource is worth
 * serving at all next to `MedicationRequest`, and it is the one thing here that
 * has no field of its own in FHIR, so it travels as an extension and is the
 * easiest thing to drop.
 */

const HANDED_OVER: DomainMedicationDispense = {
  id: '0192f1a0-0000-7000-8000-0000000000d1',
  patientId: '0192f1a0-0000-7000-8000-0000000000p1',
  encounterId: '0192f1a0-0000-7000-8000-0000000000e1',
  prescriptionId: '0192f1a0-0000-7000-8000-0000000000m1',
  rxnormCode: '860975',
  ndcCode: '00093-1048-01',
  medicationDisplay: 'Metformin 500 mg tablet',
  quantityValue: 60,
  quantityUnit: 'tablet',
  whenHandedOver: '2026-08-12T10:20:00.000Z',
  performerId: '0192f1a0-0000-7000-8000-0000000000u1',
  lotNumber: 'LOT-7741',
};

describe('toFhirMedicationDispense', () => {
  it('says completed, because the ledger has no row for a dispense that did not happen', () => {
    expect(toFhirMedicationDispense(HANDED_OVER).status).toBe('completed');
  });

  it('carries both code systems and the name the practice types', () => {
    /* A reader with neither RxNorm nor NDC loaded still has to know what was
       handed over, so the text is set even when the codes are. */
    const concept = toFhirMedicationDispense(HANDED_OVER).medicationCodeableConcept;

    expect(concept?.coding).toEqual([
      { system: SYSTEMS.rxnorm, code: '860975' },
      { system: SYSTEMS.ndc, code: '00093-1048-01' },
    ]);
    expect(concept?.text).toBe('Metformin 500 mg tablet');
  });

  it('names the patient, the visit, the prescription it fills and who handed it over', () => {
    const resource = toFhirMedicationDispense(HANDED_OVER);

    expect(resource.subject?.reference).toBe(`Patient/${HANDED_OVER.patientId}`);
    expect(resource.context?.reference).toBe(`Encounter/${HANDED_OVER.encounterId}`);
    expect(resource.authorizingPrescription?.[0]?.reference).toBe(
      `MedicationRequest/${HANDED_OVER.prescriptionId}`
    );
    expect(resource.performer?.[0]?.actor?.reference).toBe(
      `Practitioner/${HANDED_OVER.performerId}`
    );
  });

  it('carries the lot, which is the whole reason to read this instead of the prescription', () => {
    /* No field in FHIR holds it, so it is an extension. A client checking a
       patient's medicines against a recall has nowhere else to look: the
       prescription records no lot. */
    expect(toFhirMedicationDispense(HANDED_OVER).extension).toEqual([
      { url: DISPENSE_LOT_EXTENSION, valueString: 'LOT-7741' },
    ]);
  });

  it('carries the quantity with its unit of issue', () => {
    expect(toFhirMedicationDispense(HANDED_OVER).quantity).toMatchObject({
      value: 60,
      unit: 'tablet',
    });
  });
});

describe('round trip', () => {
  it('returns every field it was given', () => {
    expect(fromFhirMedicationDispense(toFhirMedicationDispense(HANDED_OVER))).toEqual(HANDED_OVER);
  });

  it('survives a dispense with no prescription, visit, codes or lot', () => {
    /*
     * All four are optional in the ledger. Stock handed over without a
     * prescription is ordinary in a practice that dispenses samples, and an
     * item with no RxNorm code is ordinary in one that has not coded its
     * shelves.
     */
    const bare: DomainMedicationDispense = {
      id: '0192f1a0-0000-7000-8000-0000000000d2',
      patientId: HANDED_OVER.patientId,
      medicationDisplay: 'Sample sachet',
      whenHandedOver: '2026-08-12T11:00:00.000Z',
    };

    expect(fromFhirMedicationDispense(toFhirMedicationDispense(bare))).toEqual(bare);
  });

  it('keeps a quantity of zero rather than dropping it as falsy', () => {
    /* A zero-quantity posting is a correction, and losing the number turns it
       into a dispense of unknown size. */
    const zero = { ...HANDED_OVER, quantityValue: 0 };

    expect(fromFhirMedicationDispense(toFhirMedicationDispense(zero)).quantityValue).toBe(0);
  });
});

describe('fromFhirMedicationDispense, on input it did not write', () => {
  it('reads a dispense that names its medication only in text', () => {
    const domain = fromFhirMedicationDispense({
      resourceType: 'MedicationDispense',
      id: 'external-1',
      status: 'completed',
      medicationCodeableConcept: { text: 'Amoxicillin 250 mg capsule' },
      subject: { reference: 'Patient/p-1' },
      whenHandedOver: '2026-08-12T09:00:00.000Z',
    });

    expect(domain.medicationDisplay).toBe('Amoxicillin 250 mg capsule');
    expect(domain.rxnormCode).toBeUndefined();
  });

  it('ignores an extension that is not the lot number', () => {
    const domain = fromFhirMedicationDispense({
      resourceType: 'MedicationDispense',
      status: 'completed',
      medicationCodeableConcept: { text: 'Something' },
      subject: { reference: 'Patient/p-1' },
      whenHandedOver: '2026-08-12T09:00:00.000Z',
      extension: [{ url: 'https://example.invalid/other', valueString: 'not-a-lot' }],
    });

    expect(domain.lotNumber).toBeUndefined();
  });
});

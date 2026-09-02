import { describe, expect, it } from 'vitest';

import { fromFhirDevice, toFhirDevice, type DomainDevice } from './device.js';
import { SYSTEMS } from './systems.js';

/**
 * Implanted devices, across the boundary and back.
 *
 * The UDI is what this resource is for. A recall names a device identifier, and
 * the practice has to turn that into a list of patients, so every assertion
 * about the carrier here is about not losing or inventing part of it.
 */

const PATIENT = '0192f1a0-0000-7000-8000-0000000000p1';

const LEAD: DomainDevice = {
  id: '0192f1a0-0000-7000-8000-0000000000d1',
  patientId: PATIENT,
  status: 'ACTIVE',
  typeCode: '14106009',
  typeSystem: SYSTEMS.snomed,
  typeText: 'Cardiac pacemaker',
  deviceIdentifier: '08717648200274',
  udiCarrierHrf: '(01)08717648200274(17)141120(10)7654321D(21)10987654d321',
  lotNumber: '7654321D',
  serialNumber: '10987654d321',
  manufacturer: 'Testmaker Medical',
  modelNumber: 'TM-2200',
  manufactureDate: '2026-01-05',
  expirationDate: '2031-01-05',
};

describe('toFhirDevice', () => {
  it('carries the scanned barcode and the identifier side by side', () => {
    const carrier = toFhirDevice(LEAD).udiCarrier?.[0];

    expect(carrier?.deviceIdentifier).toBe('08717648200274');
    expect(carrier?.carrierHRF).toBe(LEAD.udiCarrierHrf);
  });

  it('never rebuilds a carrier from the parts', () => {
    /*
     * The parts do not determine it. The encoding depends on the issuing
     * agency, the order and delimiters differ, and a reconstructed carrier that
     * does not match the label is a barcode nobody can verify against the
     * device in front of them.
     */
    const typedIn = toFhirDevice({ ...LEAD, udiCarrierHrf: undefined });

    expect(typedIn.udiCarrier?.[0]?.carrierHRF).toBeUndefined();
    expect(typedIn.udiCarrier?.[0]?.deviceIdentifier).toBe('08717648200274');
  });

  it('omits the carrier element entirely when there is no UDI at all', () => {
    /* An older implant recorded from a clinic letter has neither. An empty
       udiCarrier would make a client look for an identifier that is not
       there. */
    const older = toFhirDevice({
      ...LEAD,
      deviceIdentifier: undefined,
      udiCarrierHrf: undefined,
    });

    expect(older.udiCarrier).toBeUndefined();
    expect(older.type?.text).toBe('Cardiac pacemaker');
  });

  it('names the device in words even when it has no code', () => {
    /* Most older implants are recorded from a letter and never coded. A device
       that only appeared when coded would leave the ordinary case blank. */
    const uncoded = toFhirDevice({ ...LEAD, typeCode: undefined, typeSystem: undefined });

    expect(uncoded.type?.text).toBe('Cardiac pacemaker');
    expect(uncoded.type?.coding).toBeUndefined();
  });

  it('maps every status to its FHIR code', () => {
    const codes = (['ACTIVE', 'INACTIVE', 'ENTERED_IN_ERROR', 'UNKNOWN'] as const).map(
      (status) => toFhirDevice({ ...LEAD, status }).status
    );

    expect(codes).toEqual(['active', 'inactive', 'entered-in-error', 'unknown']);
  });

  it('keeps the lot and serial as their own elements, not only inside the barcode', () => {
    /* They are inside the carrier string too, and this server does not parse
       it. A client that also does not parse it would otherwise have no lot
       number, which is what a recall is scoped by. */
    const resource = toFhirDevice(LEAD);

    expect(resource.lotNumber).toBe('7654321D');
    expect(resource.serialNumber).toBe('10987654d321');
  });
});

describe('round trip', () => {
  it('returns every field it was given', () => {
    expect(fromFhirDevice(toFhirDevice(LEAD))).toEqual(LEAD);
  });

  it('returns the carrier byte for byte', () => {
    /* A recall is matched against this string. Anything that normalised it -
       trimming, upper-casing, stripping parentheses - would stop it matching
       the label. */
    expect(fromFhirDevice(toFhirDevice(LEAD)).udiCarrierHrf).toBe(LEAD.udiCarrierHrf);
  });

  it('survives a device with nothing but a patient, a status and a name', () => {
    const bare: DomainDevice = {
      id: '0192f1a0-0000-7000-8000-0000000000d2',
      patientId: PATIENT,
      status: 'ACTIVE',
      typeText: 'Hip prosthesis, left',
    };

    expect(fromFhirDevice(toFhirDevice(bare))).toEqual(bare);
  });
});

describe('fromFhirDevice, on input it did not write', () => {
  const foreign = (overrides: Partial<fhir4.Device>): fhir4.Device => ({
    resourceType: 'Device',
    id: 'external-1',
    status: 'active',
    type: { text: 'Something' },
    patient: { reference: `Patient/${PATIENT}` },
    ...overrides,
  });

  it('drops a type coding that has a code and no system', () => {
    /* A code with no system is a string nobody can look up. Stored, it becomes
       a device type that resolves to no display anywhere. */
    const domain = fromFhirDevice(foreign({ type: { coding: [{ code: '14106009' }], text: 'x' } }));

    expect(domain.typeCode).toBeUndefined();
    expect(domain.typeSystem).toBeUndefined();
  });

  it('drops a type coding that has a system and no code', () => {
    const domain = fromFhirDevice(
      foreign({ type: { coding: [{ system: SYSTEMS.snomed }], text: 'x' } })
    );

    expect(domain.typeCode).toBeUndefined();
  });

  it('reads a carrier that has the barcode and no parsed identifier', () => {
    /* Another system may store only what it scanned, which is exactly what this
       one does when nobody typed the identifier separately. */
    const domain = fromFhirDevice(
      foreign({ udiCarrier: [{ carrierHRF: '(01)08717648200274(10)LOT9' }] })
    );

    expect(domain.udiCarrierHrf).toBe('(01)08717648200274(10)LOT9');
    expect(domain.deviceIdentifier).toBeUndefined();
  });

  it('does not invent a device identifier by parsing the barcode', () => {
    /*
     * The temptation, and the reason it is refused. GS1 and HIBCC have
     * different grammars, variable-length fields and no self-description, and a
     * half-parser that mis-splits a lot number produces a wrong lot with no
     * error. For a recall that is worse than an unparsed string.
     */
    expect(
      fromFhirDevice(
        foreign({
          udiCarrier: [
            {
              carrierHRF:
                '+H123PARTNO1234567890120/$$420020216LOT123456789012345/SXYZ456789012345678/16D20130202C',
            },
          ],
        })
      ).deviceIdentifier
    ).toBeUndefined();
  });

  it('reads a device with no type text as an unnamed one rather than failing', () => {
    expect(fromFhirDevice(foreign({ type: { coding: [{ code: 'x' }] } })).typeText).toBe('');
  });

  it('falls back to UNKNOWN for a status outside the value set', () => {
    expect(fromFhirDevice(foreign({ status: 'nonsense' as fhir4.Device['status'] })).status).toBe(
      'UNKNOWN'
    );
  });
});

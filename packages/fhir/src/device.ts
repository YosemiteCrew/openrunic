/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { compact, compactOrUndefined, readString, setOptional } from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * A device implanted in a patient, and the identifier a recall arrives by.
 *
 * When a manufacturer recalls a batch of leads, the question is "which of our
 * patients has one", and no other resource answers it: inventory knows what the
 * practice bought and what left the shelf, and neither knows what is still
 * inside somebody twenty years later.
 *
 * ## The UDI carrier is carried, not rebuilt
 *
 * `udiCarrier.carrierHRF` is the string as it was scanned. This mapper never
 * assembles one from the parts, because the parts do not determine it: the
 * encoding depends on the issuing agency, the order and delimiters differ, and
 * a reconstructed carrier that does not match the label is a barcode nobody can
 * verify against the device. It is emitted when stored and omitted when not.
 */

export type DomainDeviceStatus = 'ACTIVE' | 'INACTIVE' | 'ENTERED_IN_ERROR' | 'UNKNOWN';

export const DEVICE_STATUS = enumMapping<DomainDeviceStatus, NonNullable<fhir4.Device['status']>>({
  map: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    ENTERED_IN_ERROR: 'entered-in-error',
    UNKNOWN: 'unknown',
  },
  fallback: 'UNKNOWN',
});

export interface DomainDevice {
  id: string;
  patientId: string;
  status: DomainDeviceStatus;
  typeCode?: string;
  typeSystem?: string;
  /** What the device is, in words. Always present: see the schema comment. */
  typeText: string;
  deviceIdentifier?: string;
  udiCarrierHrf?: string;
  distinctIdentifier?: string;
  lotNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  modelNumber?: string;
  manufactureDate?: string;
  expirationDate?: string;
}

/** Maps a {@link DomainDevice} to a FHIR R4 `Device`. */
export function toFhirDevice(input: DomainDevice): fhir4.Device {
  return compact<fhir4.Device>({
    resourceType: 'Device',
    id: input.id,
    status: DEVICE_STATUS.toFhir(input.status),
    /*
     * The carrier and the device identifier travel together but are not derived
     * from each other. A device recorded from a label somebody typed has the
     * identifier and no carrier; one scanned has both. Emitting the element at
     * all requires one of them, so a device with neither carries no udiCarrier
     * rather than an empty one.
     */
    udiCarrier: udiCarrierOf(input),
    type: {
      ...(input.typeCode === undefined
        ? {}
        : {
            coding: [{ system: input.typeSystem ?? SYSTEMS.snomed, code: input.typeCode }],
          }),
      text: input.typeText,
    },
    distinctIdentifier: input.distinctIdentifier,
    manufacturer: input.manufacturer,
    manufactureDate: input.manufactureDate,
    expirationDate: input.expirationDate,
    lotNumber: input.lotNumber,
    serialNumber: input.serialNumber,
    modelNumber: input.modelNumber,
    patient: fhirReference('Patient', input.patientId),
  });
}

function udiCarrierOf(input: DomainDevice): fhir4.DeviceUdiCarrier[] | undefined {
  const carrier = compactOrUndefined<fhir4.DeviceUdiCarrier>({
    deviceIdentifier: input.deviceIdentifier,
    carrierHRF: input.udiCarrierHrf,
  });
  return carrier === undefined ? undefined : [carrier];
}

/** Maps a FHIR R4 `Device` back to a {@link DomainDevice}. */
export function fromFhirDevice(resource: fhir4.Device): DomainDevice {
  const carrier = resource.udiCarrier?.[0];
  const coding = resource.type?.coding?.[0];

  const domain: DomainDevice = {
    id: resource.id ?? '',
    patientId: referenceId(resource.patient, 'Patient') ?? '',
    status: DEVICE_STATUS.fromFhir(resource.status),
    typeText: resource.type?.text ?? '',
  };

  /* Both or neither. A code with no system is a string nobody can look up, and
     a system with no code names a vocabulary and no term in it, so a partial
     coding is dropped rather than stored as half a fact. */
  const code = readString(coding?.code);
  const system = readString(coding?.system);
  if (code !== undefined && system !== undefined) {
    domain.typeCode = code;
    domain.typeSystem = system;
  }

  setOptional(domain, 'deviceIdentifier', readString(carrier?.deviceIdentifier));
  setOptional(domain, 'udiCarrierHrf', readString(carrier?.carrierHRF));
  setOptional(domain, 'distinctIdentifier', readString(resource.distinctIdentifier));
  setOptional(domain, 'lotNumber', readString(resource.lotNumber));
  setOptional(domain, 'serialNumber', readString(resource.serialNumber));
  setOptional(domain, 'manufacturer', readString(resource.manufacturer));
  setOptional(domain, 'modelNumber', readString(resource.modelNumber));
  setOptional(domain, 'manufactureDate', readString(resource.manufactureDate));
  setOptional(domain, 'expirationDate', readString(resource.expirationDate));
  return domain;
}

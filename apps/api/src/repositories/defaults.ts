import type {
  AdministrativeGender,
  AppointmentCreatedVia,
  AppointmentStatus,
  SensitivityClass,
} from './types.js';

/**
 * Column defaults, mirrored from `schema.prisma`.
 *
 * Postgres applies these at runtime; the in-memory repository has no Postgres,
 * so it applies them from here. Keeping one copy is what stops the test suite
 * from passing against defaults the database does not actually have.
 */
export interface PatientDefaults {
  sexAtBirth: AdministrativeGender;
  languageCode: string;
  country: string;
  sensitivityClass: SensitivityClass;
  portalEnabled: boolean;
  active: boolean;
}

export const PATIENT_DEFAULTS: PatientDefaults = {
  sexAtBirth: 'UNKNOWN',
  languageCode: 'en',
  country: 'US',
  sensitivityClass: 'NORMAL',
  portalEnabled: false,
  active: true,
};

export interface AppointmentDefaults {
  status: AppointmentStatus;
  createdVia: AppointmentCreatedVia;
}

export const APPOINTMENT_DEFAULTS: AppointmentDefaults = {
  status: 'BOOKED',
  createdVia: 'STAFF',
};

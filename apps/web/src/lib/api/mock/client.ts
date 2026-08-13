import { paginate } from '../pagination';
import type {
  ApiClient,
  Appointment,
  AppointmentListQuery,
  Patient,
  PatientListQuery,
} from '../types';

import { MOCK_APPOINTMENTS, MOCK_PATIENTS } from './fixtures';
import { notFound, settle } from './protocol';

/**
 * The fixture-backed client.
 *
 * It exists because the live API needs Postgres and every screen still has to
 * render fully in a demo, a test and a design review. So it is not a stub: it
 * implements the same {@link ApiClient} contract, applies the same filters,
 * sorts and pagination the API applies, and fails the same way, with an
 * {@link ApiError} carrying an RFC 9457 problem document. A screen that works
 * here works against the real API, which is the whole point.
 *
 * It is deliberately not a fake of everything: writes are not implemented,
 * because a fixture that accepts writes teaches screens to trust state the
 * server never saw.
 */

/* Built once per patient and kept for as long as that patient object is alive.
   The palette searches on every keystroke, and rebuilding a joined, lowercased
   string for every row on every one of those is the whole cost of the search.
   A WeakMap, so a patient that falls out of the fixture is not held here. */
const HAYSTACKS = new WeakMap<Patient, string>();

function haystack(patient: Patient): string {
  const cached = HAYSTACKS.get(patient);
  if (cached !== undefined) return cached;
  const { given, family, preferred } = patient.name;
  const built = [given, family, preferred ?? '', patient.mrn].join(' ').toLowerCase();
  HAYSTACKS.set(patient, built);
  return built;
}

/** Case-insensitive prefix match, matching the FHIR `string` search semantic. */
function startsWith(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

export function filterPatients(
  rows: readonly Patient[],
  query: PatientListQuery = {}
): readonly Patient[] {
  const { q, mrn, family, given, birthDate, active } = query;
  const needle = q?.trim().toLowerCase();

  const matched = rows.filter((patient) => {
    if (needle) {
      const searchable: string = haystack(patient);
      if (!searchable.includes(needle)) return false;
    }
    if (mrn && patient.mrn !== mrn) return false;
    if (family && !startsWith(patient.name.family, family)) return false;
    if (given && !startsWith(patient.name.given, given)) return false;
    if (birthDate && patient.birthDate !== birthDate) return false;
    if (active !== undefined && patient.active !== active) return false;
    return true;
  });

  const sort = query.sort ?? 'familyName';
  const direction = query.order === 'desc' ? -1 : 1;
  return [...matched].sort((a, b) => {
    if (sort === 'birthDate') return a.birthDate.localeCompare(b.birthDate) * direction;
    if (sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * direction;
    return a.name.family.localeCompare(b.name.family, 'en') * direction;
  });
}

export function filterAppointments(
  rows: readonly Appointment[],
  query: AppointmentListQuery = {}
): readonly Appointment[] {
  const { facilityId, providerId, patientId, status, from, to } = query;

  const matched = rows.filter((appointment) => {
    if (facilityId && appointment.facilityId !== facilityId) return false;
    if (providerId && appointment.providerId !== providerId) return false;
    if (patientId && appointment.patientId !== patientId) return false;
    if (status && appointment.status !== status) return false;
    // `from` is inclusive and `to` exclusive, so one day is [00:00, next 00:00).
    if (from && appointment.start < new Date(from).toISOString()) return false;
    if (to && appointment.start >= new Date(to).toISOString()) return false;
    return true;
  });

  const direction = query.order === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'start';
  return [...matched].sort((a, b) =>
    sort === 'createdAt'
      ? a.createdAt.localeCompare(b.createdAt) * direction
      : a.start.localeCompare(b.start) * direction
  );
}

export interface MockClientOptions {
  patients?: readonly Patient[];
  appointments?: readonly Appointment[];
}

export function createMockClient(options: MockClientOptions = {}): ApiClient {
  const patients = options.patients ?? MOCK_PATIENTS;
  const appointments = options.appointments ?? MOCK_APPOINTMENTS;

  return {
    mode: 'mock',
    patients: {
      list: (query = {}) =>
        settle(paginate(filterPatients(patients, query), query.page, query.pageSize)),
      get: (id) => {
        const found = patients.find((patient) => patient.id === id);
        if (!found) return Promise.reject(notFound('No such patient.'));
        return settle(found);
      },
    },
    appointments: {
      list: (query = {}) =>
        settle(paginate(filterAppointments(appointments, query), query.page, query.pageSize)),
      get: (id) => {
        const found = appointments.find((appointment) => appointment.id === id);
        if (!found) return Promise.reject(notFound('No such appointment.'));
        return settle(found);
      },
    },
  };
}

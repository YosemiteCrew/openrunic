import { ApiError } from '../client';
import type {
  ApiClient,
  Appointment,
  AppointmentListQuery,
  ListResponse,
  Patient,
  PatientListQuery,
  ProblemDocument,
} from '../types';

import { MOCK_APPOINTMENTS, MOCK_PATIENTS } from './fixtures';

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

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Latency, so loading states are visible in the browser but instant in tests. */
const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 140;

function settle<T>(value: T): Promise<T> {
  if (LATENCY_MS === 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function problem(status: number, title: string, detail: string, kind: string): ProblemDocument {
  return {
    type: `https://openrunic.org/problems/${kind}`,
    title,
    status,
    detail,
    instance: '/bff/v0',
    requestId: 'mock-request',
  };
}

function notFound(detail: string): ApiError {
  return new ApiError(detail, {
    kind: 'http',
    status: 404,
    problem: problem(404, 'Not found', detail, 'not-found'),
  });
}

function paginate<T>(rows: readonly T[], page = 1, pageSize = DEFAULT_PAGE_SIZE): ListResponse<T> {
  const size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const current = Math.max(page, 1);
  const start = (current - 1) * size;
  return {
    data: rows.slice(start, start + size),
    page: {
      page: current,
      pageSize: size,
      total: rows.length,
      // A zero-result search has one empty page, not zero: the pager still renders.
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
    },
  };
}

function haystack(patient: Patient): string {
  const { given, family, preferred } = patient.name;
  return [given, family, preferred ?? '', patient.mrn].join(' ').toLowerCase();
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
    if (needle && !haystack(patient).includes(needle)) return false;
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

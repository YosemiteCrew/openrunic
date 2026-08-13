import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../errors.js';
import { parseParam } from '../http/validate.js';
import {
  appointmentListQuerySchema,
  appointmentUpdateSchema,
  toAppointmentDto,
  toAppointmentListQuery,
  toAppointmentUpdateInput,
} from '../schemas/appointments.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageMetaSchema,
  toListResponse,
} from '../schemas/pagination.js';
import {
  parseLocalDate,
  patientListQuerySchema,
  toDateOnly,
  toPatientDto,
  toPatientListQuery,
} from '../schemas/patients.js';

import { DEMO_FACILITY_A, makeAppointmentRow, makePatientRow, testId } from './support.js';

describe('pagination', () => {
  it('reports one page for an empty result set', () => {
    const response = toListResponse({ rows: [], total: 0, page: 1, pageSize: 25 }, (row) => row);

    expect(response.page.totalPages).toBe(1);
    expect(pageMetaSchema.safeParse(response.page).success).toBe(true);
  });

  it('rounds a partial last page up', () => {
    const response = toListResponse({ rows: [], total: 26, page: 1, pageSize: 25 }, (row) => row);

    expect(response.page.totalPages).toBe(2);
  });

  it('serialises each row through the supplied mapper', () => {
    const response = toListResponse(
      { rows: [makePatientRow()], total: 1, page: 1, pageSize: 25 },
      toPatientDto
    );

    expect(response.data[0]?.mrn).toBe('OR-100482');
  });

  it('defaults and caps the page size', () => {
    expect(patientListQuerySchema.parse({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(patientListQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE) }).success).toBe(
      true
    );
    expect(patientListQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(
      false
    );
  });
});

describe('the patient query contract', () => {
  it('coerces the numeric query parameters a URL delivers as strings', () => {
    const parsed = patientListQuerySchema.parse({ page: '3', pageSize: '10' });

    expect(parsed).toMatchObject({ page: 3, pageSize: 10 });
  });

  it('translates the wire query into the repository query', () => {
    const query = toPatientListQuery(
      patientListQuerySchema.parse({
        q: 'tess',
        mrn: 'OR-100482',
        family: 'Pat',
        given: 'Tes',
        birthDate: '1994-03-02',
        active: 'true',
        sort: 'birthDate',
        order: 'desc',
      })
    );

    expect(query).toEqual({
      page: 1,
      pageSize: 25,
      q: 'tess',
      mrn: 'OR-100482',
      family: 'Pat',
      given: 'Tes',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
      active: true,
      sort: 'birthDate',
      order: 'desc',
    });
  });

  it('omits absent filters rather than passing undefined through', () => {
    expect(Object.keys(toPatientListQuery(patientListQuerySchema.parse({})))).toEqual([
      'page',
      'pageSize',
      'sort',
      'order',
    ]);
  });

  it('reads a bare date as UTC midnight, so a timezone cannot move a birthday', () => {
    const parsed = parseLocalDate('1994-03-02');

    expect(parsed.toISOString()).toBe('1994-03-02T00:00:00.000Z');
    expect(toDateOnly(parsed)).toBe('1994-03-02');
  });
});

describe('the patient DTO', () => {
  it('groups name, telecom and address, and dates the birth date only', () => {
    const dto = toPatientDto(
      makePatientRow({
        middleName: 'Q',
        email: 'testina@example.invalid',
        city: 'Testville',
        deceasedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
    );

    expect(dto.name).toEqual({
      given: 'Testina',
      middle: 'Q',
      family: 'Patientsson',
      prefix: null,
      suffix: null,
      preferred: null,
    });
    expect(dto.telecom.email).toBe('testina@example.invalid');
    expect(dto.address.city).toBe('Testville');
    expect(dto.birthDate).toBe('1994-03-02');
    expect(dto.deceasedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('copies the code arrays rather than aliasing the stored row', () => {
    const row = makePatientRow({ raceCodes: ['2106-3'] });
    const dto = toPatientDto(row);

    expect(dto.raceCodes).toEqual(row.raceCodes);
    expect(dto.raceCodes).not.toBe(row.raceCodes);
  });
});

describe('the appointment query contract', () => {
  it('translates the wire query into the repository query', () => {
    const query = toAppointmentListQuery(
      appointmentListQuerySchema.parse({
        facilityId: DEMO_FACILITY_A,
        providerId: testId(900),
        patientId: testId(1),
        status: 'CHECKED_IN',
        from: '2026-08-14T00:00:00Z',
        to: '2026-08-15T00:00:00Z',
        sort: 'createdAt',
        order: 'desc',
      })
    );

    expect(query).toEqual({
      page: 1,
      pageSize: 25,
      facilityId: DEMO_FACILITY_A,
      providerId: testId(900),
      patientId: testId(1),
      status: 'CHECKED_IN',
      from: new Date('2026-08-14T00:00:00.000Z'),
      to: new Date('2026-08-15T00:00:00.000Z'),
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('omits absent filters', () => {
    expect(Object.keys(toAppointmentListQuery(appointmentListQuerySchema.parse({})))).toEqual([
      'page',
      'pageSize',
      'sort',
      'order',
    ]);
  });
});

describe('the appointment patch contract', () => {
  it('rejects an empty patch', () => {
    expect(appointmentUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an inverted window and a reasonless cancellation', () => {
    expect(
      appointmentUpdateSchema.safeParse({
        start: '2026-08-20T12:00:00Z',
        end: '2026-08-20T11:00:00Z',
      }).success
    ).toBe(false);
    expect(appointmentUpdateSchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    expect(
      appointmentUpdateSchema.safeParse({ status: 'CANCELLED', cancelReason: 'Patient rang' })
        .success
    ).toBe(true);
  });

  it('accepts a one-sided reschedule', () => {
    expect(appointmentUpdateSchema.safeParse({ start: '2026-08-20T12:00:00Z' }).success).toBe(true);
  });

  it('refuses to move the appointment to another facility or patient', () => {
    expect(appointmentUpdateSchema.safeParse({ facilityId: DEMO_FACILITY_A }).success).toBe(false);
    expect(appointmentUpdateSchema.safeParse({ patientId: testId(1) }).success).toBe(false);
  });

  it('converts the patch into repository input', () => {
    const input = toAppointmentUpdateInput(
      appointmentUpdateSchema.parse({
        status: 'CANCELLED',
        cancelReason: 'Patient rang',
        start: '2026-08-20T12:00:00Z',
        end: '2026-08-20T13:00:00Z',
        durationMinutes: 60,
        room: '4',
        reasonText: 'Rescheduled',
        providerId: testId(902),
        typeCode: 'OFFICE-60',
        typeDisplay: 'Office visit, 60 minutes',
      })
    );

    expect(input).toEqual({
      status: 'CANCELLED',
      cancelReason: 'Patient rang',
      start: new Date('2026-08-20T12:00:00.000Z'),
      end: new Date('2026-08-20T13:00:00.000Z'),
      durationMinutes: 60,
      room: '4',
      reasonText: 'Rescheduled',
      providerId: testId(902),
      typeCode: 'OFFICE-60',
      typeDisplay: 'Office visit, 60 minutes',
    });
  });

  it('omits what the patch did not mention', () => {
    expect(
      Object.keys(toAppointmentUpdateInput(appointmentUpdateSchema.parse({ room: '4' })))
    ).toEqual(['room']);
  });
});

describe('the appointment DTO', () => {
  it('carries the type inline so renaming a catalogue entry never rewrites history', () => {
    const dto = toAppointmentDto(
      makeAppointmentRow({ checkedInAt: new Date('2026-08-14T14:55:00Z') })
    );

    expect(dto.type).toEqual({ code: 'OFFICE-30', display: 'Office visit, 30 minutes' });
    expect(dto.checkedInAt).toBe('2026-08-14T14:55:00.000Z');
    expect(dto.start).toBe('2026-08-14T15:00:00.000Z');
  });
});

describe('parseParam', () => {
  it('returns the parsed value on success', () => {
    expect(parseParam('42', z.coerce.number(), 'n')).toBe(42);
  });

  it('raises a 400 naming the parameter', () => {
    try {
      parseParam('nope', z.uuid(), 'id');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).issues[0]?.path).toBe('id');
    }
  });
});

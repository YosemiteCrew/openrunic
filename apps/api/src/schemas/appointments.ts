import { APPOINTMENT_CREATED_VIA, APPOINTMENT_STATUSES } from '@openrunic/database';
import { z } from 'zod';

import type {
  AppointmentListQuery,
  AppointmentRow,
  AppointmentUpdateInput,
} from '../repositories/types.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';

/**
 * The appointment list contract. Its shape follows the two queries the product
 * actually issues - the schedule day view (facility + date range) and the Flow
 * Board (facility + status) - which are the two composite indexes the schema
 * carries.
 */
export const appointmentListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  facilityId: z.uuid().optional(),
  providerId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  /** Inclusive lower bound on `start`. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Exclusive upper bound on `start`, so a day query is `[00:00, next 00:00)`. */
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.enum(['start', 'createdAt']).default('start'),
  order: sortOrderField,
});

export type AppointmentListQueryInput = z.infer<typeof appointmentListQuerySchema>;

export function toAppointmentListQuery(input: AppointmentListQueryInput): AppointmentListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.facilityId === undefined ? {} : { facilityId: input.facilityId }),
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The appointment patch contract.
 *
 * Deliberately narrow: `facilityId` and `patientId` are absent because moving a
 * booked appointment to another facility or another patient is not an edit, it
 * is a cancel and a rebook, and the status history has to show that.
 */
export const appointmentUpdateSchema = z
  .strictObject({
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    start: z.iso.datetime({ offset: true }).optional(),
    end: z.iso.datetime({ offset: true }).optional(),
    durationMinutes: z.int().positive().max(1440).optional(),
    room: z.string().min(1).max(256).optional(),
    reasonText: z.string().min(1).max(256).optional(),
    cancelReason: z.string().min(1).max(256).optional(),
    providerId: z.uuid().optional(),
    typeCode: z.string().min(1).max(64).optional(),
    typeDisplay: z.string().min(1).max(512).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  })
  .refine(
    (value) => value.start === undefined || value.end === undefined || value.end > value.start,
    {
      message: 'end must be after start',
      path: ['end'],
    }
  )
  .refine((value) => value.status !== 'CANCELLED' || value.cancelReason !== undefined, {
    message: 'a cancellation must record a reason',
    path: ['cancelReason'],
  });

export type AppointmentUpdateBody = z.infer<typeof appointmentUpdateSchema>;

export function toAppointmentUpdateInput(body: AppointmentUpdateBody): AppointmentUpdateInput {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.start === undefined ? {} : { start: new Date(body.start) }),
    ...(body.end === undefined ? {} : { end: new Date(body.end) }),
    ...(body.durationMinutes === undefined ? {} : { durationMinutes: body.durationMinutes }),
    ...(body.room === undefined ? {} : { room: body.room }),
    ...(body.reasonText === undefined ? {} : { reasonText: body.reasonText }),
    ...(body.cancelReason === undefined ? {} : { cancelReason: body.cancelReason }),
    ...(body.providerId === undefined ? {} : { providerId: body.providerId }),
    ...(body.typeCode === undefined ? {} : { typeCode: body.typeCode }),
    ...(body.typeDisplay === undefined ? {} : { typeDisplay: body.typeDisplay }),
  };
}

/**
 * The JSON shape of an appointment on the internal API. Schema first, type
 * inferred, so the spec and the handler agree by construction.
 */
export const appointmentDtoSchema = z.strictObject({
  id: z.uuid(),
  facilityId: z.uuid(),
  patientId: z.uuid().nullable(),
  providerId: z.uuid(),
  type: z.strictObject({ code: z.string(), display: z.string() }),
  status: z.enum(APPOINTMENT_STATUSES),
  start: z.string(),
  end: z.string(),
  durationMinutes: z.int(),
  room: z.string().nullable(),
  reasonText: z.string().nullable(),
  recurrenceGroupId: z.uuid().nullable(),
  createdVia: z.enum(APPOINTMENT_CREATED_VIA),
  cancelReason: z.string().nullable(),
  checkedInAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AppointmentDto = z.infer<typeof appointmentDtoSchema>;

export function toAppointmentDto(row: AppointmentRow): AppointmentDto {
  return {
    id: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    providerId: row.providerId,
    // The type is carried inline rather than as a reference so renaming a
    // catalogue entry never rewrites what a past appointment was booked as.
    type: { code: row.typeCode, display: row.typeDisplay },
    status: row.status,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    durationMinutes: row.durationMinutes,
    room: row.room,
    reasonText: row.reasonText,
    recurrenceGroupId: row.recurrenceGroupId,
    createdVia: row.createdVia,
    cancelReason: row.cancelReason,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

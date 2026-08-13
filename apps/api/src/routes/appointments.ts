import { appointmentCreateInput } from '@openrunic/database';
import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import {
  appointmentDtoSchema,
  appointmentListQuerySchema,
  appointmentUpdateSchema,
  toAppointmentDto,
  toAppointmentListQuery,
  toAppointmentUpdateInput,
} from '../schemas/appointments.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import { idParamSchema, policyOf, repositories, required } from './helpers.js';

/**
 * Appointments. Same pattern as patients, plus the facility check.
 *
 * Booking is the one place in this router where the permission alone is not
 * enough: `appointment.write` says the role may book, and the facility grant
 * says where. Both are asked, and the facility one is asked before the write
 * rather than after, so a refused booking never reaches the database.
 */

const ERROR_RESPONSES = [
  { status: 400, description: 'The query string is not valid.', schema: problemDocumentSchema },
  { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
  {
    status: 403,
    description: 'The role lacks the permission, or the facility is not granted.',
    schema: problemDocumentSchema,
  },
] as const;

export const appointmentRouteContracts: RouteContract[] = [
  {
    method: 'get',
    path: '/bff/v0/appointments',
    operationId: 'listAppointments',
    summary: 'List appointments.',
    description:
      'The schedule day view is `facilityId` plus `from`/`to`; the Flow Board is `facilityId` plus `status`. `from` is inclusive and `to` exclusive, so one day is `[00:00, next 00:00)`.',
    tags: ['appointments'],
    permission: 'appointment.read',
    query: appointmentListQuerySchema,
    responses: [
      {
        status: 200,
        description: 'One page of appointments.',
        schema: listResponseSchema(appointmentDtoSchema),
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/appointments/{id}',
    operationId: 'readAppointment',
    summary: 'Read one appointment.',
    tags: ['appointments'],
    permission: 'appointment.read',
    pathParams: [{ name: 'id', description: 'Appointment id (UUIDv7).', schema: idParamSchema }],
    responses: [
      { status: 200, description: 'The appointment.', schema: appointmentDtoSchema },
      ...ERROR_RESPONSES,
      {
        status: 404,
        description: 'No such appointment in this organisation.',
        schema: problemDocumentSchema,
      },
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/appointments',
    operationId: 'createAppointment',
    summary: 'Book an appointment.',
    tags: ['appointments'],
    permission: 'appointment.write',
    body: appointmentCreateInput,
    responses: [
      { status: 201, description: 'The booked appointment.', schema: appointmentDtoSchema },
      ...ERROR_RESPONSES,
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
    ],
  },
  {
    method: 'patch',
    path: '/bff/v0/appointments/{id}',
    operationId: 'updateAppointment',
    summary: 'Reschedule, re-room or advance an appointment.',
    description:
      'Facility and patient are not patchable: moving either is a cancel and a rebook, which the status history has to show.',
    tags: ['appointments'],
    permission: 'appointment.write',
    pathParams: [{ name: 'id', description: 'Appointment id (UUIDv7).', schema: idParamSchema }],
    body: appointmentUpdateSchema,
    responses: [
      { status: 200, description: 'The updated appointment.', schema: appointmentDtoSchema },
      ...ERROR_RESPONSES,
      {
        status: 404,
        description: 'No such appointment in this organisation.',
        schema: problemDocumentSchema,
      },
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
    ],
  },
];

export function appointmentRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/appointments', requirePermission('appointment.read'), async (c) => {
    const input = parseQuery(c, appointmentListQuerySchema);
    if (input.facilityId !== undefined) {
      assertFacilityAccess(policyOf(c), input.facilityId);
    }
    const page = await repositories(c).appointments.list(toAppointmentListQuery(input));
    return c.json(toListResponse(page, toAppointmentDto));
  });

  router.get('/appointments/:id', requirePermission('appointment.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const row = required(await repositories(c).appointments.findById(id), 'No such appointment.');
    assertFacilityAccess(policyOf(c), row.facilityId);
    return c.json(toAppointmentDto(row));
  });

  router.post('/appointments', requirePermission('appointment.write'), async (c) => {
    const input = await parseJsonBody(c, appointmentCreateInput);
    assertFacilityAccess(policyOf(c), input.facilityId);
    const row = await repositories(c).appointments.create(input);
    return c.json(toAppointmentDto(row), 201, { Location: `/bff/v0/appointments/${row.id}` });
  });

  router.patch('/appointments/:id', requirePermission('appointment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, appointmentUpdateSchema);
    const existing = required(
      await repositories(c).appointments.findById(id),
      'No such appointment.'
    );
    assertFacilityAccess(policyOf(c), existing.facilityId);
    const row = await repositories(c).appointments.update(id, toAppointmentUpdateInput(body));
    return c.json(toAppointmentDto(required(row, 'No such appointment.')));
  });

  return router;
}

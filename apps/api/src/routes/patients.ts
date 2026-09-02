import { patientCreateInput, patientUpdateInput } from '@openrunic/database';
import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import { assertCareRelationship, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';
import {
  breakGlassGrantDtoSchema,
  breakGlassRequestSchema,
  patientDtoSchema,
  patientListQuerySchema,
  toBreakGlassGrantDto,
  toPatientDto,
  toPatientListQuery,
} from '../schemas/patients.js';

import { documentRouteContracts, documentRoutes } from './documents.js';
import { idParamSchema, repositories, required } from './helpers.js';

/**
 * Patients: the reference implementation for every other aggregate.
 *
 * What is worth copying from here. The write schemas are imported from
 * `@openrunic/database` rather than restated, so the API, the seed and the CLI
 * validate a patient identically. The handler never touches a tenant id - the
 * repository it is given is already bound to one. And the contracts below are
 * the same objects the OpenAPI document is generated from, so a route and its
 * documentation cannot drift.
 */

const ERROR_RESPONSES = [
  { status: 400, description: 'The query string is not valid.', schema: problemDocumentSchema },
  { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
  { status: 403, description: 'The role lacks the permission.', schema: problemDocumentSchema },
] as const;

export const patientRouteContracts: RouteContract[] = [
  ...documentRouteContracts(),
  {
    method: 'get',
    path: '/bff/v0/patients',
    operationId: 'listPatients',
    summary: 'Search the patient index.',
    description:
      'Offset-paginated. `q` is free text over name and MRN; `family` and `given` are case-insensitive prefix matches, matching the FHIR `string` search semantic.',
    tags: ['patients'],
    permission: 'patient.read',
    query: patientListQuerySchema,
    responses: [
      {
        status: 200,
        description: 'One page of patients.',
        schema: listResponseSchema(patientDtoSchema),
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/patients/{id}',
    operationId: 'readPatient',
    summary: 'Read one patient.',
    tags: ['patients'],
    permission: 'patient.read',
    pathParams: [{ name: 'id', description: 'Patient id (UUIDv7).', schema: idParamSchema }],
    responses: [
      { status: 200, description: 'The patient.', schema: patientDtoSchema },
      ...ERROR_RESPONSES,
      {
        status: 404,
        description: 'No such patient in this organisation.',
        schema: problemDocumentSchema,
      },
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/patients',
    operationId: 'createPatient',
    summary: 'Register a patient.',
    tags: ['patients'],
    permission: 'patient.write',
    body: patientCreateInput,
    responses: [
      { status: 201, description: 'The registered patient.', schema: patientDtoSchema },
      ...ERROR_RESPONSES,
      { status: 409, description: 'That MRN is taken.', schema: problemDocumentSchema },
      {
        status: 422,
        description: 'The body failed validation.',
        schema: problemDocumentSchema,
      },
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/patients/{id}/break-glass',
    operationId: 'breakGlass',
    summary: 'Take deliberate access to a chart you have no relationship with.',
    description:
      'For the patient in front of you when no encounter, appointment or care team names you. The reason is recorded against your name, the window expires, and every read taken under it is marked in the audit trail as break-glass rather than as ordinary access.',
    tags: ['patients'],
    permission: 'patient.read',
    pathParams: [{ name: 'id', description: 'Patient id (UUIDv7).', schema: idParamSchema }],
    body: breakGlassRequestSchema,
    responses: [
      { status: 201, description: 'The grant.', schema: breakGlassGrantDtoSchema },
      ...ERROR_RESPONSES,
      {
        status: 404,
        description: 'No such patient in this organisation.',
        schema: problemDocumentSchema,
      },
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
    ],
  },
  {
    method: 'patch',
    path: '/bff/v0/patients/{id}',
    operationId: 'updatePatient',
    summary: 'Amend a patient record.',
    description: 'Every field is optional; `mrn` is not reassignable.',
    tags: ['patients'],
    permission: 'patient.write',
    pathParams: [{ name: 'id', description: 'Patient id (UUIDv7).', schema: idParamSchema }],
    body: patientUpdateInput,
    responses: [
      { status: 200, description: 'The amended patient.', schema: patientDtoSchema },
      ...ERROR_RESPONSES,
      {
        status: 404,
        description: 'No such patient in this organisation.',
        schema: problemDocumentSchema,
      },
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
    ],
  },
];

export function patientRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  documentRoutes(router);

  router.get('/patients', requirePermission('patient.read'), async (c) => {
    const query = toPatientListQuery(parseQuery(c, patientListQuerySchema));
    const page = await repositories(c).patients.list(query);
    return c.json(toListResponse(page, toPatientDto));
  });

  router.get('/patients/:id', requirePermission('patient.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    // Holding `patient.read` says this role may open charts. It does not say
    // which, and until this call the answer was "any of them, if you know the
    // id". See `policy/care-relationship.ts`.
    await assertCareRelationship(c, id);
    const row = await repositories(c).patients.findById(id);
    // A patient in another organisation is reported as absent, not as
    // forbidden: a 403 here would confirm the id exists somewhere, which is an
    // enumeration oracle across tenants. The relationship check above refuses
    // the same way, and for the same reason inside one tenant.
    return c.json(toPatientDto(required(row, 'No such patient.')));
  });

  /**
   * Break-glass, and deliberately not gated by a care relationship.
   *
   * Gating it would be circular: this is the route you take precisely because
   * you have no relationship. What stands in its way instead is that the
   * patient must exist, the reason must say something, the window is bounded,
   * and the grant is written under the caller's own name.
   *
   * The patient is confirmed to exist first, and a missing one is a 404 with
   * nothing written. A grant recorded against a guessed id would turn this
   * route into the enumeration oracle the read path refuses to be.
   */
  router.post('/patients/:id/break-glass', requirePermission('patient.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, breakGlassRequestSchema);
    const repos = repositories(c);
    required(await repos.patients.findById(id), 'No such patient.');

    const principal = c.get('principal');
    const grant = await repos.breakGlassGrants.create({
      userId: principal?.subject ?? '',
      patientId: id,
      reason: body.reason,
      expiresAt: new Date(Date.now() + body.minutes * 60_000),
    });

    return c.json(toBreakGlassGrantDto(grant), 201);
  });

  router.post('/patients', requirePermission('patient.write'), async (c) => {
    const input = await parseJsonBody(c, patientCreateInput);
    const row = await repositories(c).patients.create(input);
    return c.json(toPatientDto(row), 201, { Location: `/bff/v0/patients/${row.id}` });
  });

  router.patch('/patients/:id', requirePermission('patient.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    /* Writing a chart needs at least as much standing as reading one. A rule
       that gated the read and not the amendment would be a rule anybody could
       walk round by sending a PATCH. */
    await assertCareRelationship(c, id);
    const input = await parseJsonBody(c, patientUpdateInput);
    const row = await repositories(c).patients.update(id, input);
    return c.json(toPatientDto(required(row, 'No such patient.')));
  });

  return router;
}

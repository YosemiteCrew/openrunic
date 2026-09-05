import { patientCreateInput, patientUpdateInput } from '@openrunic/database';
import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
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
      'For the patient in front of you when no encounter, appointment or care team names you. The reason is recorded against your name, the window expires, and every read taken under it is marked in the audit trail as break-glass rather than as ordinary access. Needs `patient.breakGlass`, which is deliberately not part of the read-only bundle: a route that grants a privilege must not be gated on the privilege it grants. Re-declaring for a chart already open returns the grant already held (200) rather than filing another.',
    tags: ['patients'],
    permission: 'patient.breakGlass',
    pathParams: [{ name: 'id', description: 'Patient id (UUIDv7).', schema: idParamSchema }],
    body: breakGlassRequestSchema,
    responses: [
      { status: 201, description: 'The grant.', schema: breakGlassGrantDtoSchema },
      {
        status: 200,
        description: 'A grant for this chart was already held and is returned unchanged.',
        schema: breakGlassGrantDtoSchema,
      },
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

/**
 * How many charts one reader may hold open under break-glass at once.
 *
 * Set where a real emergency never reaches it and a sweep always does. One
 * patient is the emergency; a handful across a bad afternoon is plausible; ten
 * concurrent, unexpired declarations by one person is not a clinical situation.
 * It counts only unexpired grants, so it drains without anybody clearing it.
 */
const MAX_CONCURRENT_GRANTS = 10;

/**
 * How many declarations one reader may make in a rolling window, and how long
 * that window is.
 *
 * The ceiling above counts what is still in force, and the caller picks the
 * expiry. Asking for a one-minute window empties all ten slots a minute later,
 * so on its own the ceiling limits how many charts are open at an instant and
 * not how many charts a person can walk through in an afternoon. This one
 * counts declarations rather than live grants, so shortening the window makes
 * no difference to it.
 *
 * It is deliberately looser than the ceiling. A bad night in an emergency
 * department is several declarations; twenty in a day by one person is a sweep,
 * and the refusal names an administrator because by then somebody should look.
 */
const MAX_GRANTS_PER_WINDOW = 20;
const GRANT_WINDOW_HOURS = 24;

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
   * Gating it on a relationship would be circular: this is the route you take
   * precisely because you have no relationship. What stands in its way instead
   * is everything below, and each piece is here because without it the route
   * hands out what the relationship check was added to protect.
   *
   * It is NOT gated on `patient.read`. Gating a privilege-granting route on the
   * privilege it grants makes it self-service: every role that may read a chart
   * could grant itself every chart, one request at a time, and the only thing
   * standing in the way would be the audit record. That is detection, which is
   * exactly the control #169 rejected as insufficient. `patient.breakGlass` is
   * a separate capability that `read-only` and `patient-portal` do not hold.
   */
  router.post('/patients/:id/break-glass', requirePermission('patient.breakGlass'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, breakGlassRequestSchema);
    const repos = repositories(c);

    /*
     * The identity is read, never defaulted. `userId` is the one column that
     * makes a grant evidence, and `?? ''` would write a row attributable to
     * nobody the moment this route were remounted outside the policy chain -
     * the same failure `assertCareRelationship` refuses to let pass silently.
     *
     * A non-staff actor is refused outright, and this is a backstop rather than
     * the control: `patient-portal` does not hold `patient.breakGlass`, so the
     * shipped roles never reach here. It earns its place for a tenant that
     * forks the roles and grants the capability somewhere it does not belong -
     * `Principal.subject` is a User id for staff and a Patient id for the
     * portal, and this column is a foreign key to `User`, so such a grant would
     * either violate the key or, on a store that does not check it, name a
     * patient as its own taker. A portal user never needs one in any case:
     * `own-record` already covers their one chart.
     */
    const principal = c.get('principal');
    if (principal === undefined) {
      throw ApiError.unauthenticated('A bearer token is required.');
    }
    if (principal.actorType !== 'user') {
      throw ApiError.forbidden('Break-glass is taken by a member of staff.');
    }

    /*
     * A refused declaration is audited before it is refused, and the two
     * refusals below are deliberately the same 404.
     *
     * Without the audit, a sweep of guessed ids leaves no trace at all: every
     * miss is silent, and the route's own promise not to be an enumeration
     * oracle would rest on a status code that still differs from a hit. It
     * still differs - a real id answers 201 - so the record is what makes the
     * sweep visible rather than the response.
     */
    const refuse = async (reason: string): Promise<never> => {
      await c.get('audit')?.denial({
        action: 'breakGlass.denied',
        targetType: 'Patient',
        targetId: id,
        patientId: id,
        metadata: { reason, roles: [...principal.roles] },
      });
      throw ApiError.notFound('No such patient.');
    };

    if ((await repos.patients.findById(id)) === null) await refuse('no-such-patient');

    const now = new Date();
    const held = await repos.breakGlassGrants.list({
      page: 1,
      pageSize: MAX_CONCURRENT_GRANTS + 1,
      sort: 'grantedAt',
      order: 'desc',
      userId: principal.subject,
      unexpiredAt: now,
    });

    /*
     * A second declaration for a chart already open returns the grant already
     * held rather than filing another. Re-declaring is ordinary - the window is
     * short and an emergency outlasts it - and a row per attempt would turn one
     * clinician's afternoon into a wall of records that buries the sweep this
     * table exists to make visible.
     */
    const existing = held.rows.find((row) => row.patientId === id);
    if (existing !== undefined) return c.json(toBreakGlassGrantDto(existing), 200);

    /*
     * A ceiling on charts held open at once, and it is the only thing here that
     * makes the difference between a control and a record.
     *
     * Break-glass on one patient is the emergency. Break-glass on ten at once is
     * not a clinical situation, it is a sweep, and without this an account
     * holding no write permission at all could take the whole practice one
     * request at a time. The ceiling is per reader and counts only unexpired
     * grants, so it drains on its own and never becomes a lockout somebody has
     * to be paged to clear.
     */
    if (held.total >= MAX_CONCURRENT_GRANTS) {
      await c.get('audit')?.denial({
        action: 'breakGlass.denied',
        targetType: 'Patient',
        targetId: id,
        patientId: id,
        metadata: { reason: 'ceiling', held: held.total, roles: [...principal.roles] },
      });
      throw ApiError.forbidden(
        `Break-glass is limited to ${String(MAX_CONCURRENT_GRANTS)} charts at once. ` +
          'Wait for one to expire, or ask an administrator.'
      );
    }

    /*
     * And a bound the caller cannot shorten their way out of.
     *
     * The ceiling counts what is still in force, which is a number a one-minute
     * expiry resets. This counts declarations made in the trailing window
     * whatever became of them, so ten charts, wait a minute, ten more is the
     * pattern it stops. Refusing here is a lockout that needs an administrator,
     * which is the point: at twenty declarations in a day somebody should be
     * looking at this account rather than waiting for it to drain.
     */
    const madeSince = new Date(now.getTime() - GRANT_WINDOW_HOURS * 60 * 60_000);
    const made = await repos.breakGlassGrants.list({
      page: 1,
      pageSize: 1,
      sort: 'grantedAt',
      order: 'desc',
      userId: principal.subject,
      grantedSince: madeSince,
    });
    if (made.total >= MAX_GRANTS_PER_WINDOW) {
      await c.get('audit')?.denial({
        action: 'breakGlass.denied',
        targetType: 'Patient',
        targetId: id,
        patientId: id,
        metadata: { reason: 'rolling-limit', made: made.total, roles: [...principal.roles] },
      });
      throw ApiError.forbidden(
        `Break-glass is limited to ${String(MAX_GRANTS_PER_WINDOW)} declarations in ` +
          `${String(GRANT_WINDOW_HOURS)} hours. Ask an administrator.`
      );
    }

    /*
     * The create, and the recovery from losing a race to it.
     *
     * The existing-grant check above and this call are two round trips with
     * nothing held between them, so two declarations for the same chart
     * arriving together both read no grant and both arrive here. The database
     * refuses the second - `break_glass_ceiling` takes an advisory lock on
     * (tenant, user) and, under it, refuses an insert for a chart this reader
     * already holds open - which is what makes "at most one unexpired grant per
     * chart" true rather than merely usual.
     *
     * A refusal is not the answer this route documents, though. Losing the race
     * is indistinguishable from re-declaring a moment later, and re-declaring
     * returns the grant already held. So the loser reads again and returns the
     * winner's grant, and the caller sees the documented 200 either way.
     *
     * It recovers on any failed create rather than on a matched error code. A
     * grant that was absent when this handler looked and present a moment later
     * can only be this race, because every other path returns before reaching
     * this call: an unknown patient, a chart already held, the ceiling and the
     * rolling bound all answer above. Matching a code would have meant
     * depending on how one client library spells one database's SQLSTATE, and
     * getting that wrong fails in the direction of a 500 on the request the
     * route promises to answer.
     *
     * WHAT THIS DOES NOT COVER, because the shape of the block suggests
     * otherwise: it recovers the repeat-declaration race and only that one. The
     * two bounds have a race of their own - the same reader declaring on two
     * DIFFERENT charts at ceiling minus one, where both pass the check above,
     * the trigger refuses the second, and the re-read below finds nothing
     * because it is scoped to this chart. That rethrows, so a caller who would
     * have been given a readable 403 and an audit denial gets a 500 instead.
     *
     * Left alone deliberately. It is unchanged from before this catch existed -
     * there the same request was a 500 with no catch at all - and answering it
     * properly means mapping the ceiling refusal to the refusal the handler
     * already knows how to write, which is a different change with its own
     * audit event to get right. Named here so the next reader does not assume
     * a failed create is handled in general.
     */
    let grant;
    try {
      grant = await repos.breakGlassGrants.create({
        userId: principal.subject,
        patientId: id,
        reason: body.reason,
        /* The same `now` the checks above were taken against, and the same one
           the window is measured from. Three readings of the clock would give
           three answers to "is that grant still in force" near a boundary. */
        grantedAt: now,
        expiresAt: new Date(now.getTime() + body.minutes * 60_000),
      });
    } catch (error) {
      const raced = await repos.breakGlassGrants.list({
        page: 1,
        pageSize: 1,
        sort: 'grantedAt',
        order: 'desc',
        userId: principal.subject,
        patientId: id,
        unexpiredAt: new Date(),
      });
      const won = raced.rows[0];
      if (won === undefined) throw error;
      return c.json(toBreakGlassGrantDto(won), 200);
    }

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

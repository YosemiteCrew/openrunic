import type { AdapterError, AdapterRegistry } from '@openrunic/adapters';
import { Hono } from 'hono';

import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import type { RouteContract } from '../openapi/registry.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import {
  joinTokenSchema,
  telehealthJoinSchema,
  telehealthEndSchema,
  telehealthListQuerySchema,
  telehealthVisitDtoSchema,
  toTelehealthListQuery,
  toTelehealthVisitDto,
  type JoinTokenResponse,
  type TelehealthVisitDto,
} from '../schemas/telehealth.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import { gateCharts, idParam, idParamSchema, policyOf, repositories, required } from './helpers.js';

/**
 * TELEHEALTH: A ROOM FOR ONE VISIT, AND A TOKEN PER PERSON WHO MAY ENTER IT.
 *
 * The vendor owns the room. This API owns the record that a room existed, which
 * appointment it belonged to, and when it ended. That split is why the adapter
 * seam exists, and it is what lets a practice change vendor without losing the
 * history of the visits it has already held.
 *
 * ## No token is ever stored
 *
 * `TelehealthVisit` has no column for a join token and this module never writes
 * one anywhere. A token admits its bearer to a consultation; persisting one
 * would turn every later read of that table, every nightly backup and every
 * support export into a way into a patient's appointment, long after it ended.
 *
 * Tokens are therefore issued on demand and returned exactly once, in the
 * response to the request that asked for one. A caller that loses a token asks
 * for another, which is cheap, and the alternative is not.
 *
 * ## Why the failures are answered the way they are
 *
 * A vendor that is down is a 503 the caller may retry. A vendor that refuses is
 * a 502: retrying will not help, and pretending the room exists would send a
 * clinician to a waiting room that is not there. Neither answer carries the
 * vendor's own message: a vendor's error text is written for whoever integrated
 * it, and forwarding it to an API caller leaks the deployment's internals - a
 * room identifier, a vendor account, the shape of a misconfiguration - to
 * someone who can do nothing with it and should not see it. The caller here is
 * staff or a service, never a patient, and the reasoning holds for both.
 */

const NO_VISIT = 'No such telehealth visit.';
const NO_APPOINTMENT = 'No such appointment.';

/**
 * How long after the scheduled start a room stays usable, in minutes.
 *
 * The vendor decides the real expiry and reports it back; this is only what the
 * adapter is asked for. Generous on purpose: a visit that runs long is normal,
 * and a room that closes underneath a consultation in progress is the failure
 * worth avoiding.
 */
const DEFAULT_VISIT_MINUTES = 30;

/** Turns an adapter failure into an answer, without repeating the vendor's words. */
function fromAdapter(error: AdapterError): ApiError {
  if (error.kind === 'timeout' || error.kind === 'unavailable') {
    return ApiError.badGateway('The telehealth vendor did not answer. Try again.');
  }
  if (error.kind === 'misconfigured' || error.kind === 'unauthorized') {
    // Not the caller's problem and not something they can fix by retrying. It
    // belongs in the deployment's logs, which the registry's call record has
    // already written.
    return ApiError.badGateway('The telehealth vendor is not configured for this deployment.');
  }
  return ApiError.badGateway('The telehealth vendor refused the request.');
}

function videoAdapter(registry: AdapterRegistry) {
  const resolved = registry.resolve('video');
  if (!resolved.ok) {
    throw ApiError.notImplemented('This deployment has no telehealth vendor configured.');
  }
  return resolved.value;
}

/**
 * Telehealth room management is staff work, and this refuses everyone else.
 *
 * Every route here reads or writes the shared `TelehealthVisit` table, which
 * carries no patient column and so cannot be narrowed to one chart at the data
 * layer. A patient-portal token holds `appointment.read` and `appointment.write`
 * and would otherwise reach all of it: list every patient's OPEN visit and lift
 * the join URL, or drive the open-room route into a second vendor room the
 * preflight cannot see. A patient joins their own visit by the passwordless link
 * they are sent; they never open, end, or list a room. Every handler here calls this
 * first, before it reads the appointment or the visit table.
 */
async function assertStaff(c: Context<AppEnv>): Promise<void> {
  const principal = c.get('principal');
  // Three ways a patient reaches here, and any one of them is refused, because
  // no single signal is reliable on its own. A portal token bound to a chart
  // carries `compartmentPatientId`. A patient principal issued without a patient
  // scope carries none, so the actor type is checked too - but `actor_type` is
  // an optional OIDC claim that `readActorType` defaults to `user` when it is
  // absent, so a portal token that omits it would still read as staff. The role
  // is what the issuer always sets, so `patient-portal` is the backstop.
  // `service` is left through on all three: a trusted integration is not a
  // patient, and telehealth rooms are opened by machines as well as people.
  const isPatient =
    principal === undefined ||
    principal.compartmentPatientId !== undefined ||
    principal.actorType === 'patient' ||
    principal.roles.includes('patient-portal');
  if (isPatient) {
    // Audited like every other authorisation denial. `requirePermission` passed
    // - the portal role holds the appointment permission - so without this the
    // only refusal on the request would leave no denial in the trail, and a
    // sweep of these routes would be invisible.
    await c.get('audit')?.denial({
      action: 'authorisation.denied',
      targetType: 'Route',
      targetId: c.req.path,
      metadata: {
        reason: 'staff-only',
        roles: principal === undefined ? [] : [...principal.roles],
      },
    });
    throw ApiError.forbidden('Telehealth rooms are managed by staff.');
  }
}

export function telehealthRoutes(registry: AdapterRegistry): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /**
   * Opening a room for an appointment.
   *
   * The appointment is read first, through the same scoped collection as
   * everything else, so an appointment in another organisation is absent rather
   * than forbidden and no room is created for it.
   *
   * A second call for the same appointment is refused rather than opening
   * another room. Two rooms for one visit is two waiting rooms, and half the
   * participants end up in the one nobody is watching.
   */
  router.post('/appointments/:id/telehealth', requirePermission('appointment.write'), async (c) => {
    await assertStaff(c);
    const appointmentId = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);
    const appointment = required(await repos.appointments.findById(appointmentId), NO_APPOINTMENT);
    // The appointment's own site, checked the same way `/appointments/:id`
    // checks it. Without this a principal granted one site could open a room on
    // an appointment at another, and opening a room is a write: it creates a
    // TelehealthVisit and asks a vendor for a joinable address.
    //
    // `facilityId` is where the visit happens, so it is a containment boundary
    // rather than an attribution, and narrowing on it costs a legitimate caller
    // nothing.
    assertFacilityAccess(policyOf(c), appointment.facilityId);
    /*
     * And then the chart, because opening a room is a write on somebody's
     * record. This route is registered by hand, so the CRUD seam's gate never
     * ran on it (#322).
     *
     * THE ORDER IS DELIBERATE AND IT IS THE OPPOSITE OF `clinical.ts` AND
     * `financial.ts`, which ask the chart first. `crud.ts` documents the reason
     * for this one - the chart refusal runs after the facility check so it
     * reveals nothing the facility check would already have hidden - and here
     * that is observable rather than theoretical: `refuses a principal who may
     * not reach the appointment's site` asserts **403**, and asking the chart
     * first turns it into a 404. Preserving that answer is worth more than
     * matching the other two files.
     *
     * `requiredParentChart` cannot express this, since it couples the read to
     * the gate on purpose. So the read and the gate are three lines apart and
     * this comment is the thing keeping them together; do not put anything
     * between them that can return.
     *
     * WHEN IT CAN ACTUALLY REFUSE, because it is narrower than it looks.
     * `facility-activity` grants the relationship from a live appointment,
     * narrowed by the repository to the caller's own sites, and the check above
     * passes only for a caller granted this appointment's site - so for a
     * BOOKED appointment the two coincide and this cannot refuse anyone the
     * facility check let through. It bites on the rows `facility-activity`
     * excludes: CANCELLED, ENTERED_IN_ERROR, and a start more than a year past.
     * Driven on `dev`, a clinician with no relationship opened a room on a
     * CANCELLED appointment and got 201.
     */
    await gateCharts(c, 'appointments', [appointment]);

    const existing = await repos.telehealthVisits.list({
      page: 1,
      pageSize: 1,
      sort: 'scheduledStart',
      order: 'desc',
      appointmentId,
    });
    const open = existing.rows[0];
    if (open !== undefined) {
      throw ApiError.conflict(`This appointment already has a room, visit ${open.id}.`);
    }

    const room = await videoAdapter(registry).createVisitRoom({
      appointmentRef: appointmentId,
      scheduledStart: appointment.start.toISOString(),
      expectedMinutes: appointment.durationMinutes ?? DEFAULT_VISIT_MINUTES,
      // Asked for, and the vendor may not offer it. The adapter reports what it
      // actually did, and this record does not claim a waiting room existed.
      waitingRoom: false,
    });
    if (!room.ok) throw fromAdapter(room.error);

    const row = await repos.telehealthVisits.create({
      appointmentId,
      vendorId: videoAdapter(registry).descriptor.vendorId,
      roomRef: room.value.roomRef,
      joinUrl: room.value.joinUrl,
      scheduledStart: appointment.start,
      expiresAt: new Date(room.value.expiresAt),
    });

    return c.json<TelehealthVisitDto>(toTelehealthVisitDto(row), 201, {
      Location: `/bff/v0/telehealth/${row.id}`,
    } satisfies Record<string, string>);
  });

  /**
   * Issuing one person's way in.
   *
   * The token comes back in this response and is written nowhere. Read the
   * module header for why.
   *
   * A visit that has ended issues nothing. The vendor would refuse anyway, but
   * refusing here means a finished consultation cannot be rejoined even if a
   * vendor is lenient about it, and lenient is what vendors are.
   */
  router.post('/telehealth/:id/join', requirePermission('appointment.read'), async (c) => {
    await assertStaff(c);
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, telehealthJoinSchema);
    const repos = repositories(c);
    const visit = required(await repos.telehealthVisits.findById(id), NO_VISIT);

    if (visit.status !== 'OPEN') {
      throw ApiError.conflict(`This visit is ${visit.status} and cannot be joined.`);
    }

    const issued = await videoAdapter(registry).issueJoinToken({
      roomRef: visit.roomRef,
      participantRef: body.participantId,
      role: body.role,
      ttlSeconds: body.ttlSeconds,
    });
    if (!issued.ok) throw fromAdapter(issued.error);

    return c.json<JoinTokenResponse>({
      visitId: visit.id,
      joinUrl: visit.joinUrl,
      role: issued.value.role,
      token: issued.value.token,
      expiresAt: issued.value.expiresAt,
    });
  });

  /**
   * Ending the visit.
   *
   * The duration the vendor reports is kept, because billing reads it as one
   * input to visit length. It is the vendor's wall clock and is stored as such:
   * it is not a claim about how long anybody was in the room.
   */
  router.post('/telehealth/:id/end', requirePermission('appointment.write'), async (c) => {
    await assertStaff(c);
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, telehealthEndSchema);
    const repos = repositories(c);
    const visit = required(await repos.telehealthVisits.findById(id), NO_VISIT);

    if (visit.status !== 'OPEN') {
      throw ApiError.conflict(`This visit is already ${visit.status}.`);
    }

    const ended = await videoAdapter(registry).endVisitRoom({
      roomRef: visit.roomRef,
      ...(body.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
    });
    if (!ended.ok) throw fromAdapter(ended.error);

    const row = required(
      await repos.telehealthVisits.update(id, {
        status: 'ENDED',
        endedAt: new Date(ended.value.endedAt),
        durationSeconds: ended.value.durationSeconds,
        ...(body.reasonCode === undefined ? {} : { endedReason: body.reasonCode }),
      }),
      NO_VISIT
    );
    return c.json<TelehealthVisitDto>(toTelehealthVisitDto(row));
  });

  router.get('/telehealth/:id', requirePermission('appointment.read'), async (c) => {
    await assertStaff(c);
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const visit = required(await repositories(c).telehealthVisits.findById(id), NO_VISIT);
    return c.json<TelehealthVisitDto>(toTelehealthVisitDto(visit));
  });

  router.get('/telehealth', requirePermission('appointment.read'), async (c) => {
    await assertStaff(c);
    const query = toTelehealthListQuery(parseQuery(c, telehealthListQuerySchema));
    const page = await repositories(c).telehealthVisits.list(query);
    return c.json(toListResponse(page, toTelehealthVisitDto));
  });

  return router;
}

/* ----------------------------------------------------------------- contracts */

const VISIT_ERRORS = [
  { status: 400, description: 'The request was malformed.' },
  { status: 401, description: 'No bearer token, or one that is not valid.' },
  {
    status: 403,
    description:
      'The principal lacks the permission this route needs, or is a patient: telehealth rooms are managed by staff, and a patient-portal principal is refused every operation here.',
  },
  { status: 422, description: 'The body failed validation.' },
] as const;

const BAD_GATEWAY = {
  status: 502,
  description: 'The telehealth vendor did not answer, or refused. The vendor is never quoted.',
} as const;

export function telehealthRouteContracts(): RouteContract[] {
  return [
    {
      method: 'post',
      path: '/bff/v0/appointments/{id}/telehealth',
      operationId: 'openTelehealthVisit',
      summary: 'Open a video room for an appointment.',
      description:
        'Asks the configured telehealth vendor for a room and records that it exists. One room per appointment: a second call is refused rather than opening another. No join token is created here, and none is stored anywhere.',
      tags: ['telehealth'],
      permission: 'appointment.write',
      pathParams: [idParam('Appointment')],
      responses: [
        { status: 201, description: 'The visit.', schema: telehealthVisitDtoSchema },
        ...VISIT_ERRORS,
        { status: 404, description: 'No such appointment.' },
        { status: 409, description: 'This appointment already has a room.' },
        { status: 501, description: 'This deployment has no telehealth vendor configured.' },
        BAD_GATEWAY,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/telehealth/{id}/join',
      operationId: 'issueTelehealthJoinToken',
      summary: 'Issue one participant a way into the room.',
      description:
        'Returns a short-lived token for one named participant. The token is returned exactly once and is never persisted: a caller that loses one asks for another. A visit that has ended issues nothing.',
      tags: ['telehealth'],
      permission: 'appointment.read',
      pathParams: [idParam('TelehealthVisit')],
      body: telehealthJoinSchema,
      responses: [
        { status: 200, description: 'The token, returned once.', schema: joinTokenSchema },
        ...VISIT_ERRORS,
        { status: 404, description: 'No such telehealth visit.' },
        { status: 409, description: 'The visit has ended or expired.' },
        { status: 501, description: 'This deployment has no telehealth vendor configured.' },
        BAD_GATEWAY,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/telehealth/{id}/end',
      operationId: 'endTelehealthVisit',
      summary: 'End the visit.',
      description:
        'Closes the room at the vendor and records when it ended and how long it ran. Ending twice is refused.',
      tags: ['telehealth'],
      permission: 'appointment.write',
      pathParams: [idParam('TelehealthVisit')],
      body: telehealthEndSchema,
      responses: [
        { status: 200, description: 'The ended visit.', schema: telehealthVisitDtoSchema },
        ...VISIT_ERRORS,
        { status: 404, description: 'No such telehealth visit.' },
        { status: 409, description: 'The visit has already ended.' },
        { status: 501, description: 'This deployment has no telehealth vendor configured.' },
        BAD_GATEWAY,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/telehealth/{id}',
      operationId: 'getTelehealthVisit',
      summary: 'Read one telehealth visit.',
      description: 'The record that a room existed. Carries no token.',
      tags: ['telehealth'],
      permission: 'appointment.read',
      pathParams: [idParam('TelehealthVisit')],
      responses: [
        { status: 200, description: 'The visit.', schema: telehealthVisitDtoSchema },
        ...VISIT_ERRORS,
        { status: 404, description: 'No such telehealth visit.' },
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/telehealth',
      operationId: 'listTelehealthVisits',
      summary: 'List telehealth visits.',
      description:
        "Today's video list is `status=OPEN` with a `from`/`to` window on the scheduled start.",
      tags: ['telehealth'],
      permission: 'appointment.read',
      query: telehealthListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'The visits.',
          schema: listResponseSchema(telehealthVisitDtoSchema),
        },
        ...VISIT_ERRORS,
      ],
    },
  ];
}

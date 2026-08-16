import { referralInput } from '@openrunic/database';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { ReferralStatus } from '../repositories/specs/clinical.js';
import type { ScopedRow } from '../repositories/types.js';
import { idParamSchema, repositories, required } from './helpers.js';

/**
 * REFERRALS, AND THE LOOP THEY HAVE TO CLOSE.
 *
 * Creating a referral is the easy half and not the half that goes wrong. The
 * failure this exists to prevent is the one where a patient is referred and the
 * practice never finds out what happened: whether they were seen, whether the
 * specialist declined, whether a report came back and went unread. That gap is
 * where diagnoses are lost, and it is invisible from inside a system that only
 * records that a referral was made.
 *
 * So the shape here is a lifecycle rather than a form. Each transition below is
 * its own route because each stamps a different fact - sent, scheduled, seen,
 * report received - and those are separately unknown. A single `PATCH status`
 * would let a caller move a referral to COMPLETED without ever recording when
 * the patient was seen, which is precisely the state that looks closed and is
 * not.
 *
 * ## The transition graph, and why it is not a straight line
 *
 * A referral does not always go SENT -> ACCEPTED -> SCHEDULED -> SEEN. Practices
 * schedule before the specialist has formally accepted; reports arrive for
 * patients nobody recorded as seen; a referral is declined weeks after it was
 * accepted because the specialist retired. The graph below permits the paths
 * that actually happen and refuses the ones that would corrupt the record - a
 * referral cannot go back to DRAFT once sent, and nothing leaves a terminal
 * status except into ENTERED_IN_ERROR.
 */

/**
 * Which statuses each status may move to.
 *
 * `ENTERED_IN_ERROR` is reachable from everywhere and leads nowhere, which is
 * what makes it a correction rather than a state: a referral raised by mistake
 * is struck out, not deleted, so the audit trail still shows it existed.
 */
const REFERRAL_TRANSITIONS: Readonly<Record<ReferralStatus, readonly ReferralStatus[]>> = {
  DRAFT: ['SENT', 'CANCELLED', 'ENTERED_IN_ERROR'],
  // SENT reaches both SCHEDULED and SEEN directly. Scheduling before a formal
  // acceptance is the norm at some practices, and a small practice often learns
  // nothing at all until the report arrives - at which point the true sequence
  // is "sent, then seen". Forcing the intermediate steps would make the honest
  // record impossible to enter, and a lifecycle nobody can follow is one people
  // route around.
  SENT: ['ACCEPTED', 'DECLINED', 'SCHEDULED', 'SEEN', 'CANCELLED', 'ENTERED_IN_ERROR'],
  ACCEPTED: ['SCHEDULED', 'SEEN', 'DECLINED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  SCHEDULED: ['SEEN', 'DECLINED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  // A report can arrive for a patient nobody recorded as seen, so COMPLETED is
  // reachable from SCHEDULED's successor and from SEEN alike.
  SEEN: ['COMPLETED', 'ENTERED_IN_ERROR'],
  COMPLETED: ['ENTERED_IN_ERROR'],
  DECLINED: ['SENT', 'ENTERED_IN_ERROR'],
  CANCELLED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

const referralDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  encounterId: z.string().nullable(),
  referredById: z.string(),
  status: z.string(),
  priority: z.string(),
  specialtyCode: z.string(),
  specialtyDisplay: z.string(),
  receivingPractice: z.string(),
  receivingNpi: z.string().nullable(),
  receivingPhone: z.string().nullable(),
  reasonCodes: z.array(z.string()),
  reasonText: z.string().nullable(),
  note: z.string().nullable(),
  authorisationNumber: z.string().nullable(),
  sentAt: z.string().nullable(),
  scheduledFor: z.string().nullable(),
  seenAt: z.string().nullable(),
  reportReceivedAt: z.string().nullable(),
  reportDocumentId: z.string().nullable(),
  declinedReason: z.string().nullable(),
  /** Derived, not stored: what this referral is still waiting on. */
  awaiting: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const referralListQuerySchema = z.object({
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  referredById: z.uuid().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  specialtyCode: z.string().optional(),
  /** `true` for the outstanding-referrals tray. */
  openOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  sort: z.enum(['createdAt', 'sentAt', 'priority']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const sendSchema = z.object({
  /** Overrides the recipient recorded at creation, when it changed. */
  receivingPractice: z.string().min(1).max(200).optional(),
  authorisationNumber: z.string().min(1).max(64).optional(),
});

const scheduleSchema = z.object({ scheduledFor: z.coerce.date() });
const seenSchema = z.object({ seenAt: z.coerce.date() });
const declineSchema = z.object({ reason: z.string().min(1).max(500) });
const reportSchema = z.object({
  reportReceivedAt: z.coerce.date(),
  /** The filed document, when there is one to point at. */
  reportDocumentId: z.uuid().optional(),
});

/**
 * What a referral is still waiting on, in the words a person would use.
 *
 * Derived on read rather than stored, because it is a restatement of the
 * timestamps rather than a fact of its own - and a stored copy is one that goes
 * stale the first time somebody backfills a date.
 */
function awaiting(row: ScopedRow<'Referral'>): string | null {
  if (row.status === 'DRAFT') return 'to be sent';
  if (row.status === 'DECLINED') return 'a new recipient';
  if (row.status === 'CANCELLED' || row.status === 'ENTERED_IN_ERROR') return null;
  if (row.reportReceivedAt !== null) return null;
  if (row.seenAt !== null) return 'a report';
  if (row.scheduledFor !== null) return 'the appointment';
  return 'an appointment';
}

function toDto(row: ScopedRow<'Referral'>): z.infer<typeof referralDtoSchema> {
  const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    referredById: row.referredById,
    status: row.status,
    priority: row.priority,
    specialtyCode: row.specialtyCode,
    specialtyDisplay: row.specialtyDisplay,
    receivingPractice: row.receivingPractice,
    receivingNpi: row.receivingNpi,
    receivingPhone: row.receivingPhone,
    reasonCodes: row.reasonCodes,
    reasonText: row.reasonText,
    note: row.note,
    authorisationNumber: row.authorisationNumber,
    sentAt: iso(row.sentAt),
    scheduledFor: iso(row.scheduledFor),
    seenAt: iso(row.seenAt),
    reportReceivedAt: iso(row.reportReceivedAt),
    reportDocumentId: row.reportDocumentId,
    declinedReason: row.declinedReason,
    awaiting: awaiting(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Refuses a move the graph does not permit, naming both ends. */
function assertTransition(from: ReferralStatus, to: ReferralStatus): void {
  if (!REFERRAL_TRANSITIONS[from].includes(to)) {
    throw ApiError.conflict(
      `A referral cannot move from ${from} to ${to}. Permitted from ${from}: ${
        REFERRAL_TRANSITIONS[from].join(', ') || 'nothing'
      }.`
    );
  }
}

const MISSING = 'No such referral.';

export function referralRoutes(router: Hono<AppEnv>): void {
  const load = async (c: Context<AppEnv>, id: string): Promise<ScopedRow<'Referral'>> =>
    required(await repositories(c).referrals.findById(id), MISSING);

  /**
   * Applies a transition and answers the referral as it now stands.
   *
   * `update` answers null for a row this tenant cannot see, which is the same
   * answer as a row that does not exist - so it becomes the same 404 rather than
   * a 500, and the status stays useless as an oracle for what exists elsewhere.
   */
  const save = async (
    c: Context<AppEnv>,
    id: string,
    patch: Parameters<ReturnType<typeof repositories>['referrals']['update']>[1]
  ): Promise<Response> =>
    c.json(toDto(required(await repositories(c).referrals.update(id, patch), MISSING)));

  /** Loads, checks the move is one the graph permits, and hands back the row. */
  const step = async (c: Context<AppEnv>, to: ReferralStatus): Promise<ScopedRow<'Referral'>> => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const row = await load(c, id);
    assertTransition(row.status, to);
    return row;
  };

  router.get('/referrals', requirePermission('order.read'), async (c) => {
    const query = referralListQuerySchema.parse(c.req.query());
    const page = await repositories(c).referrals.list({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
      sort: query.sort ?? 'createdAt',
      order: query.order ?? 'desc',
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.referredById === undefined ? {} : { referredById: query.referredById }),
      ...(query.status === undefined ? {} : { status: query.status as ReferralStatus }),
      ...(query.priority === undefined
        ? {}
        : { priority: query.priority as ScopedRow<'Referral'>['priority'] }),
      ...(query.specialtyCode === undefined ? {} : { specialtyCode: query.specialtyCode }),
      ...(query.openOnly === 'true' ? { openOnly: true } : {}),
    });

    return c.json({
      items: page.rows.map(toDto),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    });
  });

  router.get('/referrals/:id', requirePermission('order.read'), async (c) =>
    c.json(toDto(await load(c, parseParam(c.req.param('id'), idParamSchema, 'id'))))
  );

  router.post('/referrals', requirePermission('order.write'), async (c) => {
    const body = await parseJsonBody(c, referralInput);
    return c.json(toDto(await repositories(c).referrals.create(body)), 201);
  });

  /**
   * Sending. The transition that starts the clock.
   *
   * `sentAt` is stamped here rather than accepted from the caller, because it is
   * the moment this practice let go of the referral - a caller-supplied one
   * would let a backdated send hide how long something has been outstanding,
   * which is the number the tray exists to show.
   */
  router.post('/referrals/:id/send', requirePermission('order.write'), async (c) => {
    const row = await step(c, 'SENT');
    const body = await parseJsonBody(c, sendSchema);

    return save(c, row.id, {
      status: 'SENT',
      sentAt: new Date(),
      ...(body.receivingPractice === undefined
        ? {}
        : { receivingPractice: body.receivingPractice }),
      ...(body.authorisationNumber === undefined
        ? {}
        : { authorisationNumber: body.authorisationNumber }),
    });
  });

  router.post('/referrals/:id/accept', requirePermission('order.write'), async (c) =>
    save(c, (await step(c, 'ACCEPTED')).id, { status: 'ACCEPTED' })
  );

  router.post('/referrals/:id/decline', requirePermission('order.write'), async (c) => {
    const row = await step(c, 'DECLINED');
    const body = await parseJsonBody(c, declineSchema);

    // The reason is required rather than optional. A declined referral has to be
    // sent somewhere else, and the person doing that needs to know whether it
    // was the wrong specialty, a closed list, or an insurance problem.
    return save(c, row.id, { status: 'DECLINED', declinedReason: body.reason });
  });

  router.post('/referrals/:id/schedule', requirePermission('order.write'), async (c) => {
    const row = await step(c, 'SCHEDULED');
    const body = await parseJsonBody(c, scheduleSchema);

    return save(c, row.id, { status: 'SCHEDULED', scheduledFor: body.scheduledFor });
  });

  /**
   * The patient was seen. Supplied rather than stamped, because this practice
   * learns it after the fact - usually from the report - and the date that
   * matters is the one the appointment happened on.
   */
  router.post('/referrals/:id/seen', requirePermission('order.write'), async (c) => {
    const row = await step(c, 'SEEN');
    const body = await parseJsonBody(c, seenSchema);

    return save(c, row.id, { status: 'SEEN', seenAt: body.seenAt });
  });

  /**
   * The report came back, and the loop closes.
   *
   * This is the only transition into COMPLETED, and it requires a date. A
   * referral marked complete with no report is the exact state this feature
   * exists to make impossible: it looks closed on every screen and nothing came
   * back.
   */
  router.post('/referrals/:id/report', requirePermission('order.write'), async (c) => {
    const row = await step(c, 'COMPLETED');
    const body = await parseJsonBody(c, reportSchema);

    return save(c, row.id, {
      status: 'COMPLETED',
      reportReceivedAt: body.reportReceivedAt,
      ...(body.reportDocumentId === undefined ? {} : { reportDocumentId: body.reportDocumentId }),
    });
  });

  router.post('/referrals/:id/cancel', requirePermission('order.write'), async (c) =>
    save(c, (await step(c, 'CANCELLED')).id, { status: 'CANCELLED' })
  );
}

export function referralRouteContracts(): RouteContract[] {
  const errors = [
    { status: 401, description: 'No bearer token.', schema: problemDocumentSchema },
    { status: 403, description: 'The role lacks the permission.', schema: problemDocumentSchema },
    { status: 404, description: MISSING, schema: problemDocumentSchema },
  ];
  const conflict = {
    status: 409,
    description: 'The referral is not in a status this transition may be taken from.',
    schema: problemDocumentSchema,
  };
  const idParam = [{ name: 'id', description: 'Referral id (UUIDv7).', schema: idParamSchema }];

  const transition = (
    segment: string,
    operationId: string,
    summary: string,
    description: string,
    body?: z.ZodType
  ): RouteContract => ({
    method: 'post',
    path: `/bff/v0/referrals/{id}/${segment}`,
    operationId,
    summary,
    description,
    tags: ['referrals'],
    permission: 'order.write',
    pathParams: idParam,
    ...(body === undefined ? {} : { body }),
    responses: [
      { status: 200, description: 'The referral, as it now stands.', schema: referralDtoSchema },
      ...errors,
      conflict,
    ],
  });

  return [
    {
      method: 'get',
      path: '/bff/v0/referrals',
      operationId: 'listReferrals',
      summary: 'List referrals, or the outstanding ones.',
      description:
        '`openOnly=true` is the outstanding-referrals tray: everything sent and not yet closed. It is a named flag rather than a status list the caller assembles, because "still open" is a clinical question with one right answer, and every caller assembling their own list is how two screens come to disagree about how many referrals are outstanding.',
      tags: ['referrals'],
      permission: 'order.read',
      query: referralListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'A page of referrals.',
          schema: z.object({
            items: z.array(referralDtoSchema),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
        ...errors.slice(0, 2),
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/referrals/{id}',
      operationId: 'getReferral',
      summary: 'One referral, and what it is still waiting on.',
      description:
        '`awaiting` is derived from the timestamps rather than stored, because it is a restatement of them - and a stored copy goes stale the first time somebody backfills a date.',
      tags: ['referrals'],
      permission: 'order.read',
      pathParams: idParam,
      responses: [
        { status: 200, description: 'The referral.', schema: referralDtoSchema },
        ...errors,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/referrals',
      operationId: 'createReferral',
      summary: 'Raise a referral.',
      description:
        'A referral is born a draft whatever the caller intends, because every other status is reached through a transition that stamps its own timestamp. One created already sent would be a referral nobody can say when they sent.',
      tags: ['referrals'],
      permission: 'order.write',
      body: referralInput,
      responses: [
        { status: 201, description: 'The referral, as a draft.', schema: referralDtoSchema },
        ...errors.slice(0, 2),
      ],
    },
    transition(
      'send',
      'sendReferral',
      'Send the referral, and start the clock.',
      '`sentAt` is stamped by the server rather than accepted from the caller: a backdated send would hide how long something has been outstanding, which is the number the tray exists to show.',
      sendSchema
    ),
    transition(
      'accept',
      'acceptReferral',
      'Record that the receiving practice accepted it.',
      'Acceptance is optional in practice - many referrals are scheduled without one - so SENT reaches SCHEDULED directly as well.'
    ),
    transition(
      'decline',
      'declineReferral',
      'Record that the receiving practice declined it.',
      'The reason is required rather than optional. A declined referral has to go somewhere else, and the person sending it needs to know whether it was the wrong specialty, a closed list, or an insurance problem.',
      declineSchema
    ),
    transition(
      'schedule',
      'scheduleReferral',
      'Record the appointment the receiving practice gave.',
      'Recorded here rather than as an appointment in this practice’s own diary, because the appointment belongs to somebody else’s.',
      scheduleSchema
    ),
    transition(
      'seen',
      'markReferralSeen',
      'Record that the patient was seen.',
      'The date is supplied rather than stamped: this practice learns it after the fact, usually from the report, and the date that matters is the one the appointment happened on.',
      seenSchema
    ),
    transition(
      'report',
      'closeReferral',
      'Record the report coming back, which closes the loop.',
      'The only transition into COMPLETED, and it requires a date. A referral marked complete with no report is the exact state this feature exists to make impossible: it looks closed on every screen and nothing came back.',
      reportSchema
    ),
    transition(
      'cancel',
      'cancelReferral',
      'Cancel the referral.',
      'For a referral that is no longer wanted. A referral raised in error takes ENTERED_IN_ERROR instead, which strikes it out without pretending it was a decision.'
    ),
  ];
}

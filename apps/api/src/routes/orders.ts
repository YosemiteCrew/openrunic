import {
  diagnosticReportInput,
  documentInput,
  serviceRequestInput,
  specimenInput,
  taskInput,
} from '@openrunic/database';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';

import type { ActorType, Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { parseJsonBody, parseParam, parseQuery, toFieldIssues } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { Permission } from '../policy/permissions.js';
import type {
  DocumentStatus,
  MessageSenderType,
  ServiceRequestStatus,
  SpecimenStatus,
  TaskStatus,
} from '../repositories/specs/orders.js';
import {
  diagnosticReportDtoSchema,
  diagnosticReportListQuerySchema,
  diagnosticReportPatchSchema,
  documentDtoSchema,
  documentListQuerySchema,
  documentPatchSchema,
  emptyBodySchema,
  messageDtoSchema,
  messageListQuerySchema,
  messagePostSchema,
  messageThreadCreateSchema,
  messageThreadDtoSchema,
  messageThreadListQuerySchema,
  messageThreadPatchSchema,
  resultObservationDtoSchema,
  resultObservationListQuerySchema,
  serviceRequestDtoSchema,
  serviceRequestListQuerySchema,
  serviceRequestPatchSchema,
  specimenDtoSchema,
  specimenListQuerySchema,
  specimenPatchSchema,
  specimenRejectSchema,
  taskCompleteSchema,
  taskDtoSchema,
  taskListQuerySchema,
  taskPatchSchema,
  toDiagnosticReportDto,
  toDiagnosticReportListQuery,
  toDiagnosticReportPatchInput,
  toDocumentDto,
  toDocumentListQuery,
  toDocumentPatchInput,
  toMessageDto,
  toMessageListQuery,
  toMessageThreadCreateInput,
  toMessageThreadDto,
  toMessageThreadListQuery,
  toMessageThreadPatchInput,
  toResultObservationDto,
  toResultObservationListQuery,
  toServiceRequestDto,
  toServiceRequestListQuery,
  toServiceRequestPatchInput,
  toSpecimenDto,
  toSpecimenListQuery,
  toSpecimenPatchInput,
  toTaskDto,
  toTaskListQuery,
  toTaskPatchInput,
} from '../schemas/orders.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import {
  assertTransition,
  defineCrud,
  CONFLICT_RESPONSE,
  CRUD_ERRORS,
  NOT_FOUND_RESPONSE,
  UNPROCESSABLE_RESPONSE,
  type CrudModule,
} from './crud.js';
import { idParamSchema, repositories, required } from './helpers.js';

/**
 * Orders, results, documents, the typed inbox and messaging.
 *
 * The four plain operations of each aggregate come from `defineCrud`, so the
 * paging envelope, the 404-not-403 rule and the permission checks are the same
 * ones every other aggregate got. Everything below them is written out by hand,
 * because these aggregates are state machines and a state machine is exactly
 * where a generic abstraction would hide the rules that matter: signing an
 * order, receiving a specimen, reviewing a result and filing a fax are the
 * moments a chart changes meaning, and each one has a table above it saying
 * what may follow what.
 *
 * The transitions are registered before the CRUD routers on purpose. Hono
 * matches in registration order, and `/results/{id}/observations` has to be
 * reachable rather than swallowed by the `:id` route that precedes it
 * alphabetically in nobody's mental model but the router's.
 */

/* ------------------------------------------------------- transition tables */

/**
 * An order's life, as data.
 *
 * Two properties are worth naming. Nothing leaves `COMPLETED` or `CANCELLED`
 * except a correction, so a finished order cannot be quietly reopened. And
 * every state reaches `ENTERED_IN_ERROR`, including that state itself, because
 * retracting a record is a status transition and never a delete: the row an
 * auditor needs to see is the one that says it should not have existed.
 */
const ORDER_TRANSITIONS: Readonly<Record<ServiceRequestStatus, readonly ServiceRequestStatus[]>> = {
  DRAFT: ['PENDED', 'SIGNED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  PENDED: ['SIGNED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  SIGNED: ['TRANSMITTED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  TRANSMITTED: ['IN_PROGRESS', 'CANCELLED', 'ENTERED_IN_ERROR'],
  IN_PROGRESS: ['RESULTED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  RESULTED: ['COMPLETED', 'ENTERED_IN_ERROR'],
  COMPLETED: ['ENTERED_IN_ERROR'],
  CANCELLED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: ['ENTERED_IN_ERROR'],
};

/**
 * A specimen's life. `UNSATISFACTORY` is terminal for a reason: a rejected
 * tube is not a tube that can be un-rejected, it is a tube somebody has to
 * collect again.
 */
const SPECIMEN_TRANSITIONS: Readonly<Record<SpecimenStatus, readonly SpecimenStatus[]>> = {
  AVAILABLE: ['UNAVAILABLE', 'UNSATISFACTORY', 'ENTERED_IN_ERROR'],
  UNAVAILABLE: ['AVAILABLE', 'UNSATISFACTORY', 'ENTERED_IN_ERROR'],
  UNSATISFACTORY: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

/** A document's life. Filing is one-way; a filed document is superseded, never refiled. */
const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> = {
  INBOX: ['FILED', 'SUPERSEDED', 'ENTERED_IN_ERROR'],
  FILED: ['SUPERSEDED', 'ENTERED_IN_ERROR'],
  SUPERSEDED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

/**
 * A task's life. `EXPIRED` is reachable from the open states because the FYI
 * sweep sets it, and the three closed states are terminal because an inbox
 * that can reopen its own items is an inbox nobody trusts is empty.
 */
const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED', 'EXPIRED'],
  IN_PROGRESS: ['ON_HOLD', 'DONE', 'CANCELLED', 'EXPIRED'],
  ON_HOLD: ['IN_PROGRESS', 'DONE', 'CANCELLED', 'EXPIRED'],
  DONE: [],
  CANCELLED: [],
  EXPIRED: [],
};

/**
 * How an actor signs a message.
 *
 * A table rather than a conditional, so a principal kind that nobody thought
 * about at the keyboard still lands somewhere defensible: a service account
 * writes as the system, which is what the thread should show.
 */
const SENDER_TYPE_BY_ACTOR: Readonly<Record<ActorType, MessageSenderType>> = {
  user: 'USER',
  patient: 'PATIENT',
  service: 'SYSTEM',
};

const NO_ORDER = 'No such order.';
const NO_SPECIMEN = 'No such specimen.';
const NO_REPORT = 'No such result report.';
const NO_DOCUMENT = 'No such document.';
const NO_TASK = 'No such task.';
const NO_THREAD = 'No such message thread.';
const NO_MESSAGE = 'No such message.';

/* ----------------------------------------------------------------- helpers */

/**
 * Reads a transition body, treating an absent one as empty.
 *
 * Most of these transitions carry no payload: signing an order says everything
 * it has to say by being a POST to `/sign`. A client that sends no body at all
 * is making a well-formed request, and demanding a literal `{}` would be
 * ceremony only the person holding a terminal ever pays. A body that *is*
 * present still has to satisfy the schema, so `/reject` without its reason is
 * a 422 either way.
 */
async function parseTransitionBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const raw = await c.req.text();
  if (raw.trim().length > 0) return parseJsonBody(c, schema);

  const result = schema.safeParse({});
  if (!result.success) {
    throw ApiError.validation('The request body failed validation.', toFieldIssues(result.error));
  }
  return result.data;
}

/**
 * The acting principal. `requirePermission` has already refused the request
 * without one, so the throw here is a wiring assertion rather than a path a
 * client can reach.
 */
function principalOf(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (principal === undefined) {
    throw ApiError.unauthenticated('A bearer token is required.');
  }
  return principal;
}

/**
 * The user id to stamp on a sign-off.
 *
 * Reviewing a result, filing a document and closing a task are acts a named
 * person answers for. A service account holding the permission is still
 * refused: an interface engine that could sign off results would make the
 * sign-off queue a formality.
 */
function actingUserId(c: Context<AppEnv>): string {
  const principal = principalOf(c);
  if (principal.actorType !== 'user') {
    throw ApiError.forbidden('Only a signed-in user can sign off on a record.');
  }
  return principal.subject;
}

/**
 * The `:id` path parameter, parsed the same way on every route below. It takes
 * the raw value rather than the context because Hono types a path parameter
 * from the route literal, and a helper that accepted the context would only
 * ever see `string | undefined`.
 */
function pathId(value: string): string {
  return parseParam(value, idParamSchema, 'id');
}

/* -------------------------------------------------------------- crud modules */

function crudModules(): CrudModule[] {
  return [
    defineCrud({
      segment: 'orders',
      singular: 'order',
      plural: 'orders',
      tag: 'orders',
      operation: 'Order',
      readPermission: 'order.read',
      writePermission: 'order.write',
      collection: (repos) => repos.orders,
      listQuerySchema: serviceRequestListQuerySchema,
      toQuery: toServiceRequestListQuery,
      listDescription:
        'The pended-orders tray is `status=PENDED`; the outstanding-orders report is `status=TRANSMITTED` plus a `from`/`to` window on `requestedAt`, where `from` is inclusive and `to` exclusive.',
      createSchema: serviceRequestInput,
      toCreate: (body) => body,
      patchSchema: serviceRequestPatchSchema,
      toPatch: toServiceRequestPatchInput,
      dtoSchema: serviceRequestDtoSchema,
      toDto: toServiceRequestDto,
    }),
    defineCrud({
      segment: 'specimens',
      singular: 'specimen',
      plural: 'specimens',
      tag: 'orders',
      operation: 'Specimen',
      readPermission: 'order.read',
      writePermission: 'order.write',
      collection: (repos) => repos.specimens,
      listQuerySchema: specimenListQuerySchema,
      toQuery: toSpecimenListQuery,
      listDescription:
        'The collection worklist is `serviceRequestId`; the accessioning desk looks a tube up by `accessionNumber`.',
      createSchema: specimenInput,
      toCreate: (body) => body,
      patchSchema: specimenPatchSchema,
      toPatch: toSpecimenPatchInput,
      dtoSchema: specimenDtoSchema,
      toDto: toSpecimenDto,
      writeResponses: [
        { status: 409, description: 'That accession number belongs to another specimen.' },
      ],
    }),
    defineCrud({
      segment: 'results',
      singular: 'result report',
      plural: 'result reports',
      tag: 'results',
      operation: 'DiagnosticReport',
      readPermission: 'result.read',
      writePermission: 'result.write',
      collection: (repos) => repos.reports,
      listQuerySchema: diagnosticReportListQuerySchema,
      toQuery: toDiagnosticReportListQuery,
      listDescription:
        'The sign-off queue is `reviewed=false`, usually with `abnormalFlag=CRITICAL` first. A create may carry its discrete analytes in `results`; they are written in the same transaction and read back from `/results/{id}/observations`.',
      createSchema: diagnosticReportInput,
      toCreate: (body) => body,
      patchSchema: diagnosticReportPatchSchema,
      toPatch: toDiagnosticReportPatchInput,
      dtoSchema: diagnosticReportDtoSchema,
      toDto: toDiagnosticReportDto,
    }),
    defineCrud({
      segment: 'documents',
      singular: 'document',
      plural: 'documents',
      tag: 'documents',
      operation: 'Document',
      readPermission: 'document.read',
      writePermission: 'document.write',
      collection: (repos) => repos.documents,
      listQuerySchema: documentListQuerySchema,
      toQuery: toDocumentListQuery,
      listDescription:
        'The triage inbox is `status=INBOX`, usually narrowed to `source=FAX`. The bytes live in object storage; this aggregate carries the key and the digest.',
      createSchema: documentInput,
      toCreate: (body) => body,
      patchSchema: documentPatchSchema,
      toPatch: toDocumentPatchInput,
      dtoSchema: documentDtoSchema,
      toDto: toDocumentDto,
    }),
    defineCrud({
      segment: 'tasks',
      singular: 'task',
      plural: 'tasks',
      tag: 'tasks',
      operation: 'Task',
      readPermission: 'task.read',
      writePermission: 'task.write',
      collection: (repos) => repos.tasks,
      listQuerySchema: taskListQuerySchema,
      toQuery: toTaskListQuery,
      listDescription:
        'One work engine; the streams are `type` filters rather than separate systems. A personal inbox is `assigneeUserId` plus `status=OPEN`, sorted by `dueAt` ascending, so a task with no due date sorts last rather than first.',
      createSchema: taskInput,
      toCreate: (body) => body,
      patchSchema: taskPatchSchema,
      toPatch: toTaskPatchInput,
      dtoSchema: taskDtoSchema,
      toDto: toTaskDto,
      writeResponses: [
        { status: 409, description: 'A task of that type already exists for that source event.' },
      ],
    }),
    defineCrud({
      segment: 'messages/threads',
      singular: 'message thread',
      plural: 'message threads',
      tag: 'messages',
      operation: 'MessageThread',
      readPermission: 'message.read',
      writePermission: 'message.write',
      collection: (repos) => repos.messageThreads,
      listQuerySchema: messageThreadListQuerySchema,
      toQuery: toMessageThreadListQuery,
      listDescription:
        'One threading model for portal messaging and staff chat, told apart by `kind`. `open=true` is the working inbox.',
      createSchema: messageThreadCreateSchema,
      toCreate: toMessageThreadCreateInput,
      patchSchema: messageThreadPatchSchema,
      toPatch: toMessageThreadPatchInput,
      dtoSchema: messageThreadDtoSchema,
      toDto: toMessageThreadDto,
    }),
  ];
}

/* --------------------------------------------------------------- transitions */

function transitionRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  /* orders */

  router.post('/orders/:id/sign', requirePermission('order.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const orders = repositories(c).orders;
    const before = required(await orders.findById(id), NO_ORDER);
    assertTransition(ORDER_TRANSITIONS, 'order', before.status, 'SIGNED');
    const row = required(await orders.update(id, { status: 'SIGNED' }), NO_ORDER);
    return c.json(toServiceRequestDto(row));
  });

  router.post('/orders/:id/transmit', requirePermission('order.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const orders = repositories(c).orders;
    const before = required(await orders.findById(id), NO_ORDER);
    assertTransition(ORDER_TRANSITIONS, 'order', before.status, 'TRANSMITTED');
    // Stamped where the move happens rather than by the labs adapter later: an
    // order that says TRANSMITTED and cannot say when is an order nobody can
    // chase.
    const row = required(
      await orders.update(id, { status: 'TRANSMITTED', transmittedAt: new Date() }),
      NO_ORDER
    );
    return c.json(toServiceRequestDto(row));
  });

  router.post('/orders/:id/cancel', requirePermission('order.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const orders = repositories(c).orders;
    const before = required(await orders.findById(id), NO_ORDER);
    assertTransition(ORDER_TRANSITIONS, 'order', before.status, 'CANCELLED');
    const row = required(await orders.update(id, { status: 'CANCELLED' }), NO_ORDER);
    return c.json(toServiceRequestDto(row));
  });

  /* specimens */

  router.post('/specimens/:id/receive', requirePermission('order.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const specimens = repositories(c).specimens;
    const before = required(await specimens.findById(id), NO_SPECIMEN);
    if (before.collectedAt === null) {
      // A specimen cannot arrive before it exists. Accessioning an uncollected
      // tube means somebody scanned the wrong label, and the right answer is to
      // say so rather than to record an arrival time for nothing.
      throw ApiError.conflict('That specimen has no collection time, so it cannot be received.');
    }
    const row = required(await specimens.update(id, { receivedAt: new Date() }), NO_SPECIMEN);
    return c.json(toSpecimenDto(row));
  });

  router.post('/specimens/:id/reject', requirePermission('order.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    const body = await parseTransitionBody(c, specimenRejectSchema);
    const specimens = repositories(c).specimens;
    const before = required(await specimens.findById(id), NO_SPECIMEN);
    assertTransition(SPECIMEN_TRANSITIONS, 'specimen', before.status, 'UNSATISFACTORY');
    const row = required(
      await specimens.update(id, {
        status: 'UNSATISFACTORY',
        rejectionReason: body.rejectionReason,
      }),
      NO_SPECIMEN
    );
    return c.json(toSpecimenDto(row));
  });

  /* results */

  router.get('/results/:id/observations', requirePermission('result.read'), async (c) => {
    const id = pathId(c.req.param('id'));
    const input = parseQuery(c, resultObservationListQuerySchema);
    const repos = repositories(c);
    // Read through the report rather than straight into the analyte table, so
    // an id naming a report this principal cannot see is absent rather than an
    // empty list that reads like a report with no results.
    required(await repos.reports.findById(id), NO_REPORT);
    const page = await repos.resultObservations.list(toResultObservationListQuery(input, id));
    return c.json(toListResponse(page, toResultObservationDto));
  });

  router.post('/results/:id/review', requirePermission('result.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const reviewedById = actingUserId(c);
    const reports = repositories(c).reports;
    const before = required(await reports.findById(id), NO_REPORT);
    if (before.reviewedAt !== null) {
      // An already-reviewed result is a result somebody has already acted on,
      // and a second sign-off would overwrite the name of whoever did.
      throw ApiError.conflict('That result has already been reviewed.');
    }
    const row = required(
      await reports.update(id, { reviewedAt: new Date(), reviewedById }),
      NO_REPORT
    );
    return c.json(toDiagnosticReportDto(row));
  });

  /* documents */

  router.post('/documents/:id/file', requirePermission('document.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const filedById = actingUserId(c);
    const documents = repositories(c).documents;
    const before = required(await documents.findById(id), NO_DOCUMENT);
    assertTransition(DOCUMENT_TRANSITIONS, 'document', before.status, 'FILED');
    const row = required(
      await documents.update(id, { status: 'FILED', filedAt: new Date(), filedById }),
      NO_DOCUMENT
    );
    return c.json(toDocumentDto(row));
  });

  /* tasks */

  router.post('/tasks/:id/complete', requirePermission('task.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    const body = await parseTransitionBody(c, taskCompleteSchema);
    const completedById = actingUserId(c);
    const tasks = repositories(c).tasks;
    const before = required(await tasks.findById(id), NO_TASK);
    assertTransition(TASK_TRANSITIONS, 'task', before.status, 'DONE');
    const row = required(
      await tasks.update(id, {
        status: 'DONE',
        completedAt: new Date(),
        completedById,
        ...(body.outcome === undefined ? {} : { outcome: body.outcome }),
      }),
      NO_TASK
    );
    return c.json(toTaskDto(row));
  });

  router.post('/tasks/:id/cancel', requirePermission('task.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const completedById = actingUserId(c);
    const tasks = repositories(c).tasks;
    const before = required(await tasks.findById(id), NO_TASK);
    assertTransition(TASK_TRANSITIONS, 'task', before.status, 'CANCELLED');
    // A cancelled task has left somebody's inbox, and when it left is the
    // question the inbox metrics ask, so the same two columns are stamped as
    // for a completion.
    const row = required(
      await tasks.update(id, {
        status: 'CANCELLED',
        completedAt: new Date(),
        completedById,
      }),
      NO_TASK
    );
    return c.json(toTaskDto(row));
  });

  /* messages */

  router.post('/messages/threads/:id/close', requirePermission('message.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const threads = repositories(c).messageThreads;
    const before = required(await threads.findById(id), NO_THREAD);
    if (before.closedAt !== null) {
      throw ApiError.conflict('That thread is already closed.');
    }
    const row = required(await threads.update(id, { closedAt: new Date() }), NO_THREAD);
    return c.json(toMessageThreadDto(row));
  });

  router.get('/messages/threads/:id/messages', requirePermission('message.read'), async (c) => {
    const id = pathId(c.req.param('id'));
    const input = parseQuery(c, messageListQuerySchema);
    const repos = repositories(c);
    required(await repos.messageThreads.findById(id), NO_THREAD);
    const page = await repos.messages.list(toMessageListQuery(input, id));
    return c.json(toListResponse(page, toMessageDto));
  });

  router.post('/messages/threads/:id/messages', requirePermission('message.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    const body = await parseTransitionBody(c, messagePostSchema);
    const actor = principalOf(c);
    const repos = repositories(c);
    const thread = required(await repos.messageThreads.findById(id), NO_THREAD);
    if (thread.closedAt !== null) {
      throw ApiError.conflict('That thread is closed, so it cannot take another message.');
    }

    const row = await repos.messages.create({
      threadId: id,
      // The sender comes off the verified principal and never off the body: a
      // message whose author a client could choose is a message the audit
      // trail cannot attribute.
      senderType: SENDER_TYPE_BY_ACTOR[actor.actorType],
      ...(actor.actorType === 'user' ? { senderUserId: actor.subject } : {}),
      ...(actor.actorType === 'patient' ? { senderPatientId: actor.subject } : {}),
      body: body.body,
    });
    // Every inbox sorts on the thread's own timestamp, so it advances with the
    // message rather than in a sweep that might not run.
    await repos.messageThreads.update(id, { lastMessageAt: row.sentAt });

    // A message has no URL of its own beyond the collection it joined, so that
    // is what `Location` names.
    return c.json(toMessageDto(row), 201, {
      Location: `/bff/v0/messages/threads/${id}/messages`,
    } satisfies Record<string, string>);
  });

  // Behind the write permission rather than the read one: stamping `readAt`
  // changes a row, and a read-only principal holds every `.read` capability in
  // the catalogue. "Read-only" has to mean it.
  router.post('/messages/:id/read', requirePermission('message.write'), async (c) => {
    const id = pathId(c.req.param('id'));
    await parseTransitionBody(c, emptyBodySchema);
    const messages = repositories(c).messages;
    const before = required(await messages.findById(id), NO_MESSAGE);
    // Idempotent by design. A portal that re-renders a thread must not keep
    // moving the timestamp that says when the patient first saw it, and it
    // must not fail either.
    if (before.readAt !== null) return c.json(toMessageDto(before));
    const row = required(await messages.update(id, { readAt: new Date() }), NO_MESSAGE);
    return c.json(toMessageDto(row));
  });

  return router;
}

/* ------------------------------------------------------ transition contracts */

interface TransitionSpec {
  /** Path segment under `/bff/v0`, e.g. `orders` or `messages/threads`. */
  segment: string;
  /** The literal sub-path after `{id}`, e.g. `sign`. */
  action: string;
  operationId: string;
  summary: string;
  description: string;
  tag: string;
  permission: Permission;
  /** Singular noun for the path parameter and the response descriptions. */
  subject: string;
  body: z.ZodType;
  response: z.ZodType;
  /** 201 for the one transition that creates a row. */
  status?: number;
}

function transitionContract(spec: TransitionSpec): RouteContract {
  return {
    method: 'post',
    path: `/bff/v0/${spec.segment}/{id}/${spec.action}`,
    operationId: spec.operationId,
    summary: spec.summary,
    description: spec.description,
    tags: [spec.tag],
    permission: spec.permission,
    pathParams: [
      { name: 'id', description: `The ${spec.subject}'s id (UUIDv7).`, schema: idParamSchema },
    ],
    body: spec.body,
    responses: [
      {
        status: spec.status ?? 200,
        description: `The ${spec.subject} after the move.`,
        schema: spec.response,
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  };
}

/** The two nested collections, which are reads rather than moves. */
function nestedListContract(spec: {
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tag: string;
  permission: Permission;
  subject: string;
  query: z.ZodType;
  item: z.ZodType;
  plural: string;
}): RouteContract {
  return {
    method: 'get',
    path: spec.path,
    operationId: spec.operationId,
    summary: spec.summary,
    description: spec.description,
    tags: [spec.tag],
    permission: spec.permission,
    pathParams: [
      { name: 'id', description: `The ${spec.subject}'s id (UUIDv7).`, schema: idParamSchema },
    ],
    query: spec.query,
    responses: [
      {
        status: 200,
        description: `One page of ${spec.plural}.`,
        schema: listResponseSchema(spec.item),
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
    ],
  };
}

function transitionContracts(): RouteContract[] {
  return [
    transitionContract({
      segment: 'orders',
      action: 'sign',
      operationId: 'signOrder',
      summary: 'Sign an order.',
      description: 'A draft or pended order becomes signed. Nothing else may be signed.',
      tag: 'orders',
      permission: 'order.write',
      subject: 'order',
      body: emptyBodySchema,
      response: serviceRequestDtoSchema,
    }),
    transitionContract({
      segment: 'orders',
      action: 'transmit',
      operationId: 'transmitOrder',
      summary: 'Transmit a signed order.',
      description: 'A signed order becomes transmitted, and `transmittedAt` is stamped.',
      tag: 'orders',
      permission: 'order.write',
      subject: 'order',
      body: emptyBodySchema,
      response: serviceRequestDtoSchema,
    }),
    transitionContract({
      segment: 'orders',
      action: 'cancel',
      operationId: 'cancelOrder',
      summary: 'Cancel an order.',
      description:
        'Any order that has not finished becomes cancelled. A completed or already-cancelled order is refused; a mistaken one is corrected to `ENTERED_IN_ERROR` rather than deleted.',
      tag: 'orders',
      permission: 'order.write',
      subject: 'order',
      body: emptyBodySchema,
      response: serviceRequestDtoSchema,
    }),
    transitionContract({
      segment: 'specimens',
      action: 'receive',
      operationId: 'receiveSpecimen',
      summary: 'Accession a specimen.',
      description:
        'Stamps `receivedAt`. Refused when the specimen carries no collection time, because a specimen cannot arrive before it exists.',
      tag: 'orders',
      permission: 'order.write',
      subject: 'specimen',
      body: emptyBodySchema,
      response: specimenDtoSchema,
    }),
    transitionContract({
      segment: 'specimens',
      action: 'reject',
      operationId: 'rejectSpecimen',
      summary: 'Reject a specimen as unsatisfactory.',
      description:
        'Requires `rejectionReason`, mirroring the refinement on the create contract: "rejected" on its own tells the collecting clinician nothing about what to do differently.',
      tag: 'orders',
      permission: 'order.write',
      subject: 'specimen',
      body: specimenRejectSchema,
      response: specimenDtoSchema,
    }),
    transitionContract({
      segment: 'results',
      action: 'review',
      operationId: 'reviewDiagnosticReport',
      summary: 'Sign off a result report.',
      description:
        'Stamps `reviewedAt` and `reviewedById` from the acting principal. Reviewing twice is refused, and only a signed-in user may review.',
      tag: 'results',
      permission: 'result.write',
      subject: 'result report',
      body: emptyBodySchema,
      response: diagnosticReportDtoSchema,
    }),
    transitionContract({
      segment: 'documents',
      action: 'file',
      operationId: 'fileDocument',
      summary: 'File an inbox document.',
      description: 'An inbox document becomes filed, stamping `filedAt` and `filedById`.',
      tag: 'documents',
      permission: 'document.write',
      subject: 'document',
      body: emptyBodySchema,
      response: documentDtoSchema,
    }),
    transitionContract({
      segment: 'tasks',
      action: 'complete',
      operationId: 'completeTask',
      summary: 'Complete a task.',
      description:
        'An open, in-progress or on-hold task becomes done, stamping `completedAt`, `completedById` and the `outcome` from the body.',
      tag: 'tasks',
      permission: 'task.write',
      subject: 'task',
      body: taskCompleteSchema,
      response: taskDtoSchema,
    }),
    transitionContract({
      segment: 'tasks',
      action: 'cancel',
      operationId: 'cancelTask',
      summary: 'Cancel a task.',
      description:
        'The same three states become cancelled. Done, cancelled and expired are terminal.',
      tag: 'tasks',
      permission: 'task.write',
      subject: 'task',
      body: emptyBodySchema,
      response: taskDtoSchema,
    }),
    transitionContract({
      segment: 'messages/threads',
      action: 'close',
      operationId: 'closeMessageThread',
      summary: 'Close a message thread.',
      description: 'Stamps `closedAt`. Closing an already-closed thread is refused.',
      tag: 'messages',
      permission: 'message.write',
      subject: 'message thread',
      body: emptyBodySchema,
      response: messageThreadDtoSchema,
    }),
    transitionContract({
      segment: 'messages/threads',
      action: 'messages',
      operationId: 'postMessage',
      summary: 'Post a message to a thread.',
      description:
        'The sender is read off the verified principal, never off the body, and `lastMessageAt` on the thread advances with the message. A closed thread is refused.',
      tag: 'messages',
      permission: 'message.write',
      subject: 'message thread',
      body: messagePostSchema,
      response: messageDtoSchema,
      status: 201,
    }),
    transitionContract({
      segment: 'messages',
      action: 'read',
      operationId: 'markMessageRead',
      summary: 'Mark a message read.',
      description:
        'Stamps `readAt`, so it needs `message.write` rather than `message.read`. Idempotent: re-reading a read message returns it unchanged rather than moving the timestamp or failing.',
      tag: 'messages',
      permission: 'message.write',
      subject: 'message',
      body: emptyBodySchema,
      response: messageDtoSchema,
    }),
    nestedListContract({
      path: '/bff/v0/results/{id}/observations',
      operationId: 'listDiagnosticReportObservations',
      summary: "List a report's discrete analytes.",
      description:
        'Ordered by `sequence`, which is the order the report itself lists them in. The report is read first, so an unreachable id is a 404 rather than an empty page.',
      tag: 'results',
      permission: 'result.read',
      subject: 'result report',
      query: resultObservationListQuerySchema,
      item: resultObservationDtoSchema,
      plural: 'analytes',
    }),
    nestedListContract({
      path: '/bff/v0/messages/threads/{id}/messages',
      operationId: 'listThreadMessages',
      summary: "List a thread's messages.",
      description: 'Oldest first, which is how a conversation reads.',
      tag: 'messages',
      permission: 'message.read',
      subject: 'message thread',
      query: messageListQuerySchema,
      item: messageDtoSchema,
      plural: 'messages',
    }),
  ];
}

/* --------------------------------------------------------------- the module */

export function orderRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // Registered first, because Hono matches in registration order and the
  // literal sub-paths have to resolve alongside the `:id` routes rather than
  // behind them.
  router.route('/', transitionRoutes());
  for (const module of crudModules()) {
    router.route('/', module.routes);
  }

  return router;
}

export function orderRouteContracts(): RouteContract[] {
  return [...crudModules().flatMap((module) => [...module.contracts]), ...transitionContracts()];
}

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { Page } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import type { Repositories } from '../repositories/types.js';
import {
  portalAppointmentsSchema,
  portalFormTaskSchema,
  portalHealthRecordSchema,
  portalHomeSchema,
  portalMessageReplySchema,
  portalMessageSchema,
  portalMessageThreadSchema,
  portalPatientSchema,
  portalStatementSchema,
  type PortalPatient,
} from '../schemas/portal.js';

import { idParamSchema, repositories } from './helpers.js';

const ERROR_RESPONSES = [
  { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
  {
    status: 403,
    description: 'This is not an enabled patient portal session.',
    schema: problemDocumentSchema,
  },
] as const;

export const portalRouteContracts: RouteContract[] = [
  {
    method: 'get',
    path: '/bff/v0/portal/patient',
    operationId: 'readPortalPatient',
    summary: "Read the signed-in patient's identity.",
    tags: ['patient portal'],
    permission: 'patient.read',
    responses: [
      {
        status: 200,
        description: 'The patient bound to this session.',
        schema: portalPatientSchema,
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/portal/home',
    operationId: 'readPortalHome',
    summary: "Read the signed-in patient's home summary.",
    tags: ['patient portal'],
    permission: 'patient.read',
    alsoRequires: ['appointment.read', 'message.read', 'payment.read'],
    responses: [
      { status: 200, description: 'The portal home summary.', schema: portalHomeSchema },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/portal/health-record',
    operationId: 'readPortalHealthRecord',
    summary: "Read the signed-in patient's portal-safe clinical record.",
    tags: ['patient portal'],
    permission: 'patient.read',
    alsoRequires: ['encounter.read', 'document.read', 'result.read'],
    responses: [
      { status: 200, description: 'The portal health record.', schema: portalHealthRecordSchema },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/portal/messages',
    operationId: 'listPortalMessageThreads',
    summary: "List the signed-in patient's conversations.",
    tags: ['patient portal'],
    permission: 'message.read',
    responses: [
      {
        status: 200,
        description: 'The patient message threads.',
        schema: portalMessageThreadSchema.array(),
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/portal/messages/{id}/replies',
    operationId: 'replyToPortalMessageThread',
    summary: "Reply to one of the signed-in patient's conversations.",
    tags: ['patient portal'],
    permission: 'message.write',
    pathParams: [{ name: 'id', description: 'Message thread id.', schema: idParamSchema }],
    body: portalMessageReplySchema,
    responses: [
      { status: 201, description: 'The sent message.', schema: portalMessageSchema },
      ...ERROR_RESPONSES,
      { status: 404, description: 'No such patient thread.', schema: problemDocumentSchema },
      { status: 409, description: 'The patient thread is closed.', schema: problemDocumentSchema },
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/portal/appointments',
    operationId: 'listPortalAppointments',
    summary: "List the signed-in patient's appointments.",
    tags: ['patient portal'],
    permission: 'appointment.read',
    responses: [
      {
        status: 200,
        description: 'Past and upcoming patient appointments.',
        schema: portalAppointmentsSchema,
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/portal/forms',
    operationId: 'listPortalForms',
    summary: "List the signed-in patient's existing form submissions.",
    tags: ['patient portal'],
    permission: 'form.read',
    responses: [
      {
        status: 200,
        description: 'The patient form submissions.',
        schema: portalFormTaskSchema.array(),
      },
      ...ERROR_RESPONSES,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/portal/statements',
    operationId: 'listPortalStatements',
    summary: "List the signed-in patient's delivered statements.",
    tags: ['patient portal'],
    permission: 'payment.read',
    responses: [
      {
        status: 200,
        description: 'The delivered patient statements.',
        schema: portalStatementSchema.array(),
      },
      ...ERROR_RESPONSES,
    ],
  },
];

const portalOnly = createMiddleware<AppEnv>(async (c, next) => {
  portalPrincipal(c);
  await next();
});

function portalPrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (principal === undefined) throw ApiError.unauthenticated('A bearer token is required.');
  if (
    principal.actorType !== 'patient' ||
    !principal.roles.includes('patient-portal') ||
    principal.subject !== principal.compartmentPatientId
  ) {
    throw ApiError.forbidden('This route is available only to a patient portal session.');
  }
  return principal;
}

async function portalPatient(c: Context<AppEnv>): Promise<ScopedRow<'Patient'>> {
  const principal = portalPrincipal(c);
  const patient = await repositories(c).patients.findById(principal.subject);
  if (patient === null || !patient.portalEnabled) {
    throw ApiError.forbidden('Patient portal access is not enabled.');
  }
  return patient;
}

function toPatient(row: ScopedRow<'Patient'>): PortalPatient {
  return {
    id: row.id,
    name: [row.preferredName ?? row.givenName, row.familyName].join(' '),
    mrn: row.mrn,
    dateOfBirth: row.birthDate.toISOString().slice(0, 10),
  };
}

async function readAll<T>(
  load: (page: number, pageSize: number) => Promise<Page<T>>
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const result = await load(page, pageSize);
    rows.push(...result.rows);
    if (rows.length >= result.total || result.rows.length === 0) return rows;
  }
}

function facilityLocation(
  row: ScopedRow<'Facility'> | undefined,
  room: string | null
): string | null {
  const parts = [
    room,
    row?.addressLine1,
    row?.addressLine2,
    row?.city,
    row?.state,
    row?.postalCode,
  ];
  const location = parts
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(', ');
  return location === '' ? null : location;
}

async function appointmentsFor(repos: Repositories, now: Date) {
  const rows = (
    await readAll((page, pageSize) =>
      repos.appointments.list({ page, pageSize, sort: 'start', order: 'asc' })
    )
  ).filter((row) => row.status !== 'ENTERED_IN_ERROR');
  const facilities = new Map(
    (await repos.facilities.findByIds(rows.map((row) => row.facilityId))).map((row) => [
      row.id,
      row,
    ])
  );
  const mapped = rows.map((row) => {
    const facility = facilities.get(row.facilityId);
    return {
      id: row.id,
      startsAt: row.start.toISOString(),
      durationMinutes: row.durationMinutes,
      reason: row.reasonText ?? row.typeDisplay,
      clinician: null,
      department: facility?.name ?? null,
      mode: null,
      location: facilityLocation(facility, row.room),
      joinUrl: null,
      directionsUrl: null,
      cancelledReason: row.cancelReason,
      cancellationSupported: false,
      rescheduleSupported: false,
    } as const;
  });
  return {
    upcoming: mapped.filter(
      (row, index) => rows[index]?.status !== 'CANCELLED' && new Date(row.startsAt) >= now
    ),
    past: mapped.filter(
      (row, index) => rows[index]?.status === 'CANCELLED' || new Date(row.startsAt) < now
    ),
    requestsSupported: false,
  };
}

function rangeState(row: ScopedRow<'Observation'>): 'in-range' | 'out-of-range' | 'unknown' {
  if (['H', 'HH', 'L', 'LL', 'A', 'AA'].includes(row.interpretationCode ?? ''))
    return 'out-of-range';
  if (row.interpretationCode === 'N') return 'in-range';
  if (row.valueNumber === null) return 'unknown';
  if (row.referenceLow !== null && row.valueNumber < row.referenceLow) return 'out-of-range';
  if (row.referenceHigh !== null && row.valueNumber > row.referenceHigh) return 'out-of-range';
  return row.referenceLow === null && row.referenceHigh === null ? 'unknown' : 'in-range';
}

function referenceRange(row: ScopedRow<'Observation'>): string {
  if (row.referenceLow !== null && row.referenceHigh !== null)
    return `${row.referenceLow} to ${row.referenceHigh}`;
  if (row.referenceLow !== null) return `at least ${row.referenceLow}`;
  if (row.referenceHigh !== null) return `up to ${row.referenceHigh}`;
  return '';
}

const PROBLEM_STATUSES = {
  ACTIVE: 'active',
  RECURRENCE: 'recurrence',
  RELAPSE: 'relapse',
  INACTIVE: 'inactive',
  REMISSION: 'remission',
  RESOLVED: 'resolved',
} as const satisfies Record<ScopedRow<'Condition'>['clinicalStatus'], string>;

const ALLERGY_SEVERITIES = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
} as const satisfies Record<NonNullable<ScopedRow<'AllergyIntolerance'>['severity']>, string>;

async function healthRecordFor(repos: Repositories) {
  const [problems, medications, allergies, immunisations, documents, observations] =
    await Promise.all([
      readAll((page, pageSize) =>
        repos.problems.list({ page, pageSize, sort: 'recordedAt', order: 'desc' })
      ),
      readAll((page, pageSize) =>
        repos.medicationStatements.list({ page, pageSize, sort: 'reportedAt', order: 'desc' })
      ),
      readAll((page, pageSize) =>
        repos.allergies.list({ page, pageSize, sort: 'recordedAt', order: 'desc' })
      ),
      readAll((page, pageSize) =>
        repos.immunisations.list({ page, pageSize, sort: 'administeredAt', order: 'desc' })
      ),
      readAll((page, pageSize) =>
        repos.documents.list({ page, pageSize, sort: 'receivedAt', order: 'desc' })
      ),
      readAll((page, pageSize) =>
        repos.observations.list({ page, pageSize, sort: 'effectiveAt', order: 'desc' })
      ),
    ]);
  return {
    problems: problems
      .filter((row) => row.verificationStatus !== 'ENTERED_IN_ERROR')
      .map((row) => ({
        id: row.id,
        term: row.display,
        code: row.code,
        plain: null,
        recordedOn: row.recordedAt.toISOString(),
        status: PROBLEM_STATUSES[row.clinicalStatus],
      })),
    medications: medications
      .filter((row) => row.status !== 'ENTERED_IN_ERROR')
      .map((row) => ({
        id: row.id,
        name: row.display,
        plain: null,
        strength: null,
        unit: null,
        instruction: row.sigText,
        prescribedBy: null,
        startedOn: (row.effectiveStart ?? row.reportedAt).toISOString(),
      })),
    allergies: allergies.map((row) => ({
      id: row.id,
      substance: row.substanceDisplay,
      plain: null,
      reaction: row.reactionText,
      severity: row.severity === null ? null : ALLERGY_SEVERITIES[row.severity],
      recordedOn: row.recordedAt.toISOString(),
    })),
    immunisations: immunisations
      .filter((row) => row.status !== 'ENTERED_IN_ERROR')
      .map((row) => ({
        id: row.id,
        vaccine: row.display,
        plain: null,
        givenOn: row.administeredAt.toISOString(),
        doseLabel:
          row.doseQuantity === null || row.doseUnit === null
            ? null
            : `${row.doseQuantity} ${row.doseUnit}`,
      })),
    documents: documents
      .filter((row) => row.status === 'FILED' && row.sensitivityClass === 'NORMAL')
      .map((row) => ({
        id: row.id,
        title: row.title,
        plain: null,
        addedOn: (row.filedAt ?? row.receivedAt).toISOString(),
        format: `${row.contentType}, ${row.byteSize} bytes`,
      })),
    results: observations
      .filter(
        (row) => row.status !== 'ENTERED_IN_ERROR' && row.valueNumber !== null && row.unit !== null
      )
      .map((row) => ({
        id: row.id,
        name: row.display,
        plain: null,
        value: row.valueNumber as number,
        unit: row.unit as string,
        referenceRange: referenceRange(row),
        range: rangeState(row),
        takenOn: row.effectiveAt.toISOString(),
      })),
  };
}

function toPortalMessage(row: ScopedRow<'Message'>, patient: PortalPatient) {
  const fromPatient = row.senderType === 'PATIENT';
  return {
    id: row.id,
    author: fromPatient ? ('patient' as const) : ('care-team' as const),
    authorName: fromPatient ? patient.name : null,
    sentAt: row.sentAt.toISOString(),
    body: row.body,
  };
}

async function threadsFor(repos: Repositories, patient: PortalPatient) {
  const threads = await readAll((page, pageSize) =>
    repos.messageThreads.list({
      page,
      pageSize,
      kind: 'PATIENT',
      sort: 'lastMessageAt',
      order: 'desc',
    })
  );
  return Promise.all(
    threads.map(async (thread) => {
      const messages = await readAll((page, pageSize) =>
        repos.messages.list({ page, pageSize, threadId: thread.id, sort: 'sentAt', order: 'asc' })
      );
      return {
        id: thread.id,
        subject: thread.subject,
        correspondent: null,
        lastMessageAt: (thread.lastMessageAt ?? thread.createdAt).toISOString(),
        unread: messages.some(
          (message) => message.senderType !== 'PATIENT' && message.readAt === null
        ),
        replySupported: thread.closedAt === null,
        messages: messages.map((message) => toPortalMessage(message, patient)),
      };
    })
  );
}

function portalStatementStatus(row: ScopedRow<'Statement'>): 'due' | 'paid' | 'credit' {
  if (row.balanceCents < 0) return 'credit';
  return row.status === 'PAID' || row.balanceCents === 0 ? 'paid' : 'due';
}

async function statementsFor(repos: Repositories) {
  const rows = await readAll((page, pageSize) =>
    repos.statements.list({ page, pageSize, sort: 'generatedAt', order: 'desc' })
  );
  return rows
    .filter((row) => row.status === 'SENT' || row.status === 'PAID')
    .map((row) => ({
      id: row.id,
      reference: row.id,
      issuedOn: row.generatedAt.toISOString(),
      dueOn: null,
      status: portalStatementStatus(row),
      total: null,
      balance: { amountMinor: row.balanceCents, currency: row.currency },
      lines: [],
      detailsAvailable: false,
      paymentAvailable: false,
    }));
}

function textAnswers(values: unknown): Record<string, string> {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return {};
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (typeof value === 'string') return [[key, value]];
      if (typeof value === 'boolean') return [[key, value ? 'Yes' : 'No']];
      return [];
    })
  );
}

async function formsFor(repos: Repositories) {
  const submissions = (
    await readAll((page, pageSize) =>
      repos.formSubmissions.list({ page, pageSize, sort: 'effectiveAt', order: 'desc' })
    )
  ).filter((row) => row.status !== 'ENTERED_IN_ERROR');
  const definitions = new Map(
    (await repos.formDefinitions.findByIds(submissions.map((row) => row.formDefinitionId))).map(
      (row) => [row.id, row]
    )
  );
  return submissions.flatMap((submission) => {
    const definition = definitions.get(submission.formDefinitionId);
    if (definition === undefined) return [];
    return [
      {
        id: submission.id,
        title: definition.title,
        purpose: definition.description ?? '',
        dueOn: null,
        status:
          submission.status === 'IN_PROGRESS' ? ('in-progress' as const) : ('submitted' as const),
        questions: [],
        answers: textAnswers(submission.values),
        editable: false,
      },
    ];
  });
}

export function portalRoutes(options: { now: () => Date }): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.use('/portal/*', portalOnly);

  router.get('/portal/patient', requirePermission('patient.read'), async (c) =>
    c.json(toPatient(await portalPatient(c)))
  );

  router.get(
    '/portal/home',
    requirePermission('patient.read'),
    requirePermission('appointment.read'),
    requirePermission('message.read'),
    requirePermission('payment.read'),
    async (c) => {
      const patient = toPatient(await portalPatient(c));
      const repos = repositories(c);
      const [appointments, threads, statements] = await Promise.all([
        appointmentsFor(repos, options.now()),
        threadsFor(repos, patient),
        statementsFor(repos),
      ]);
      const currencies = new Set(statements.map((statement) => statement.balance.currency));
      const outstanding =
        currencies.size === 1
          ? {
              amountMinor: statements.reduce(
                (total, statement) => total + statement.balance.amountMinor,
                0
              ),
              currency: statements[0]?.balance.currency ?? '',
            }
          : null;
      return c.json({
        patient,
        nextAppointment: appointments.upcoming[0] ?? null,
        balance: { outstanding, dueOn: null, statementCount: statements.length },
        unreadMessages: threads.filter((thread) => thread.unread).length,
        actionItems: [],
        appointmentRequestsSupported: false,
      });
    }
  );

  router.get(
    '/portal/health-record',
    requirePermission('patient.read'),
    requirePermission('encounter.read'),
    requirePermission('document.read'),
    requirePermission('result.read'),
    async (c) => {
      await portalPatient(c);
      return c.json(await healthRecordFor(repositories(c)));
    }
  );

  router.get('/portal/messages', requirePermission('message.read'), async (c) => {
    const patient = toPatient(await portalPatient(c));
    return c.json(await threadsFor(repositories(c), patient));
  });

  router.post('/portal/messages/:id/replies', requirePermission('message.write'), async (c) => {
    const patient = toPatient(await portalPatient(c));
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, portalMessageReplySchema);
    const repos = repositories(c);
    const thread = await repos.messageThreads.findById(id);
    if (thread === null || thread.kind !== 'PATIENT')
      throw ApiError.notFound('No such patient thread.');
    if (thread.closedAt !== null) throw ApiError.conflict('That patient thread is closed.');
    const row = await repos.messages.create({
      threadId: thread.id,
      patientId: patient.id,
      senderType: 'PATIENT',
      senderPatientId: patient.id,
      body: body.body,
    });
    await repos.messageThreads.update(thread.id, { lastMessageAt: row.sentAt });
    return c.json(toPortalMessage(row, patient), 201);
  });

  router.get('/portal/appointments', requirePermission('appointment.read'), async (c) => {
    await portalPatient(c);
    return c.json(await appointmentsFor(repositories(c), options.now()));
  });

  router.get('/portal/forms', requirePermission('form.read'), async (c) => {
    await portalPatient(c);
    return c.json(await formsFor(repositories(c)));
  });

  router.get('/portal/statements', requirePermission('payment.read'), async (c) => {
    await portalPatient(c);
    return c.json(await statementsFor(repositories(c)));
  });

  return router;
}

import {
  formDefinitionCreateInput,
  formDefinitionPublishInput,
  formSubmissionInput,
  terminologyCodeInput,
} from '@openrunic/database';
import { parseValueSetDefinition } from '@openrunic/terminology';
import { Hono, type Context, type Next } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody, parseParam, parseQuery } from '../http/validate.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { Permission } from '../policy/permissions.js';
import type { ScopedRow } from '../repositories/rows.js';
import type {
  FormDefinitionUpdateInput,
  FormStatus,
  FormSubmissionStatus,
  FormSubmissionUpdateInput,
} from '../repositories/specs/platform.js';
import { listResponseSchema, toListResponse, MAX_PAGE_SIZE } from '../schemas/pagination.js';
import {
  auditEventDtoSchema,
  auditQuerySchema,
  auditVerificationDtoSchema,
  facilityCreateSchema,
  facilityDtoSchema,
  facilityListQuerySchema,
  facilityPatchSchema,
  formDefinitionDtoSchema,
  formDefinitionListQuerySchema,
  formDefinitionPatchSchema,
  formDefinitionRetireSchema,
  formSubmissionAmendSchema,
  formSubmissionCompleteSchema,
  formSubmissionDtoSchema,
  formSubmissionListQuerySchema,
  formSubmissionPatchSchema,
  formSubmissionSignSchema,
  roleAssignmentCreateSchema,
  roleAssignmentDtoSchema,
  roleCreateSchema,
  roleDtoSchema,
  roleListQuerySchema,
  rolePatchSchema,
  terminologyCodeDtoSchema,
  terminologyListQuerySchema,
  terminologyLookupDtoSchema,
  terminologyLookupQuerySchema,
  terminologyPatchSchema,
  toAuditEventDto,
  toAuditQuery,
  toAuditVerificationDto,
  toFacilityDto,
  toFacilityListQuery,
  toFormDefinitionDto,
  toFormDefinitionListQuery,
  toFormSubmissionDto,
  toFormSubmissionListQuery,
  toRoleAssignmentDto,
  toRoleAssignmentListQuery,
  toRoleDto,
  toRoleListQuery,
  toTerminologyCodeDto,
  toTerminologyListQuery,
  toTerminologyLookupDto,
  toTerminologyLookupQuery,
  toUserDto,
  toUserListQuery,
  userCreateSchema,
  userDtoSchema,
  userListQuerySchema,
  userPatchSchema,
  userRoleListQuerySchema,
  type FormDefinitionPatchBody,
  type FormSubmissionPatchBody,
} from '../schemas/platform.js';
import {
  toValueSetDto,
  toValueSetListQuery,
  valueSetCreateSchema,
  valueSetDtoSchema,
  valueSetListQuerySchema,
  valueSetPatchSchema,
} from '../schemas/quality.js';

import {
  assertTransition,
  defineCrud,
  CONFLICT_RESPONSE,
  CRUD_ERRORS,
  NOT_FOUND_RESPONSE,
  UNPROCESSABLE_RESPONSE,
  type CrudModule,
} from './crud.js';
import { ROLE_MODEL_CAVEAT } from '../policy/permissions.js';
import { idParamSchema, policyOf, repositories, required, requiredParentChart } from './helpers.js';

/**
 * The platform surface: forms, the staff directory, places of service, the
 * terminology cache and the audit log.
 *
 * The four plain operations of each aggregate come from {@link defineCrud},
 * because paging, the 404-not-403 rule and the facility check are worth writing
 * once. Everything below them is written by hand, because everything below them
 * is a rule: a definition freezes when it is published, a signed submission is
 * amended rather than edited, an organisation-wide role grant cannot be handed
 * out twice, and the audit log can be read but never written through.
 *
 * Registration order matters here. Hono runs the handlers of every matching
 * route in the order they were registered, so `/terminology/lookup` is
 * registered before the terminology collection whose `/:id` route would
 * otherwise swallow it, and `/audit/verify` before `/audit/:id`.
 */

const MISSING_DEFINITION = 'No such form definition.';
const MISSING_SUBMISSION = 'No such form submission.';
const MISSING_USER = 'No such user.';
const MISSING_AUDIT_EVENT = 'No such audit event.';

/**
 * The definition lifecycle. `RETIRED` is terminal, and a draft is not
 * retirable: a form nobody could ever fill in is deleted by never publishing
 * it, not by retiring something that never existed for a user.
 */
const FORM_DEFINITION_TRANSITIONS: Readonly<Record<FormStatus, readonly FormStatus[]>> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: [],
};

/**
 * The submission lifecycle.
 *
 * Every live state reaches `ENTERED_IN_ERROR`, because a correction is a status
 * transition and never a delete: the answer set that was recorded in error is
 * part of what happened, and a chart that can forget its own mistakes cannot be
 * reconciled with the audit log. `AMENDED` may be amended again, which is what
 * a second correction to a signed form actually is.
 */
const FORM_SUBMISSION_TRANSITIONS: Readonly<
  Record<FormSubmissionStatus, readonly FormSubmissionStatus[]>
> = {
  IN_PROGRESS: ['COMPLETED', 'ENTERED_IN_ERROR'],
  COMPLETED: ['SIGNED', 'ENTERED_IN_ERROR'],
  SIGNED: ['AMENDED', 'ENTERED_IN_ERROR'],
  AMENDED: ['AMENDED', 'ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

/**
 * What publishing freezes.
 *
 * A submission is validated against the exact definition version it was
 * authored against, so changing the authored document, what the form binds to,
 * or the key that identifies it would retroactively change what an in-flight
 * answer set means. The next version is a new row; these columns are not
 * editable once anyone could have started filling the form in.
 */
const FROZEN_DEFINITION_FIELDS = ['key', 'bindTo', 'definition'] as const;

/**
 * The acting user, for the columns that record who did something.
 *
 * Absent means the route was mounted outside the middleware chain, which is a
 * wiring bug rather than a client error; `requirePermission` has already turned
 * a missing token into a 401 by the time any handler here runs.
 */
function actorId(c: Context<AppEnv>): string {
  const principal = c.get('principal');
  if (principal === undefined) {
    throw new Error(
      'platform route reached without a principal: it is mounted outside the middleware chain'
    );
  }
  return principal.subject;
}

function assertDefinitionEditable(
  row: ScopedRow<'FormDefinition'>,
  body: FormDefinitionPatchBody
): void {
  if (row.status === 'DRAFT') return;
  const frozen = FROZEN_DEFINITION_FIELDS.filter((field) => body[field] !== undefined);
  if (frozen.length === 0) return;
  throw new ApiError('invalid-transition', {
    detail: `A ${row.status} form definition is frozen. Publish a new version instead of changing ${frozen.join(', ')}.`,
    issues: frozen.map((field) => ({
      path: field,
      message: 'frozen once the version is published',
    })),
  });
}

function toFormDefinitionPatch(
  body: FormDefinitionPatchBody,
  row: ScopedRow<'FormDefinition'>
): FormDefinitionUpdateInput {
  assertDefinitionEditable(row, body);
  return body;
}

function toFormSubmissionPatch(
  body: FormSubmissionPatchBody,
  row: ScopedRow<'FormSubmission'>
): FormSubmissionUpdateInput {
  if (body.status !== undefined) {
    assertTransition(FORM_SUBMISSION_TRANSITIONS, 'form submission', row.status, body.status);
  }
  // Answers are editable while the form is still being filled in and never
  // afterwards. Once it is completed the answer set is what somebody attested
  // to, and the way to change it is the amendment that records the change.
  if (body.values !== undefined && row.status !== 'IN_PROGRESS') {
    throw new ApiError('invalid-transition', {
      detail: `A ${row.status} form submission is not edited in place. Amend it instead.`,
      issues: [{ path: 'values', message: 'only an IN_PROGRESS submission may be edited' }],
    });
  }
  return body;
}

/* ------------------------------------------------------------ the plain four */

function platformCrudModules(): CrudModule[] {
  return [
    defineCrud({
      segment: 'forms/definitions',
      singular: 'form definition',
      plural: 'form definitions',
      tag: 'forms',
      operation: 'FormDefinition',
      readPermission: 'form.read',
      writePermission: 'form.write',
      collection: (repos) => repos.formDefinitions,
      listQuerySchema: formDefinitionListQuerySchema,
      toQuery: toFormDefinitionListQuery,
      listDescription:
        'One row per version of a form. `status` narrows to the versions worth offering; the current one is the highest `version` that is PUBLISHED.',
      createSchema: formDefinitionCreateInput,
      toCreate: (body) => body,
      patchSchema: formDefinitionPatchSchema,
      toPatch: toFormDefinitionPatch,
      dtoSchema: formDefinitionDtoSchema,
      toDto: toFormDefinitionDto,
      writeResponses: [
        { status: 409, description: 'That key and version exist, or the version is frozen.' },
      ],
    }),
    defineCrud({
      segment: 'forms/submissions',
      singular: 'form submission',
      plural: 'form submissions',
      tag: 'forms',
      operation: 'FormSubmission',
      readPermission: 'form.read',
      writePermission: 'form.write',
      chartFrom: 'formSubmissions',
      collection: (repos) => repos.formSubmissions,
      listQuerySchema: formSubmissionListQuerySchema,
      toQuery: toFormSubmissionListQuery,
      listDescription:
        '`from` is inclusive and `to` exclusive on `effectiveAt`, which is the clinically effective instant rather than when the form was keyed in.',
      createSchema: formSubmissionInput,
      toCreate: (body) => body,
      patchSchema: formSubmissionPatchSchema,
      toPatch: toFormSubmissionPatch,
      dtoSchema: formSubmissionDtoSchema,
      toDto: toFormSubmissionDto,
      writeResponses: [
        {
          status: 409,
          description: 'The definition is not PUBLISHED, or the submission is past editing.',
        },
      ],
    }),
    defineCrud({
      segment: 'users',
      singular: 'user',
      plural: 'users',
      tag: 'users',
      operation: 'User',
      readPermission: 'user.read',
      writePermission: 'user.write',
      collection: (repos) => repos.users,
      listQuerySchema: userListQuerySchema,
      toQuery: toUserListQuery,
      listDescription:
        '`isProvider=true` is the clinician picker; `q` is free text over given name, family name and email.',
      createSchema: userCreateSchema,
      toCreate: (body) => body,
      patchSchema: userPatchSchema,
      toPatch: (body) => body,
      dtoSchema: userDtoSchema,
      toDto: toUserDto,
      writeResponses: [{ status: 409, description: 'That email is already registered.' }],
    }),
    defineCrud({
      segment: 'roles',
      caveat: ROLE_MODEL_CAVEAT,
      singular: 'role',
      plural: 'roles',
      tag: 'roles',
      operation: 'Role',
      readPermission: 'role.read',
      writePermission: 'role.write',
      collection: (repos) => repos.roles,
      listQuerySchema: roleListQuerySchema,
      toQuery: toRoleListQuery,
      listDescription:
        '`isSystem=true` are the roles that shipped with the deployment; a tenant may fork them into its own.',
      createSchema: roleCreateSchema,
      toCreate: (body) => body,
      patchSchema: rolePatchSchema,
      toPatch: (body) => body,
      dtoSchema: roleDtoSchema,
      toDto: toRoleDto,
      writeResponses: [{ status: 409, description: 'That role key is taken.' }],
    }),
    defineCrud({
      segment: 'facilities',
      singular: 'facility',
      plural: 'facilities',
      tag: 'facilities',
      operation: 'Facility',
      readPermission: 'facility.read',
      writePermission: 'facility.write',
      collection: (repos) => repos.facilities,
      listQuerySchema: facilityListQuerySchema,
      toQuery: toFacilityListQuery,
      listDescription: '`q` is free text over the name and the short code.',
      createSchema: facilityCreateSchema,
      toCreate: (body) => body,
      patchSchema: facilityPatchSchema,
      toPatch: (body) => body,
      dtoSchema: facilityDtoSchema,
      toDto: toFacilityDto,
      writeResponses: [{ status: 409, description: 'That facility code is taken.' }],
    }),
    defineCrud({
      segment: 'value-sets',
      singular: 'value set',
      plural: 'value sets',
      tag: 'terminology',
      operation: 'ValueSet',
      readPermission: 'terminology.read',
      writePermission: 'terminology.write',
      collection: (repos) => repos.valueSets,
      listQuerySchema: valueSetListQuerySchema,
      toQuery: toValueSetListQuery,
      listDescription:
        'What a quality measure means by a code list. Nothing ships here: measure specifications are public, the value sets behind them are licensed, and a deployment loads the ones it holds a licence for. A measure whose value sets are absent reports that it cannot be computed rather than a rate from a partial list.',
      createSchema: valueSetCreateSchema,
      toCreate: (body) => ({
        url: body.url,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        definition: assertValueSetDefinition(body.definition),
      }),
      patchSchema: valueSetPatchSchema,
      toPatch: (body) => ({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.definition === undefined
          ? {}
          : { definition: assertValueSetDefinition(body.definition) }),
      }),
      dtoSchema: valueSetDtoSchema,
      toDto: toValueSetDto,
      writeResponses: [
        { status: 409, description: 'A value set with that canonical URL already exists.' },
      ],
    }),
    defineCrud({
      segment: 'terminology',
      singular: 'terminology code',
      plural: 'terminology codes',
      tag: 'terminology',
      operation: 'TerminologyCode',
      readPermission: 'terminology.read',
      writePermission: 'terminology.write',
      collection: (repos) => repos.terminology,
      listQuerySchema: terminologyListQuerySchema,
      toQuery: toTerminologyListQuery,
      listDescription:
        'Terminology is bring-your-own: this repository ships no code content, so this list holds exactly what the deployment loaded and is licensed for.',
      createSchema: terminologyCodeInput,
      toCreate: (body) => body,
      patchSchema: terminologyPatchSchema,
      toPatch: (body) => body,
      dtoSchema: terminologyCodeDtoSchema,
      toDto: toTerminologyCodeDto,
      writeResponses: [
        { status: 409, description: 'That system, code and version are already loaded.' },
      ],
    }),
  ];
}

/* ------------------------------------------------------------------ contracts */

interface TransitionContractOptions {
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tag: string;
  permission: Permission;
  singular: string;
  body: z.ZodType;
  dto: z.ZodType;
}

function transitionContract(options: TransitionContractOptions): RouteContract {
  return {
    method: 'post',
    path: options.path,
    operationId: options.operationId,
    summary: options.summary,
    description: options.description,
    tags: [options.tag],
    permission: options.permission,
    pathParams: [
      {
        name: 'id',
        description: `${options.singular} id (UUIDv7).`,
        schema: idParamSchema,
      },
    ],
    body: options.body,
    responses: [
      { status: 200, description: `The ${options.singular}.`, schema: options.dto },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  };
}

function handWrittenContracts(): RouteContract[] {
  return [
    transitionContract({
      path: '/bff/v0/forms/definitions/{id}/publish',
      operationId: 'publishFormDefinition',
      summary: 'Publish a form definition.',
      description:
        'DRAFT becomes PUBLISHED, stamping who published it and when, and storing the compiled artefacts and the promotion manifest. Publishing freezes the version: its key, its binding and its authored document stop being editable, because an in-flight submission has to keep the definition it was authored against.',
      tag: 'forms',
      permission: 'form.write',
      singular: 'form definition',
      body: formDefinitionPublishInput,
      dto: formDefinitionDtoSchema,
    }),
    transitionContract({
      path: '/bff/v0/forms/definitions/{id}/retire',
      operationId: 'retireFormDefinition',
      summary: 'Retire a form definition.',
      description:
        'PUBLISHED becomes RETIRED, stamping when. RETIRED is terminal, and past submissions against the version keep it.',
      tag: 'forms',
      permission: 'form.write',
      singular: 'form definition',
      body: formDefinitionRetireSchema,
      dto: formDefinitionDtoSchema,
    }),
    transitionContract({
      path: '/bff/v0/forms/submissions/{id}/complete',
      operationId: 'completeFormSubmission',
      summary: 'Complete a form submission.',
      description:
        'IN_PROGRESS becomes COMPLETED, stamping when it was completed, which a completed submission must record.',
      tag: 'forms',
      permission: 'form.write',
      singular: 'form submission',
      body: formSubmissionCompleteSchema,
      dto: formSubmissionDtoSchema,
    }),
    transitionContract({
      path: '/bff/v0/forms/submissions/{id}/sign',
      operationId: 'signFormSubmission',
      summary: 'Sign a form submission.',
      description: 'COMPLETED becomes SIGNED, stamping who signed it and when.',
      tag: 'forms',
      permission: 'form.write',
      singular: 'form submission',
      body: formSubmissionSignSchema,
      dto: formSubmissionDtoSchema,
    }),
    transitionContract({
      path: '/bff/v0/forms/submissions/{id}/amend',
      operationId: 'amendFormSubmission',
      summary: 'Amend a signed form submission.',
      description:
        'SIGNED becomes AMENDED and takes the replacement answer set. A signed submission is never edited in place.',
      tag: 'forms',
      permission: 'form.write',
      singular: 'form submission',
      body: formSubmissionAmendSchema,
      dto: formSubmissionDtoSchema,
    }),
    {
      method: 'get',
      path: '/bff/v0/users/{id}/roles',
      operationId: 'listUserRoles',
      summary: "List a user's role assignments.",
      description: `A grant with no facility is organisation-wide. ${ROLE_MODEL_CAVEAT}`,
      tags: ['users'],
      permission: 'role.read',
      pathParams: [{ name: 'id', description: 'User id (UUIDv7).', schema: idParamSchema }],
      query: userRoleListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'One page of role assignments.',
          schema: listResponseSchema(roleAssignmentDtoSchema),
        },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },
    {
      method: 'post',
      path: '/bff/v0/users/{id}/roles',
      operationId: 'assignUserRole',
      summary: 'Grant a user a role.',
      description: `Optionally narrowed to one facility; omitting the facility grants it across the organisation. The same grant cannot be handed out twice. ${ROLE_MODEL_CAVEAT}`,
      tags: ['users'],
      permission: 'role.write',
      pathParams: [{ name: 'id', description: 'User id (UUIDv7).', schema: idParamSchema }],
      body: roleAssignmentCreateSchema,
      responses: [
        { status: 201, description: 'The grant.', schema: roleAssignmentDtoSchema },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
        CONFLICT_RESPONSE,
        UNPROCESSABLE_RESPONSE,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/terminology/lookup',
      operationId: 'lookupTerminologyCode',
      summary: 'Resolve one code to its display.',
      description:
        'Terminology is bring-your-own: this repository ships no code content, because the widely used clinical code sets carry their own licences and each deployment loads only what it is licensed for. A code the deployment has not loaded answers 404, which degrades display and never data - the raw code and its system are stored on the clinical row either way.',
      tags: ['terminology'],
      permission: 'terminology.read',
      query: terminologyLookupQuerySchema,
      responses: [
        { status: 200, description: 'The resolved code.', schema: terminologyLookupDtoSchema },
        ...CRUD_ERRORS,
        {
          status: 404,
          description: 'That code set is not loaded in this deployment.',
          schema: problemDocumentSchema,
        },
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/audit',
      operationId: 'listAuditEvents',
      summary: 'Query the audit log.',
      description:
        'Newest first by default. `from` is inclusive and `to` exclusive on `occurredAt`. `seq` is a decimal string, not a number. Reading this log is itself an access to patient data and is itself audited.',
      tags: ['audit'],
      permission: 'audit.read',
      query: auditQuerySchema,
      responses: [
        {
          status: 200,
          description: 'One page of audit events.',
          schema: listResponseSchema(auditEventDtoSchema),
        },
        ...CRUD_ERRORS,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/audit/verify',
      operationId: 'verifyAuditChain',
      summary: "Verify this organisation's audit chain.",
      description:
        'Walks the chain from its genesis event and reports whether it is intact, how many events were checked, and where the first break is. Any edit or deletion of a past row invalidates every hash after it, so the reported sequence number is where tampering began rather than where it was noticed.',
      tags: ['audit'],
      permission: 'audit.read',
      responses: [
        {
          status: 200,
          description: 'The verification report.',
          schema: auditVerificationDtoSchema,
        },
        ...CRUD_ERRORS,
      ],
    },
    {
      method: 'get',
      path: '/bff/v0/audit/{id}',
      operationId: 'readAuditEvent',
      summary: 'Read one audit event.',
      tags: ['audit'],
      permission: 'audit.read',
      pathParams: [{ name: 'id', description: 'Audit event id (UUIDv7).', schema: idParamSchema }],
      responses: [
        { status: 200, description: 'The audit event.', schema: auditEventDtoSchema },
        ...CRUD_ERRORS,
        NOT_FOUND_RESPONSE,
      ],
    },
  ];
}

export function platformRouteContracts(): RouteContract[] {
  return [
    ...platformCrudModules().flatMap((module) => [...module.contracts]),
    ...handWrittenContracts(),
  ];
}

/* ------------------------------------------------------------------- handlers */

/**
 * Refuses a submission pinned to a definition that is not published.
 *
 * It runs before the collection's own create handler rather than inside it,
 * because the answer is in another aggregate and a create input cannot reach
 * one. A submission pinned to a draft is a submission whose validation could
 * change under it: the draft is still being edited, so the rules the answers
 * were accepted against would not be the rules anybody could reconstruct later.
 */
async function assertDefinitionPublished(c: Context<AppEnv>, next: Next): Promise<void> {
  const body = await parseJsonBody(c, formSubmissionInput);
  const definition = await repositories(c).formDefinitions.findById(body.formDefinitionId);
  if (definition === null) {
    throw ApiError.validation('The request body failed validation.', [
      { path: 'formDefinitionId', message: 'no such form definition in this organisation' },
    ]);
  }
  if (definition.status !== 'PUBLISHED') {
    throw ApiError.conflict(
      `Version ${definition.version} of the form ${definition.key} is ${definition.status}. A submission may only be recorded against a PUBLISHED definition.`
    );
  }
  await next();
}

export function platformRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // Literal paths first: `/terminology/lookup` would otherwise be matched by
  // the terminology collection's `/:id` route and rejected as a malformed id.
  router.get('/terminology/lookup', requirePermission('terminology.read'), async (c) => {
    const input = parseQuery(c, terminologyLookupQuerySchema);
    const page = await repositories(c).terminology.list(toTerminologyLookupQuery(input));
    const row = page.rows[0];
    if (row === undefined) {
      throw ApiError.notFound(
        `The code ${input.code} from ${input.system} is not loaded in this deployment.`
      );
    }
    return c.json(toTerminologyLookupDto(row));
  });

  router.post('/forms/submissions', requirePermission('form.write'), assertDefinitionPublished);

  for (const module of platformCrudModules()) {
    router.route('/', module.routes);
  }

  router.post('/forms/definitions/:id/publish', requirePermission('form.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, formDefinitionPublishInput);
    if (body.formDefinitionId !== id) {
      throw ApiError.validation('The request body failed validation.', [
        { path: 'formDefinitionId', message: 'must be the definition named in the path' },
      ]);
    }

    const collection = repositories(c).formDefinitions;
    const existing = required(await collection.findById(id), MISSING_DEFINITION);
    assertTransition(FORM_DEFINITION_TRANSITIONS, 'form definition', existing.status, 'PUBLISHED');

    const row = await collection.update(id, {
      status: 'PUBLISHED',
      // The instant is stamped by the spec from the request's clock when the
      // caller does not name one, so it matches the row's own `updatedAt`.
      ...(body.publishedAt === undefined ? {} : { publishedAt: body.publishedAt }),
      publishedById: actorId(c),
      compiled: body.compiled,
      ...(body.promotionManifest === undefined
        ? {}
        : { promotionManifest: body.promotionManifest }),
    });
    return c.json(toFormDefinitionDto(required(row, MISSING_DEFINITION)));
  });

  router.post('/forms/definitions/:id/retire', requirePermission('form.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, formDefinitionRetireSchema);
    const collection = repositories(c).formDefinitions;
    const existing = required(await collection.findById(id), MISSING_DEFINITION);
    assertTransition(FORM_DEFINITION_TRANSITIONS, 'form definition', existing.status, 'RETIRED');

    const row = await collection.update(id, {
      status: 'RETIRED',
      ...(body.retiredAt === undefined ? {} : { retiredAt: body.retiredAt }),
    });
    return c.json(toFormDefinitionDto(required(row, MISSING_DEFINITION)));
  });

  router.post('/forms/submissions/:id/complete', requirePermission('form.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, formSubmissionCompleteSchema);
    const collection = repositories(c).formSubmissions;
    /*
     * A submission names a chart, and the generated read of one is gated by
     * the `chartFrom` this module declares for it. These three transitions are
     * registered by hand, so the CRUD seam never saw them (#322): driven on a
     * clinician refused the read, each answered 200. Written without the
     * declaration spelt out, because `bff.chart-crud-gate.test.ts` scans this
     * file as TEXT and a comment quoting `chartFrom: '...'` is indistinguishable
     * from one - it read this paragraph as `terminology` declaring a chart.
     *
     * Driven on `dev`, a
     * clinician refused `GET /forms/submissions/{id}` with 404 could still
     * complete, sign and amend the same submission, each answering 200.
     *
     * Signing is the one that decides it. A signed form is an attestation
     * carrying `signedById`, so an ungated door stamps the refused caller's
     * name on a document in a chart they cannot open.
     */
    const existing = await requiredParentChart(
      c,
      'formSubmissions',
      await collection.findById(id),
      MISSING_SUBMISSION
    );
    assertTransition(FORM_SUBMISSION_TRANSITIONS, 'form submission', existing.status, 'COMPLETED');

    const row = await collection.update(id, {
      status: 'COMPLETED',
      ...(body.completedAt === undefined ? {} : { completedAt: body.completedAt }),
      ...(body.completedByType === undefined ? {} : { completedByType: body.completedByType }),
      ...(body.completedByUserId === undefined
        ? {}
        : { completedByUserId: body.completedByUserId }),
    });
    return c.json(toFormSubmissionDto(required(row, MISSING_SUBMISSION)));
  });

  router.post('/forms/submissions/:id/sign', requirePermission('form.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, formSubmissionSignSchema);
    const collection = repositories(c).formSubmissions;
    const existing = await requiredParentChart(
      c,
      'formSubmissions',
      await collection.findById(id),
      MISSING_SUBMISSION
    );
    assertTransition(FORM_SUBMISSION_TRANSITIONS, 'form submission', existing.status, 'SIGNED');

    const row = await collection.update(id, {
      status: 'SIGNED',
      ...(body.signedAt === undefined ? {} : { signedAt: body.signedAt }),
      signedById: actorId(c),
    });
    return c.json(toFormSubmissionDto(required(row, MISSING_SUBMISSION)));
  });

  router.post('/forms/submissions/:id/amend', requirePermission('form.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, formSubmissionAmendSchema);
    const collection = repositories(c).formSubmissions;
    const existing = await requiredParentChart(
      c,
      'formSubmissions',
      await collection.findById(id),
      MISSING_SUBMISSION
    );
    assertTransition(FORM_SUBMISSION_TRANSITIONS, 'form submission', existing.status, 'AMENDED');

    const row = await collection.update(id, {
      status: 'AMENDED',
      values: body.values,
      ...(body.effectiveAt === undefined ? {} : { effectiveAt: body.effectiveAt }),
    });
    return c.json(toFormSubmissionDto(required(row, MISSING_SUBMISSION)));
  });

  router.get('/users/:id/roles', requirePermission('role.read'), async (c) => {
    const userId = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);
    required(await repos.users.findById(userId), MISSING_USER);
    const query = toRoleAssignmentListQuery(parseQuery(c, userRoleListQuerySchema), userId);
    const page = await repos.roleAssignments.list(query);
    return c.json(toListResponse(page, toRoleAssignmentDto));
  });

  router.post('/users/:id/roles', requirePermission('role.write'), async (c) => {
    const userId = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseJsonBody(c, roleAssignmentCreateSchema);
    const repos = repositories(c);
    required(await repos.users.findById(userId), MISSING_USER);

    if ((await repos.roles.findById(body.roleId)) === null) {
      throw ApiError.validation('The request body failed validation.', [
        { path: 'roleId', message: 'no such role in this organisation' },
      ]);
    }
    if (body.facilityId !== undefined) {
      assertFacilityAccess(policyOf(c), body.facilityId);
    }

    // `@@unique([userId, roleId, facilityId])` is only half a constraint.
    // Postgres treats NULLs as distinct in a unique index, so two
    // organisation-wide grants of the same role to the same user are two
    // different rows as far as the database is concerned, and the duplicate
    // has to be refused here. The check covers the facility-scoped case too,
    // so a duplicate is refused the same way whichever kind it is.
    const held = await repos.roleAssignments.list({
      page: 1,
      // A user holds a handful of grants, and `userId` plus `roleId` narrows to
      // at most one per facility, so one page is the whole set.
      pageSize: MAX_PAGE_SIZE,
      userId,
      roleId: body.roleId,
      sort: 'createdAt',
      order: 'asc',
    });
    const wanted = body.facilityId ?? null;
    if (held.rows.some((row) => row.facilityId === wanted)) {
      throw ApiError.conflict(
        wanted === null
          ? 'That user already holds this role across the organisation.'
          : 'That user already holds this role at that facility.'
      );
    }

    const row = await repos.roleAssignments.create({
      userId,
      roleId: body.roleId,
      ...(body.facilityId === undefined ? {} : { facilityId: body.facilityId }),
    });
    // The grant has no instance route of its own - it is read through the
    // user's list - so `Location` names that list.
    return c.json(toRoleAssignmentDto(row), 201, { Location: `/bff/v0/users/${userId}/roles` });
  });

  /*
   * The audit log is readable and never writable through this API. There is
   * deliberately no create and no update below: an endpoint that could insert
   * an audit event would let an actor forge their own alibi, and one that could
   * amend a past event would break every hash after it - which is exactly what
   * `/audit/verify` exists to notice.
   */
  router.get('/audit', requirePermission('audit.read'), async (c) => {
    const query = toAuditQuery(parseQuery(c, auditQuerySchema));
    const page = await repositories(c).audit.list(query);
    return c.json(toListResponse(page, toAuditEventDto));
  });

  router.get('/audit/verify', requirePermission('audit.read'), async (c) => {
    const result = await repositories(c).audit.verifyChain();
    return c.json(toAuditVerificationDto(result));
  });

  router.get('/audit/:id', requirePermission('audit.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const row = required(await repositories(c).audit.findById(id), MISSING_AUDIT_EVENT);
    return c.json(toAuditEventDto(row));
  });

  return router;
}

/**
 * Checks a value set definition against the terminology package's own schema.
 *
 * Validated here rather than restated in a Zod schema beside the DTO, because
 * the shape belongs to `packages/terminology` and two schemas for one shape is
 * two places to change when a rule field is added. One of them is always the
 * one nobody remembers.
 *
 * Unknown keys are refused rather than ignored, which is the terminology
 * package's decision and the right one: a misspelled `parentcode` that silently
 * widened a value set to a whole code system would be discovered by a clinician
 * reading a quality report, not by an operator.
 */
function assertValueSetDefinition(definition: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseValueSetDefinition(definition);
  if (!parsed.ok) {
    // The package reports one string per problem rather than a path and a
    // message, so they land at the root. That is honest: a rule index is not a
    // field a caller can point at in a form, and inventing a path would send
    // somebody to the wrong input.
    throw ApiError.validation(
      parsed.error.message,
      parsed.error.issues.map((issue) => ({ path: 'definition', message: issue }))
    );
  }
  return definition;
}

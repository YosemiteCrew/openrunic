import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { parseJsonBody, parseHeader, parseParam, parseQuery } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import { idParamSchema, listResponseSchema, toListResponse } from '../schemas/pagination.js';
import {
  contactIntakeDtoSchema,
  contactIntakeListQuerySchema,
  contactIntakeOutboxDtoSchema,
  contactIntakeOutboxListQuerySchema,
  toContactIntakeDto,
  toContactIntakeListQuery,
  toContactIntakeOutboxDto,
  toContactIntakeOutboxListQuery,
} from '../schemas/contact.js';
import { repositories, required } from './helpers.js';

const CONTACT_INTAKE_KEY = process.env.SUPERADMIN_CONTACT_INTAKE_KEY;

/**
 * Inbound contact intake from Yosemite Crew.
 *
 * The Yosemite Crew backend forwards public contact-us and accessibility-report
 * submissions to this endpoint. Authentication is via a shared secret in the
 * `x-contact-key` header. The `sourceRequestId` (Yosemite Crew contactRequest.id)
 * is the idempotency key - duplicate forwards are silently accepted.
 *
 * If the intake is not configured or the key is invalid, the submission is
 * stored in the outbox for later retry. This provides the queue that the
 * mirror was missing - allowing backfill once the key is configured.
 */
function assertContactKey(c: Context<AppEnv>): boolean {
  if (!CONTACT_INTAKE_KEY) {
    return false;
  }

  const providedKey = parseHeader(c, 'x-contact-key', z.string());
  if (providedKey !== CONTACT_INTAKE_KEY) {
    return false;
  }

  return true;
}

async function storeInOutbox(
  repos: ReturnType<typeof repositories>,
  body: z.infer<typeof contactIntakeCreateInputSchema>,
  error: string
): Promise<void> {
  // Check if already in outbox (idempotency) - sourceRequestId is the primary key
  const existing = await repos.contactIntakeOutboxes.findById(body.sourceRequestId);

  if (existing) {
    // Increment attempts and update last error
    await repos.contactIntakeOutboxes.update(body.sourceRequestId, {
      attempts: existing.attempts + 1,
      lastError: error,
      lastAttemptAt: new Date(),
    });
    return;
  }

  // Create new outbox entry - sourceRequestId is used as the id by the storage layer
  await repos.contactIntakeOutboxes.create({
    sourceRequestId: body.sourceRequestId,
    type: body.type,
    source: body.source,
    message: body.message,
    fullName: body.fullName,
    email: body.email,
    phone: body.phone,
    organisationId: body.organisationId,
    dsarDetails: body.dsarDetails,
    attachments: body.attachments,
    sourceCreatedAt: new Date(body.sourceCreatedAt),
    lastError: error,
    attempts: 1,
    lastAttemptAt: new Date(),
  });
}

const contactIntakeCreateInputSchema = z.object({
  sourceRequestId: z.string().uuid(),
  type: z.enum(['GENERAL_ENQUIRY', 'FEATURE_REQUEST', 'DSAR', 'COMPLAINT']),
  source: z.enum(['PMS_WEB', 'MARKETING_SITE']),
  message: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  organisationId: z.string().uuid().optional(),
  dsarDetails: z.unknown().optional(),
  attachments: z.unknown().optional(),
  sourceCreatedAt: z.iso.datetime(),
});

const CONTACT_INTAKE_CREATE_CONTRACT: RouteContract = {
  method: 'post',
  path: '/api/contact',
  operationId: 'createContactIntake',
  summary: 'Receive a contact submission from Yosemite Crew.',
  description:
    'Public endpoint for the Yosemite Crew backend to forward contact-us and accessibility-report submissions. Authenticated by shared secret in x-contact-key header. The sourceRequestId is the idempotency key - duplicate forwards are silently accepted. If the intake is not configured or the key is invalid, the submission is stored in the outbox for later retry.',
  tags: ['contact'],
  permission: 'contact.write',
  body: contactIntakeCreateInputSchema,
  responses: [
    {
      status: 201,
      description: 'The contact intake was recorded (or already existed).',
      schema: contactIntakeDtoSchema,
    },
    {
      status: 202,
      description:
        'The contact intake was accepted but stored in outbox for later processing (intake not configured or invalid key).',
      schema: contactIntakeDtoSchema,
    },
    { status: 401, description: 'Invalid or missing x-contact-key header.' },
  ],
};

const CONTACT_INTAKE_LIST_CONTRACT: RouteContract = {
  method: 'get',
  path: '/bff/v0/crm/requests',
  operationId: 'listContactIntakes',
  summary: 'List CRM contact requests.',
  description: 'Paginated list of contact submissions forwarded from Yosemite Crew, newest first.',
  tags: ['crm'],
  permission: 'contact.read',
  query: contactIntakeListQuerySchema,
  responses: [
    {
      status: 200,
      description: 'One page of contact intakes.',
      schema: listResponseSchema(contactIntakeDtoSchema),
    },
  ],
};

const CONTACT_INTAKE_GET_CONTRACT: RouteContract = {
  method: 'get',
  path: '/bff/v0/crm/requests/{id}',
  operationId: 'getContactIntake',
  summary: 'Get one CRM contact request.',
  tags: ['crm'],
  permission: 'contact.read',
  pathParams: [
    {
      name: 'id',
      description: 'Contact intake id (UUIDv7).',
      schema: idParamSchema,
    },
  ],
  responses: [
    { status: 200, description: 'The contact intake.', schema: contactIntakeDtoSchema },
    { status: 404, description: 'Not found.' },
  ],
};

const CONTACT_INTAKE_OUTBOX_LIST_CONTRACT: RouteContract = {
  method: 'get',
  path: '/bff/v0/crm/outbox',
  operationId: 'listContactIntakeOutbox',
  summary: 'List contact intake outbox (pending retries).',
  description:
    'Paginated list of contact submissions that failed to be processed and are queued for retry.',
  tags: ['crm'],
  permission: 'contact.read',
  query: contactIntakeOutboxListQuerySchema,
  responses: [
    {
      status: 200,
      description: 'One page of contact intake outbox entries.',
      schema: listResponseSchema(contactIntakeOutboxDtoSchema),
    },
  ],
};

const CONTACT_INTAKE_OUTBOX_RETRY_CONTRACT: RouteContract = {
  method: 'post',
  path: '/bff/v0/crm/outbox/retry',
  operationId: 'retryContactIntakeOutbox',
  summary: 'Retry processing contact intake outbox entries.',
  description:
    'Processes pending outbox entries, moving them to the main intake table if successful.',
  tags: ['crm'],
  permission: 'contact.write',
  responses: [
    {
      status: 200,
      description: 'Outbox retry completed.',
      schema: z.object({ processed: z.number(), succeeded: z.number(), failed: z.number() }),
    },
  ],
};

export function contactRouteContracts(): RouteContract[] {
  return [
    CONTACT_INTAKE_CREATE_CONTRACT,
    CONTACT_INTAKE_LIST_CONTRACT,
    CONTACT_INTAKE_GET_CONTRACT,
    CONTACT_INTAKE_OUTBOX_LIST_CONTRACT,
    CONTACT_INTAKE_OUTBOX_RETRY_CONTRACT,
  ];
}

export function contactRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // Public inbound endpoint - authenticated by shared secret, not by user session
  router.post('/api/contact', async (c) => {
    const hasValidKey = assertContactKey(c);

    const body = await parseJsonBody(c, contactIntakeCreateInputSchema);
    const repos = repositories(c);

    // Idempotency: check if already in main intake table (sourceRequestId is the primary key)
    const existing = await repos.contactIntakes.findById(body.sourceRequestId);

    if (existing) {
      // Already recorded - return existing row
      return c.json(toContactIntakeDto(existing), 201);
    }

    // Also check outbox for idempotency
    const existingOutbox = await repos.contactIntakeOutboxes.findById(body.sourceRequestId);

    if (existingOutbox && existingOutbox.processedAt) {
      // Was in outbox but already processed - should be in main table now
      // This shouldn't happen due to the check above, but handle gracefully
      const processed = await repos.contactIntakes.findById(body.sourceRequestId);
      if (processed) {
        return c.json(toContactIntakeDto(processed), 201);
      }
    }

    if (!hasValidKey) {
      // Store in outbox for later retry
      const error = CONTACT_INTAKE_KEY
        ? 'Invalid contact intake key'
        : 'Contact intake is not configured';
      await storeInOutbox(repos, body, error);
      return c.json(
        {
          status: 'queued',
          message:
            'Contact intake not configured or invalid key. Submission queued for later processing.',
          sourceRequestId: body.sourceRequestId,
        },
        202
      );
    }

    // Key is valid, process normally - sourceRequestId is the primary key
    const created = await repos.contactIntakes.create({
      sourceRequestId: body.sourceRequestId,
      type: body.type,
      source: body.source,
      message: body.message,
      fullName: body.fullName,
      email: body.email,
      phone: body.phone,
      organisationId: body.organisationId,
      dsarDetails: body.dsarDetails,
      attachments: body.attachments,
      sourceCreatedAt: new Date(body.sourceCreatedAt),
    });

    return c.json(toContactIntakeDto(created), 201);
  });

  // CRM list endpoint
  router.get('/crm/requests', requirePermission('contact.read'), async (c) => {
    const query = parseQuery(c, contactIntakeListQuerySchema);
    const repos = repositories(c);
    const tenantId = c.get('tenantId')!;

    const page = await repos.contactIntakes.list({
      ...toContactIntakeListQuery(query, tenantId),
    });

    return c.json(toListResponse(page, toContactIntakeDto));
  });

  // CRM get by id
  router.get('/crm/requests/:id', requirePermission('contact.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);

    const intake = required(await repos.contactIntakes.findById(id), 'Contact intake not found');

    return c.json(toContactIntakeDto(intake));
  });

  // Outbox list endpoint
  router.get('/crm/outbox', requirePermission('contact.read'), async (c) => {
    const query = parseQuery(c, contactIntakeOutboxListQuerySchema);
    const repos = repositories(c);
    const tenantId = c.get('tenantId')!;

    const page = await repos.contactIntakeOutboxes.list({
      ...toContactIntakeOutboxListQuery(query, tenantId),
    });

    return c.json(toListResponse(page, toContactIntakeOutboxDto));
  });

  // Outbox retry endpoint
  router.post('/crm/outbox/retry', requirePermission('contact.write'), async (c) => {
    if (!CONTACT_INTAKE_KEY) {
      throw ApiError.serviceUnavailable('Contact intake is not configured - cannot process outbox');
    }

    const repos = repositories(c);
    const tenantId = c.get('tenantId')!;

    // Get all unprocessed outbox entries that haven't exceeded max attempts
    // Use list with filter for processed=false
    const outboxPage = await repos.contactIntakeOutboxes.list({
      page: 1,
      pageSize: 100,
      sort: 'receivedAt',
      order: 'asc',
      processed: false,
      tenantId,
      // Note: attempts filter not in query schema, will filter in memory
    });

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const entry of outboxPage.rows) {
      // Filter by attempts in memory since it's not in the query schema
      if (entry.attempts >= 5) continue;

      processed++;

      try {
        // Check if already in main table (idempotency)
        const existing = await repos.contactIntakes.findById(entry.sourceRequestId);

        if (existing) {
          // Already processed - mark outbox entry as processed
          await repos.contactIntakeOutboxes.update(entry.id, { processedAt: new Date() });
          succeeded++;
          continue;
        }

        // Create in main intake table - sourceRequestId is the primary key
        await repos.contactIntakes.create({
          sourceRequestId: entry.sourceRequestId,
          type: entry.type as 'GENERAL_ENQUIRY' | 'FEATURE_REQUEST' | 'DSAR' | 'COMPLAINT',
          source: entry.source as 'PMS_WEB' | 'MARKETING_SITE',
          message: entry.message,
          fullName: entry.fullName,
          email: entry.email,
          phone: entry.phone,
          organisationId: entry.organisationId,
          dsarDetails: entry.dsarDetails,
          attachments: entry.attachments,
          sourceCreatedAt: entry.sourceCreatedAt,
        });

        // Mark outbox entry as processed
        await repos.contactIntakeOutboxes.update(entry.id, { processedAt: new Date() });

        succeeded++;
      } catch (error) {
        failed++;
        // Update outbox entry with error
        await repos.contactIntakeOutboxes.update(entry.id, {
          attempts: entry.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Unknown error',
          lastAttemptAt: new Date(),
        });
      }
    }

    return c.json({ processed, succeeded, failed });
  });

  return router;
}

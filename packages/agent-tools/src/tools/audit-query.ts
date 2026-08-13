import { z } from 'zod';

import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';

import { apiListSchema } from './shared.js';

/**
 * Tool 7. Runs a parameterised audit query and returns the raw rows plus the
 * query it ran.
 *
 * Hard-walled from any write, redaction or re-chaining: there is no such tool
 * and no such parameter. What it may say is "this query returned N rows". What
 * it may never say is "no inappropriate access occurred" - the investigator
 * draws the conclusion, and the output schema has nowhere to put one.
 *
 * **Reachability.** `audit.query` is not yet in the API's permission catalogue
 * and `/bff/v0/audit-events` is not yet mounted, so no principal holds the
 * scope and the tool resolves to invisible for every caller today. That is
 * deny-by-default working as designed rather than a gap being hidden:
 * `resolve.deny-by-default.test.ts` asserts the invisibility, and the tool
 * becomes reachable the day the platform grows the permission and the route,
 * with no change here.
 */

const MAX_ROWS = 100;

/** Not a permission the API knows yet. Declared so the grant is explicit when it exists. */
export const AUDIT_QUERY_SCOPE = 'audit.query';

const auditRowSchema = z.object({
  id: z.string(),
  seq: z.union([z.string(), z.number()]),
  occurredAt: z.string(),
  actorId: z.string(),
  actorType: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable().optional(),
  outcome: z.string(),
});

export const auditQuery = defineTool({
  id: 'audit.query',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: [AUDIT_QUERY_SCOPE],
  surfaces: ['staff'],
  summary: 'Runs an audit query and returns the rows it matched, with the query that ran.',
  activityLabel: 'Running an audit query',
  maxResultRows: MAX_ROWS,
  compartmentBound: false,
  input: z.strictObject({
    actorId: z.uuid().optional(),
    action: z.string().min(1).max(64).optional(),
    targetType: z.string().min(1).max(64).optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  }),
  output: z.strictObject({
    /** Verbatim, so a reviewer checks the question as well as the answer. */
    queryRan: z.string().max(512),
    rowCount: z.int().min(0),
    rows: z.array(auditRowSchema),
  }),

  async execute(input, context) {
    const body = await context.api.call(
      {
        method: 'GET',
        path: '/bff/v0/audit-events',
        query: { pageSize: MAX_ROWS, ...input },
      },
      context
    );

    const parsed = apiListSchema(auditRowSchema).safeParse(body);
    if (!parsed.success) {
      throw new ToolError(
        'AGENT_TOOL_OUTPUT_INVALID',
        'audit.query read a list the API described differently than expected.',
        { toolId: 'audit.query' }
      );
    }

    return {
      queryRan: Object.entries(input)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' '),
      rowCount: parsed.data.page.total,
      rows: parsed.data.data,
    };
  },
});

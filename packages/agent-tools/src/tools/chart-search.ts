import { z } from 'zod';

import { ToolError } from '../errors.js';
import type { AgentPrincipal } from '../principal.js';
import { defineTool } from '../registry.js';

import {
  apiListSchema,
  dateOnlySchema,
  recordCardSchema,
  retrievalResultSchema,
  type RecordCard,
} from './shared.js';

/**
 * Tool 1 of the catalogue, and the one that ships first.
 *
 * It translates a natural-language question into a structured query and returns
 * **actual records**. It never returns a statement about the record. That is
 * the property that makes it the safest useful thing the agent can do: its
 * failure mode is a visible null result, and it is the only task on the v1 list
 * with that property.
 *
 * Two limits are deliberate. The row cap is minimum-necessary, not paging:
 * exceeding it is a scope violation that aborts, never a silent truncation that
 * hides how much was matched. And the biller projection drops everything that
 * is not needed to work a claim, because "the role could read it through the UI
 * too" is a reason to design the projection, not a reason to skip it.
 */

const MAX_ROWS = 25;

const patientQuerySchema = z.strictObject({
  resource: z.literal('patient'),
  /** Free text over name and medical record number, as the API's own search does it. */
  text: z.string().min(1).max(120).optional(),
  family: z.string().min(1).max(80).optional(),
  given: z.string().min(1).max(80).optional(),
  birthDate: dateOnlySchema.optional(),
  active: z.boolean().optional(),
});

const appointmentQuerySchema = z.strictObject({
  resource: z.literal('appointment'),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  status: z.enum(['proposed', 'booked', 'arrived', 'fulfilled', 'cancelled', 'noshow']).optional(),
  providerId: z.uuid().optional(),
});

const encounterQuerySchema = z.strictObject({
  resource: z.literal('encounter'),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

/**
 * Note what is absent from every branch: a tenant, an organisation, and a
 * patient identifier. The organisation comes from the verified session and the
 * chart comes from the screen the caller has open. If the model could name
 * either, the model could cross either.
 */
const inputSchema = z.discriminatedUnion('resource', [
  patientQuerySchema,
  appointmentQuerySchema,
  encounterQuerySchema,
]);

const patientRowSchema = z.object({
  id: z.string(),
  mrn: z.string(),
  name: z.object({ given: z.string(), family: z.string() }),
  birthDate: z.string(),
  active: z.boolean(),
});

const appointmentRowSchema = z.object({
  id: z.string(),
  patientId: z.string().nullable(),
  providerId: z.string(),
  type: z.object({ code: z.string(), display: z.string() }),
  status: z.string(),
  start: z.string(),
  durationMinutes: z.number(),
});

const encounterRowSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  periodStart: z.string().optional(),
  classCode: z.string().optional(),
});

export const chartSearch = defineTool({
  id: 'chart.search',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['patient.read'],
  surfaces: ['staff'],
  summary: 'Finds records in the chart from a plain-language description and returns the records.',
  activityLabel: 'Searching the chart',
  maxResultRows: MAX_ROWS,
  compartmentBound: false,
  input: inputSchema,
  output: retrievalResultSchema,

  async execute(input, context) {
    if (input.resource === 'patient') {
      const body = await context.api.call(
        {
          method: 'GET',
          path: '/bff/v0/patients',
          query: {
            pageSize: MAX_ROWS,
            ...(input.text === undefined ? {} : { q: input.text }),
            ...(input.family === undefined ? {} : { family: input.family }),
            ...(input.given === undefined ? {} : { given: input.given }),
            ...(input.birthDate === undefined ? {} : { birthDate: input.birthDate }),
            ...(input.active === undefined ? {} : { active: input.active }),
          },
        },
        context
      );

      const page = parsePage(apiListSchema(patientRowSchema), body);
      const codedOnly = isCodedOnly(context.principal);

      return {
        queryRan: renderQuery(input),
        total: page.page.total,
        shown: page.data.length,
        rows: page.data.map((row): RecordCard => {
          const fields = [
            { name: 'Medical record number', value: row.mrn },
            { name: 'Date of birth', value: row.birthDate },
          ];
          return {
            type: 'Patient',
            id: row.id,
            label: codedOnly ? row.mrn : `${row.name.family}, ${row.name.given}`,
            fields: codedOnly ? fields : [...fields, { name: 'Active', value: String(row.active) }],
            source: { resourceType: 'Patient', resourceId: row.id, field: 'mrn' },
          };
        }),
      };
    }

    if (input.resource === 'appointment') {
      const body = await context.api.call(
        {
          method: 'GET',
          path: '/bff/v0/appointments',
          query: {
            pageSize: MAX_ROWS,
            ...(input.from === undefined ? {} : { from: input.from }),
            ...(input.to === undefined ? {} : { to: input.to }),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
          },
        },
        context
      );

      const page = parsePage(apiListSchema(appointmentRowSchema), body);
      return {
        queryRan: renderQuery(input),
        total: page.page.total,
        shown: page.data.length,
        rows: page.data.map((row): RecordCard => ({
          type: 'Appointment',
          id: row.id,
          label: `${row.type.display} - ${row.start}`,
          fields: [
            { name: 'Status', value: row.status },
            { name: 'Starts', value: row.start },
            { name: 'Minutes', value: String(row.durationMinutes) },
          ],
          source: { resourceType: 'Appointment', resourceId: row.id, field: 'start' },
        })),
      };
    }

    const body = await context.api.call(
      {
        method: 'GET',
        path: '/bff/v0/encounters',
        query: {
          pageSize: MAX_ROWS,
          ...(input.from === undefined ? {} : { from: input.from }),
          ...(input.to === undefined ? {} : { to: input.to }),
        },
      },
      context
    );

    const page = parsePage(apiListSchema(encounterRowSchema), body);
    return {
      queryRan: renderQuery(input),
      total: page.page.total,
      shown: page.data.length,
      rows: page.data.map((row): RecordCard => ({
        type: 'Encounter',
        id: row.id,
        label: row.classCode ?? 'Encounter',
        fields: [
          { name: 'Status', value: row.status ?? 'unknown' },
          { name: 'Started', value: row.periodStart ?? 'unknown' },
        ],
        source: { resourceType: 'Encounter', resourceId: row.id, field: 'periodStart' },
      })),
    };
  },
});

/**
 * A biller works claims, not charts. They see the identifier and the coded
 * fields; they do not see a name they did not need.
 */
function isCodedOnly(principal: AgentPrincipal): boolean {
  return principal.roleIds.includes('biller') && !principal.roleIds.includes('clinician');
}

function parsePage<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      'chart.search read a list the API described differently than expected.',
      { toolId: 'chart.search' }
    );
  }
  return parsed.data;
}

/** Renders the structured query for the operator, with values, not prose. */
function renderQuery(input: z.infer<typeof inputSchema>): string {
  const terms = Object.entries(input)
    .filter(([key]) => key !== 'resource')
    .map(([key, value]) => `${key}=${String(value)}`);
  return `${input.resource}${terms.length === 0 ? '' : ` ${terms.join(' ')}`}`;
}

export { recordCardSchema };

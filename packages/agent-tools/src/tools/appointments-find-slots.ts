import { z } from 'zod';

import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';

import { apiListSchema } from './shared.js';

/**
 * Tool 8. Parses the request, then hands the actual problem to a deterministic
 * engine.
 *
 * The model chooses the window, the provider and the duration. The free-slot
 * computation below is ordinary arithmetic over booked rows. Models do not do
 * constraint satisfaction, and a plausible schedule that violates an unmodelled
 * constraint - licensure, room, equipment, interpreter - is worse than no
 * suggestion, because it looks like an answer.
 */

const MAX_SLOTS = 12;
const SLOT_STEP_MINUTES = 15;
const MAX_WINDOW_DAYS = 14;

const bookedSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  status: z.string(),
  start: z.string(),
  durationMinutes: z.number(),
});

export const appointmentsFindSlots = defineTool({
  id: 'appointments.findSlots',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['appointment.read'],
  surfaces: ['staff'],
  summary: 'Finds free appointment slots for a provider inside a window.',
  activityLabel: 'Checking the schedule',
  maxResultRows: MAX_SLOTS,
  compartmentBound: false,
  input: z
    .strictObject({
      providerId: z.uuid(),
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      durationMinutes: z.int().min(5).max(240),
    })
    .refine((value) => Date.parse(value.to) > Date.parse(value.from), {
      message: 'The window must end after it starts.',
      path: ['to'],
    })
    .refine(
      (value) =>
        Date.parse(value.to) - Date.parse(value.from) <= MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      { message: `The window may span at most ${String(MAX_WINDOW_DAYS)} days.`, path: ['to'] }
    ),
  output: z.strictObject({
    queryRan: z.string().max(512),
    /** Booked rows considered, so a reader can see what the answer was computed from. */
    consideredCount: z.int().min(0),
    slots: z.array(z.strictObject({ start: z.string(), end: z.string() })),
  }),

  async execute(input, context) {
    const body = await context.api.call(
      {
        method: 'GET',
        path: '/bff/v0/appointments',
        query: {
          pageSize: 100,
          providerId: input.providerId,
          from: input.from,
          to: input.to,
        },
      },
      context
    );

    const parsed = apiListSchema(bookedSchema).safeParse(body);
    if (!parsed.success) {
      throw new ToolError(
        'AGENT_TOOL_OUTPUT_INVALID',
        'appointments.findSlots read a schedule the API described differently than expected.',
        { toolId: 'appointments.findSlots' }
      );
    }

    const busy = parsed.data.data
      .filter((row) => row.status !== 'cancelled' && row.status !== 'noshow')
      .map((row) => ({
        start: Date.parse(row.start),
        end: Date.parse(row.start) + row.durationMinutes * 60_000,
      }));

    return {
      queryRan: `provider=${input.providerId} from=${input.from} to=${input.to} minutes=${String(input.durationMinutes)}`,
      consideredCount: parsed.data.data.length,
      slots: freeSlots(
        Date.parse(input.from),
        Date.parse(input.to),
        input.durationMinutes,
        busy
      ).map((start) => ({
        start: new Date(start).toISOString(),
        end: new Date(start + input.durationMinutes * 60_000).toISOString(),
      })),
    };
  },
});

/** The engine. Deterministic, total, and testable without a model in the loop. */
export function freeSlots(
  windowStart: number,
  windowEnd: number,
  durationMinutes: number,
  busy: readonly { start: number; end: number }[]
): number[] {
  const step = SLOT_STEP_MINUTES * 60_000;
  const duration = durationMinutes * 60_000;
  const found: number[] = [];

  for (let start = windowStart; start + duration <= windowEnd; start += step) {
    if (found.length >= MAX_SLOTS) break;
    const end = start + duration;
    const clash = busy.some((slot) => start < slot.end && end > slot.start);
    if (!clash) found.push(start);
  }

  return found;
}

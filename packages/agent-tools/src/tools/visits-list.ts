import { z } from 'zod';

import { defineTool } from '../registry.js';

import {
  assertChartBound,
  ownedRetrieval,
  ownedRetrievalSchema,
  parseOwnedPage,
  plainStatus,
  type OwnedRecord,
} from './patient-shared.js';

/**
 * Patient tool 2. Lists the reader's own appointments, before or after today.
 *
 * "When am I next in?" is the question a portal is opened for, and it is
 * administrative from end to end: no clinical content, no grading, nothing a
 * reader could mistake for advice. That is why it is on the shortest possible
 * list of things a patient-facing assistant may do.
 *
 * The window is computed here rather than asked of the model. A model told to
 * work out "from now" produces a date that is plausible and occasionally wrong,
 * and an appointment list off by a day is worse than no list, because it looks
 * right. The model chooses `upcoming` or `past`; the clock does the rest.
 *
 * It reads and only reads. Booking, moving and cancelling stay on the portal's
 * own screens, which is ADR-0005's requirement that every agent-reachable
 * capability have a deterministic non-agent path, met by not making this one
 * agent-reachable at all.
 */

const MAX_ROWS = 20;

const inputSchema = z.strictObject({
  when: z.enum(['upcoming', 'past']),
});

const appointmentRowSchema = z.object({
  id: z.string(),
  /**
   * Nullable on the wire, because a held slot exists before anyone is booked
   * into it. A row with no chart on it is dropped rather than shown: the
   * boundary re-check cannot vouch for a row that names no chart, and an
   * unvouched row is not one to put in front of a patient.
   */
  patientId: z.string().nullable(),
  type: z.object({ display: z.string() }),
  status: z.string(),
  start: z.string(),
  durationMinutes: z.number(),
});

export function createVisitsList(now: () => number = Date.now) {
  return defineTool({
    id: 'visits.list',
    tier: 'READ',
    trustClass: 'reader',
    approval: 'never',
    requiredScopes: ['appointment.read'],
    surfaces: ['patient'],
    summary: 'Lists your own appointments, either the ones coming up or the ones already past.',
    activityLabel: 'Reading your appointments',
    maxResultRows: MAX_ROWS,
    compartmentBound: true,
    input: inputSchema,
    output: ownedRetrievalSchema,

    async execute(input, context) {
      assertChartBound(context, 'visits.list');

      const boundary = new Date(now()).toISOString();
      const window = input.when === 'upcoming' ? { from: boundary } : { to: boundary };

      const body = await context.api.call(
        {
          method: 'GET',
          path: '/bff/v0/appointments',
          query: {
            pageSize: MAX_ROWS,
            sort: 'start',
            order: input.when === 'upcoming' ? 'asc' : 'desc',
            ...window,
          },
        },
        context
      );

      const page = parseOwnedPage('visits.list', appointmentRowSchema, body);
      const rows = page.data
        .filter((row): row is typeof row & { patientId: string } => row.patientId !== null)
        .map((row): OwnedRecord => ({
          patientId: row.patientId,
          type: 'Appointment',
          id: row.id,
          label: row.type.display,
          fields: [
            /* Passed through exactly as stored, not formatted. The record
                 keeps an instant; turning one into a wall-clock time needs the
                 reader's timezone, and this code runs on a server that is
                 somewhere else. A wrong appointment time is a missed
                 appointment, so the portal formats it for the reader and every
                 row here links to the screen that does. */
            { name: 'Starts', value: row.start },
            { name: 'How long', value: `${String(row.durationMinutes)} minutes` },
            { name: 'Status', value: plainStatus(row.status) },
          ],
          source: { resourceType: 'Appointment', resourceId: row.id, field: 'start' },
        }));

      return ownedRetrieval('visits.list', input.when, page.total, rows, MAX_ROWS);
    },
  });
}

export const visitsList = createVisitsList();

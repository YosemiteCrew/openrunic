import { z } from 'zod';

import { ToolError } from '../errors.js';
import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { deferred, deferredResultSchema } from './shared.js';

/**
 * Tool 9. Emits a typed booking or reschedule proposal, inside a policy
 * envelope.
 *
 * Two properties matter more than the feature. The proposal is a **typed
 * object**, never a sentence: the confirmation surface re-reads the affected
 * rows and renders the resolved effect itself, so a model that emits
 * "cancel(id=X)" while writing "I'll reschedule your follow-up" cannot have the
 * sentence approved. And the patient comes from `principal.compartment`, set
 * from the chart the caller has open, never from an argument: the agent cannot
 * switch patients, because it has nowhere to name one.
 *
 * Outside the envelope the tool does not refuse and does not guess. It degrades
 * to a staff request, which is the deterministic path the product already has.
 */

export interface AppointmentEnvelope {
  allowedTypeCodes: readonly string[];
  minLeadTimeMinutes: number;
  maxDurationMinutes: number;
  /** Rescheduling an appointment on hold is a human act, never an agent one. */
  blockedStatuses: readonly string[];
}

/** The default envelope. A deployer narrows it; nothing widens it at runtime. */
export const DEFAULT_APPOINTMENT_ENVELOPE: AppointmentEnvelope = {
  allowedTypeCodes: ['FOLLOWUP', 'ROUTINE', 'ANNUAL', 'TELEHEALTH'],
  minLeadTimeMinutes: 60,
  maxDurationMinutes: 120,
  blockedStatuses: ['arrived', 'fulfilled', 'cancelled'],
};

export function createAppointmentsPropose(
  envelope: AppointmentEnvelope = DEFAULT_APPOINTMENT_ENVELOPE,
  now: () => number = Date.now
) {
  return defineTool({
    id: 'appointments.propose',
    tier: 'DRAFT',
    trustClass: 'writer',
    approval: 'always',
    requiredScopes: ['appointment.write'],
    surfaces: ['staff'],
    summary:
      'Proposes booking or rescheduling an appointment for the open chart. A person confirms it.',
    activityLabel: 'Preparing an appointment change',
    maxResultRows: 1,
    compartmentBound: true,
    input: z.discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('book'),
        facilityId: z.uuid(),
        providerId: z.uuid(),
        typeCode: z.string().min(1).max(32),
        /** The catalogue's own label for the type, carried inline as the API stores it. */
        typeDisplay: z.string().min(1).max(120),
        start: z.iso.datetime(),
        durationMinutes: z.int().min(5).max(480),
      }),
      z.strictObject({
        mode: z.literal('reschedule'),
        appointmentId: z.uuid(),
        currentStatus: z.string().min(1).max(32),
        start: z.iso.datetime(),
        durationMinutes: z.int().min(5).max(480),
      }),
    ]),
    output: z.union([proposalResultSchema, deferredResultSchema]),

    execute(input, context) {
      const patientId = context.principal.compartment.patientId;
      if (patientId === undefined) {
        throw new ToolError(
          'AGENT_SCOPE_DENIED',
          'appointments.propose needs an open chart. Open the patient first.',
          { toolId: 'appointments.propose' }
        );
      }

      const leadMinutes = (Date.parse(input.start) - now()) / 60_000;
      if (leadMinutes < envelope.minLeadTimeMinutes) {
        return Promise.resolve(
          deferred(
            `Inside the ${String(envelope.minLeadTimeMinutes)} minute lead time. Book this at the desk.`
          )
        );
      }
      if (input.durationMinutes > envelope.maxDurationMinutes) {
        return Promise.resolve(
          deferred(
            `Longer than the ${String(envelope.maxDurationMinutes)} minute maximum. Book this at the desk.`
          )
        );
      }

      if (input.mode === 'book') {
        if (!envelope.allowedTypeCodes.includes(input.typeCode)) {
          return Promise.resolve(
            deferred(
              `${input.typeCode} is not a type the assistant may book. Book this at the desk.`
            )
          );
        }

        return Promise.resolve(
          pending({
            kind: 'appointment.book',
            effect: [
              { label: 'Type', value: input.typeCode },
              { label: 'Starts', value: input.start },
              { label: 'Minutes', value: String(input.durationMinutes) },
            ],
            affects: [{ type: 'Patient', id: patientId }],
            commit: {
              method: 'POST',
              path: '/bff/v0/appointments',
              body: {
                facilityId: input.facilityId,
                providerId: input.providerId,
                patientId,
                typeCode: input.typeCode,
                typeDisplay: input.typeDisplay,
                start: input.start,
                end: endOf(input.start, input.durationMinutes),
                durationMinutes: input.durationMinutes,
                // The booking is made by the person who confirmed it, and the
                // record says so. That the assistant drafted it is recorded in
                // the audit chain's delegation field, which is where a fact
                // about how the work was done belongs - not in a field that
                // describes who booked.
                createdVia: 'STAFF',
              },
            },
            derivedFromUntrusted: false,
          })
        );
      }

      if (envelope.blockedStatuses.includes(input.currentStatus)) {
        return Promise.resolve(
          deferred(
            `An appointment that is ${input.currentStatus} is changed by a person, not here.`
          )
        );
      }

      return Promise.resolve(
        pending({
          kind: 'appointment.reschedule',
          effect: [
            { label: 'Appointment', value: input.appointmentId },
            { label: 'New start', value: input.start },
            { label: 'Minutes', value: String(input.durationMinutes) },
          ],
          affects: [{ type: 'Appointment', id: input.appointmentId }],
          commit: {
            method: 'PATCH',
            path: `/bff/v0/appointments/${input.appointmentId}`,
            body: {
              start: input.start,
              end: endOf(input.start, input.durationMinutes),
              durationMinutes: input.durationMinutes,
            },
          },
          derivedFromUntrusted: false,
        })
      );
    },
  });
}

export const appointmentsPropose = createAppointmentsPropose();

/**
 * The end instant the API stores alongside the start.
 *
 * Computed here rather than asked of the model: a start and a duration that
 * disagree with an end is a booking that looks right in one view and wrong in
 * another, and arithmetic is not something to delegate.
 */
function endOf(start: string, durationMinutes: number): string {
  return new Date(Date.parse(start) + durationMinutes * 60_000).toISOString();
}

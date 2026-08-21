import { TELEHEALTH_VISIT_STATUSES } from '@openrunic/database';
import { z } from 'zod';

import type { TelehealthVisitListQuery } from '../repositories/specs/core.js';
import type { ScopedRow } from '../repositories/rows.js';

import {
  paginationQueryFields,
  sortOrderField,
  windowOf,
  windowQueryFields,
} from './pagination.js';

export type TelehealthVisitRow = ScopedRow<'TelehealthVisit'>;

/**
 * The record that a room existed.
 *
 * There is no `token` field and there never will be. `joinUrl` is the address
 * of the room and is safe to carry, because bearing a token is what admits a
 * participant, not knowing where the door is.
 */
export const telehealthVisitDtoSchema = z.strictObject({
  id: z.uuid(),
  appointmentId: z.uuid(),
  /** Which vendor made this room. A room outlives a configuration change. */
  vendorId: z.string(),
  roomRef: z.string(),
  joinUrl: z.url(),
  status: z.enum(TELEHEALTH_VISIT_STATUSES),
  scheduledStart: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
  endedReason: z.string().nullable(),
  durationSeconds: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TelehealthVisitDto = z.infer<typeof telehealthVisitDtoSchema>;

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toTelehealthVisitDto(row: TelehealthVisitRow): TelehealthVisitDto {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    vendorId: row.vendorId,
    roomRef: row.roomRef,
    joinUrl: row.joinUrl,
    status: row.status,
    scheduledStart: row.scheduledStart.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: isoOrNull(row.endedAt),
    endedReason: row.endedReason,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Asking for one participant's way in.
 *
 * `participantId` is required and is not defaulted to the caller. A clinician
 * asks for the patient's token as often as for their own, and a default would
 * silently issue the wrong one: two people sharing a token is exactly what the
 * seam's per-participant design exists to prevent.
 */
export const telehealthJoinSchema = z.strictObject({
  participantId: z.uuid(),
  role: z.enum(['host', 'guest']),
  /**
   * How long the token lives. Short by default because a join token is a
   * credential, and long enough that a patient who opens the link, finds their
   * headphones and comes back does not need a new one.
   */
  ttlSeconds: z.int().positive().max(86_400).default(900),
});

export type TelehealthJoinBody = z.infer<typeof telehealthJoinSchema>;

/**
 * The token, returned exactly once.
 *
 * Separate from the visit DTO on purpose. The visit is read by anything that
 * lists appointments; this is the answer to one request that asked to be let
 * in, and keeping the two apart is what stops a token being added to the record
 * later "for convenience".
 */
export const joinTokenSchema = z.strictObject({
  visitId: z.uuid(),
  joinUrl: z.url(),
  role: z.enum(['host', 'guest']),
  /** Not stored anywhere. Ask again rather than keeping it. */
  token: z.string(),
  expiresAt: z.string(),
});

export type JoinTokenResponse = z.infer<typeof joinTokenSchema>;

export const telehealthEndSchema = z.strictObject({
  /** A coded reason, when the practice has one. Free text belongs in the note. */
  reasonCode: z.string().min(1).max(64).optional(),
});

export type TelehealthEndBody = z.infer<typeof telehealthEndSchema>;

export const telehealthListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  ...windowQueryFields,
  appointmentId: z.uuid().optional(),
  status: z.enum(TELEHEALTH_VISIT_STATUSES).optional(),
  sort: z.enum(['scheduledStart', 'createdAt']).default('scheduledStart'),
  order: sortOrderField,
});

export type TelehealthListQueryInput = z.infer<typeof telehealthListQuerySchema>;

export function toTelehealthListQuery(input: TelehealthListQueryInput): TelehealthVisitListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...windowOf(input),
    ...(input.appointmentId === undefined ? {} : { appointmentId: input.appointmentId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    sort: input.sort,
    order: input.order,
  };
}

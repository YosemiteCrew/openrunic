import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, opaqueRef } from './core.js';

/**
 * The telehealth seam: a room for one visit, and a short-lived token per person
 * who may enter it.
 *
 * Rooms are per-appointment and tokens are per-participant on purpose. A room
 * that outlives its visit is a waiting room anyone with an old link can walk
 * into, and a token that is not tied to one participant cannot be revoked when
 * a patient's appointment is moved to a different provider.
 */

/** Semver of this seam. */
export const VIDEO_CONTRACT_VERSION = '1.0.0';

/** Lifecycle of a visit room. */
export const visitRoomStatus = z.enum(['open', 'ended', 'expired']);

/** Inferred shape of {@link visitRoomStatus}. */
export type VisitRoomStatus = z.infer<typeof visitRoomStatus>;

/** Who a join token is for. A host may admit from the waiting room; a guest may not. */
export const participantRole = z.enum(['host', 'guest']);

/** Inferred shape of {@link participantRole}. */
export type ParticipantRole = z.infer<typeof participantRole>;

const createVisitRoomInput = z.strictObject({
  /** Our Appointment id, so a room can be found again without storing the vendor's id first. */
  appointmentRef: opaqueRef,
  scheduledStart: isoDateTime,
  expectedMinutes: z.int().positive().max(480),
  /** Requires the `waiting_room` feature; without it the guest joins directly. */
  waitingRoom: z.boolean(),
});

const visitRoom = z.strictObject({
  roomRef: opaqueRef,
  /** Entry point for participants. Bearing a token is what admits them, not knowing this address. */
  joinUrl: z.url(),
  status: visitRoomStatus,
  createdAt: isoDateTime,
  /** After this instant the room refuses every token, including ones already issued. */
  expiresAt: isoDateTime,
});

const issueJoinTokenInput = z.strictObject({
  roomRef: opaqueRef,
  /** The person the token is for; one token may never be shared between two participants. */
  participantRef: opaqueRef,
  role: participantRole,
  ttlSeconds: z.int().positive().max(86_400),
});

const joinToken = z.strictObject({
  roomRef: opaqueRef,
  token: z.string().min(1).max(2048),
  role: participantRole,
  expiresAt: isoDateTime,
});

const endVisitRoomInput = z.strictObject({
  roomRef: opaqueRef,
  reasonCode: z.string().min(1).max(64).optional(),
});

const endedVisitRoom = z.strictObject({
  roomRef: opaqueRef,
  status: visitRoomStatus,
  endedAt: isoDateTime,
  /** Wall-clock length of the room, which billing uses as one input to visit duration. */
  durationSeconds: z.int().nonnegative(),
});

/** Configuration for a telehealth adapter. */
export const videoConfig = z.strictObject({
  ...adapterConfigBase.shape,
  /** Vendor region the rooms are created in; a data-residency decision, so it is explicit. */
  region: z.string().min(1).max(32),
  maxParticipants: z.int().positive().max(50),
});

/** Inferred shape of {@link videoConfig}. */
export type VideoConfig = z.infer<typeof videoConfig>;

/** Optional features a telehealth vendor may implement. */
export const VIDEO_FEATURES = ['recording', 'waiting_room', 'dial_in'] as const;

/** Input of `createVisitRoom`. */
export type CreateVisitRoomInput = z.infer<typeof createVisitRoomInput>;
/** Output of `createVisitRoom`. */
export type VisitRoom = z.infer<typeof visitRoom>;
/** Input of `issueJoinToken`. */
export type IssueJoinTokenInput = z.infer<typeof issueJoinTokenInput>;
/** Output of `issueJoinToken`. */
export type JoinToken = z.infer<typeof joinToken>;
/** Input of `endVisitRoom`. */
export type EndVisitRoomInput = z.infer<typeof endVisitRoomInput>;
/** Output of `endVisitRoom`. */
export type EndedVisitRoom = z.infer<typeof endedVisitRoom>;

/** The telehealth seam as data. */
export const VIDEO_CONTRACT = {
  capability: 'video',
  contractVersion: VIDEO_CONTRACT_VERSION,
  config: videoConfig,
  features: VIDEO_FEATURES,
  operations: {
    createVisitRoom: { input: createVisitRoomInput, output: visitRoom },
    issueJoinToken: { input: issueJoinTokenInput, output: joinToken },
    endVisitRoom: { input: endVisitRoomInput, output: endedVisitRoom },
  },
} as const satisfies CapabilityContract;

/** Everything a telehealth vendor must implement. */
export interface VideoAdapter extends Adapter<VideoConfig> {
  createVisitRoom(input: CreateVisitRoomInput): Promise<AdapterResult<VisitRoom>>;
  issueJoinToken(input: IssueJoinTokenInput): Promise<AdapterResult<JoinToken>>;
  endVisitRoom(input: EndVisitRoomInput): Promise<AdapterResult<EndedVisitRoom>>;
}

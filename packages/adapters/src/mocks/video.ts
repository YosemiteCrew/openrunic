import { ok } from '@openrunic/types';

import type { AdapterResult } from '../contracts/core.js';
import { VIDEO_CONTRACT } from '../contracts/video.js';
import type {
  CreateVisitRoomInput,
  EndVisitRoomInput,
  EndedVisitRoom,
  IssueJoinTokenInput,
  JoinToken,
  VideoAdapter,
  VideoConfig,
  VisitRoom,
  VisitRoomStatus,
} from '../contracts/video.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';
import { randomHex } from './random.js';

/**
 * An in-process telehealth vendor.
 *
 * It exists mostly to make the lifecycle testable: a token issued for a room
 * that has ended must be refused, and a room may only be ended once. Those two
 * rules are what stop a finished visit from being rejoined, and they are
 * impossible to assert against a vendor sandbox that keeps rooms alive for
 * convenience.
 */

/** Grace period added to the expected visit length before a room expires. */
const ROOM_GRACE_MINUTES = 60;

/** Host for generated join links. `.invalid` can never resolve, so a leaked fixture link goes nowhere. */
const MOCK_ROOM_HOST = 'https://rooms.invalid';

interface RoomState {
  status: VisitRoomStatus;
  readonly createdAtMs: number;
}

/** The deterministic telehealth mock. */
export class MockVideoAdapter extends MockAdapterBase<VideoConfig> implements VideoAdapter {
  private readonly rooms = new Map<string, RoomState>();

  constructor(options: MockAdapterOptions = {}) {
    super(VIDEO_CONTRACT, options);
  }

  createVisitRoom(input: CreateVisitRoomInput): Promise<AdapterResult<VisitRoom>> {
    if (input.waitingRoom) {
      const gate = this.featureGate('createVisitRoom', 'waiting_room');
      if (gate !== undefined) {
        return Promise.resolve(gate);
      }
    }
    return this.runOperation<VisitRoom>('createVisitRoom', [input.appointmentRef], () => {
      const roomRef = this.mintRef('room');
      const createdAt = this.now();
      this.rooms.set(roomRef, { status: 'open', createdAtMs: createdAt.getTime() });
      const expiresAtMs =
        Date.parse(input.scheduledStart) + (input.expectedMinutes + ROOM_GRACE_MINUTES) * 60_000;
      return ok({
        roomRef,
        joinUrl: `${MOCK_ROOM_HOST}/${roomRef}`,
        status: 'open',
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
    });
  }

  issueJoinToken(input: IssueJoinTokenInput): Promise<AdapterResult<JoinToken>> {
    return this.runOperation<JoinToken>('issueJoinToken', [input.participantRef], () => {
      const room = this.rooms.get(input.roomRef);
      if (room === undefined) {
        return this.reject('issueJoinToken', 'unknown_room');
      }
      if (room.status !== 'open') {
        // Re-entry into a finished visit is the failure this seam exists to
        // prevent, so it is refused here rather than left to the caller.
        return this.reject('issueJoinToken', 'room_not_open');
      }
      return ok({
        roomRef: input.roomRef,
        token: `${input.role}.${randomHex(this.nextRandom, 24)}`,
        role: input.role,
        expiresAt: new Date(this.now().getTime() + input.ttlSeconds * 1000).toISOString(),
      });
    });
  }

  endVisitRoom(input: EndVisitRoomInput): Promise<AdapterResult<EndedVisitRoom>> {
    return this.runOperation<EndedVisitRoom>('endVisitRoom', [input.roomRef], () => {
      const room = this.rooms.get(input.roomRef);
      if (room === undefined) {
        return this.reject('endVisitRoom', 'unknown_room');
      }
      if (room.status === 'ended') {
        return this.reject('endVisitRoom', 'room_already_ended');
      }
      const endedAt = this.now();
      room.status = 'ended';
      return ok({
        roomRef: input.roomRef,
        status: 'ended',
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - room.createdAtMs) / 1000)),
      });
    });
  }
}

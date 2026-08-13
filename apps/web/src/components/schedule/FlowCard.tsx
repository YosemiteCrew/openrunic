'use client';

import { Badge, Button, Select, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Appointment, Patient } from '@/lib/api';
import { MOCK_ROOMS } from '@/lib/api';
import { formatElapsed, formatEnumLabel, formatMrn, formatName, formatTime } from '@/lib/format';

import { delayTier, givenName, minutesBetween, nextStatus, presentStatus } from './schedule';

/**
 * One patient moving through the day.
 *
 * OpenEMR's flow board was its best screen and its worst behaviour: the delay
 * alert blinked at you until you stopped seeing it. The semantics are kept
 * whole - statuses, rooms, two timers, one-click advance - and the blinking is
 * replaced by a static tier plus a counted, worded label. Nothing on this card
 * moves on its own.
 */

export interface FlowCardProps {
  appointment: Appointment;
  patient: Patient | undefined;
  /** When the visit entered its current status. */
  statusSince: string | null;
  /** The instant both timers are measured to. */
  now: Date;
  onAdvance: (appointment: Appointment) => void;
  onAssignRoom: (appointment: Appointment, room: string) => void;
  /** Room chosen in this session, which wins over the stored one. */
  room: string | null;
}

/** Wording per tier. The number is always in the label: a tint is never the message. */
const TIER_LABEL: Record<'caution' | 'delayed', string> = {
  caution: 'Waiting',
  delayed: 'Delayed',
};

export function FlowCard({
  appointment,
  patient,
  statusSince,
  now,
  onAdvance,
  onAssignRoom,
  room,
}: FlowCardProps): ReactElement {
  const status = presentStatus(appointment.status);
  const inStatus = minutesBetween(statusSince, now);
  const tier = delayTier(appointment.status, inStatus);
  const advance = nextStatus(appointment.status);
  const name = patient ? formatName(patient.name) : 'Unassigned visit';
  const currentRoom = room ?? appointment.room;

  return (
    <article className="or-flow-card" data-tier={tier} data-done={status.done || undefined}>
      <header className="or-flow-card__head">
        <h4 className="or-flow-card__name">{name}</h4>
        <span className="or-mono or-flow-card__time">{formatTime(appointment.start)}</span>
      </header>

      <p className="or-caption or-flow-card__meta">
        {patient ? <span className="or-mono">{formatMrn(patient.mrn)}</span> : null}
        {patient ? ' · ' : null}
        {appointment.type.display}
      </p>

      <div className="or-flow-card__chips">
        <Badge tone={status.tone}>{status.label}</Badge>
        {tier === 'none' ? null : (
          <Badge tone={tier === 'delayed' ? 'danger' : 'neutral'}>
            {`${TIER_LABEL[tier]} ${formatElapsed(statusSince, now)}`}
          </Badge>
        )}
        {currentRoom ? <Tag>{currentRoom}</Tag> : <Tag>No room</Tag>}
      </div>

      <dl className="or-flow-card__timers">
        <div>
          <dt className="or-caption">In this status</dt>
          <dd className="or-mono">{formatElapsed(statusSince, now)}</dd>
        </div>
        <div>
          <dt className="or-caption">In the building</dt>
          <dd className="or-mono">{formatElapsed(appointment.checkedInAt, now)}</dd>
        </div>
      </dl>

      <div className="or-flow-card__actions">
        <Select
          aria-label={`Room for ${name}`}
          value={currentRoom ?? ''}
          onChange={(event) => onAssignRoom(appointment, event.target.value)}
          options={[
            { value: '', label: 'Assign a room' },
            ...MOCK_ROOMS.map((option) => ({ value: option, label: option })),
          ]}
        />
        {advance ? (
          <Button
            size="sm"
            iconLeft="arrow-right"
            onClick={() => onAdvance(appointment)}
            aria-label={`Move ${patient ? givenName(patient.name) : 'this visit'} to ${formatEnumLabel(
              advance
            ).toLowerCase()}`}
          >
            {formatEnumLabel(advance)}
          </Button>
        ) : (
          <span className="or-caption or-flow-card__done">Visit complete</span>
        )}
      </div>
    </article>
  );
}

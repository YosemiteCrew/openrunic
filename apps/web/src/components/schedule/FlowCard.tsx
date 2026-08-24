'use client';

import { Badge, Button, Select, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Appointment, Patient } from '@/lib/api';
import { MOCK_ROOMS } from '@/lib/api';
import { formatElapsed, formatMrn, formatName, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import {
  delayTier,
  givenName,
  minutesBetween,
  nextStatus,
  presentStatus,
  STATUS_INLINE_KEY,
  STATUS_LABEL_KEY,
} from './schedule';

/**
 * One patient moving through the day.
 *
 * The legacy flow board was a good screen with bad behaviour: the delay
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

/**
 * Wording per tier. The number is always in the label: a tint is never the
 * message, and the count is inside the message rather than glued to the front
 * of it, because a language that puts the duration first cannot move a word the
 * code concatenated.
 */
const TIER_KEY: Record<'caution' | 'delayed', { labelKey: string }> = {
  caution: { labelKey: 'schedule.flowCard.waiting' },
  delayed: { labelKey: 'schedule.flowCard.delayed' },
};

export function FlowCard({
  appointment,
  patient,
  statusSince,
  now,
  onAdvance,
  onAssignRoom,
  room,
}: Readonly<FlowCardProps>): ReactElement {
  const t = useTranslator();
  const status = presentStatus(appointment.status);
  const inStatus = minutesBetween(statusSince, now);
  const tier = delayTier(appointment.status, inStatus);
  const advance = nextStatus(appointment.status);
  const name = patient ? formatName(patient.name) : t('schedule.flowCard.unassignedVisit');
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
        <Badge tone={status.tone}>{t(status.labelKey)}</Badge>
        {tier === 'none' ? null : (
          <Badge tone={tier === 'delayed' ? 'danger' : 'neutral'}>
            {t(TIER_KEY[tier].labelKey, { elapsed: formatElapsed(t, statusSince, now) })}
          </Badge>
        )}
        {currentRoom ? <Tag>{currentRoom}</Tag> : <Tag>{t('schedule.flowCard.noRoom')}</Tag>}
      </div>

      <dl className="or-flow-card__timers">
        <div>
          <dt className="or-caption">{t('schedule.flowCard.inThisStatus')}</dt>
          <dd className="or-mono">{formatElapsed(t, statusSince, now)}</dd>
        </div>
        <div>
          <dt className="or-caption">{t('schedule.flowCard.inTheBuilding')}</dt>
          <dd className="or-mono">{formatElapsed(t, appointment.checkedInAt, now)}</dd>
        </div>
      </dl>

      <div className="or-flow-card__actions">
        <Select
          aria-label={t('schedule.flowCard.roomFor', { name })}
          value={currentRoom ?? ''}
          onChange={(event) => onAssignRoom(appointment, event.target.value)}
          options={[
            { value: '', label: t('schedule.flowCard.assignRoom') },
            ...MOCK_ROOMS.map((option) => ({ value: option, label: option })),
          ]}
        />
        {advance ? (
          <Button
            size="sm"
            iconLeft="arrow-right"
            onClick={() => onAdvance(appointment)}
            aria-label={
              patient
                ? t('schedule.flowCard.advance', {
                    name: givenName(patient.name),
                    status: t(STATUS_INLINE_KEY[advance]),
                  })
                : t('schedule.flowCard.advanceUnassigned', {
                    status: t(STATUS_INLINE_KEY[advance]),
                  })
            }
          >
            {t(STATUS_LABEL_KEY[advance])}
          </Button>
        ) : (
          <span className="or-caption or-flow-card__done">{t('schedule.flowCard.complete')}</span>
        )}
      </div>
    </article>
  );
}

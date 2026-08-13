'use client';

import { Badge, Button, Icon, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { mockPatientById } from '@/lib/api';
import type { InboxItem } from '@/lib/api';
import { formatDateTime, formatMrn, formatName } from '@/lib/format';

import { INBOX_STREAM_ICON, INBOX_STREAM_LABELS } from './streams';
import { SlaBadge } from './SlaBadge';

/**
 * One row per work item, and the common action finishes in the row.
 *
 * That is the rule the whole screen is built on: a refill is approved, a cosign
 * is signed and a task is closed without navigating anywhere. Unread rows carry
 * weight rather than a dot alone, the patient header is one line, and the
 * assignment is a word, not an avatar to decode.
 */

export interface InboxListProps {
  items: InboxItem[];
  now: string;
  /** Runs the row's primary action: approve, cosign, reply, close. */
  onComplete: (item: InboxItem) => void;
  /** Moves a team-pool item to the signed-in clinician. */
  onClaim: (item: InboxItem) => void;
  /** Ids already claimed in this session, so the row stops offering it. */
  claimedIds: string[];
}

export function InboxList({
  items,
  now,
  onComplete,
  onClaim,
  claimedIds,
}: Readonly<InboxListProps>): ReactElement {
  const claimed = new Set(claimedIds);

  return (
    <ul className="or-inbox__list" aria-label="Inbox items">
      {items.map((item) => {
        const patient = mockPatientById(item.patientId);
        const mine = item.assignedTo === 'ME' || claimed.has(item.id);
        return (
          <li
            key={item.id}
            className="or-inbox__row"
            data-unread={item.unread ? 'true' : undefined}
          >
            <span className="or-inbox__stream">
              <Icon name={INBOX_STREAM_ICON[item.stream]} size={18} />
              <span className="or-caption">{INBOX_STREAM_LABELS[item.stream]}</span>
            </span>

            <span className="or-inbox__body">
              <span className="or-inbox__patient or-small">
                {patient ? (
                  <>
                    <strong>{formatName(patient.name, 'listing')}</strong>{' '}
                    <span className="or-mono or-muted">{formatMrn(patient.mrn)}</span>
                  </>
                ) : (
                  <strong>Practice-wide</strong>
                )}
              </span>
              <span className="or-inbox__summary">{item.summary}</span>
              <span className="or-small or-muted">{item.detail}</span>
              <span className="or-caption or-muted">
                Received {formatDateTime(item.receivedAt, 'dense')}
              </span>
            </span>

            <span className="or-inbox__state">
              <SlaBadge dueAt={item.dueAt} now={now} />
              {item.unread ? <Badge tone="neutral">Unread</Badge> : null}
              <Tag>{mine ? 'Mine' : 'Team pool'}</Tag>
            </span>

            <span className="or-inbox__actions">
              <Button variant="secondary" size="sm" onClick={() => onComplete(item)}>
                {item.actionLabel}
              </Button>
              {mine ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft="user-round"
                  onClick={() => onClaim(item)}
                >
                  Assign to me
                </Button>
              )}
              {item.href ? (
                <Button variant="ghost" size="sm" href={item.href} iconRight="arrow-right">
                  Open
                </Button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

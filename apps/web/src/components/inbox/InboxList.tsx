'use client';

import { Badge, Button, Icon, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { mockPatientById } from '@/lib/api';
import type { InboxItem } from '@/lib/api';
import { formatDateTime, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { INBOX_STREAM_ICON, INBOX_STREAM_LABEL_KEYS } from './streams';
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
  const t = useTranslator();
  const claimed = new Set(claimedIds);

  return (
    <ul className="or-inbox__list" aria-label={t('inbox.list.label')}>
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
              <span className="or-caption">{t(INBOX_STREAM_LABEL_KEYS[item.stream])}</span>
            </span>

            <span className="or-inbox__body">
              <span className="or-inbox__patient or-small">
                {patient ? (
                  <>
                    <strong>{formatName(patient.name, 'listing')}</strong>{' '}
                    <span className="or-mono or-muted">{formatMrn(patient.mrn)}</span>
                  </>
                ) : (
                  <strong>{t('inbox.list.practiceWide')}</strong>
                )}
              </span>
              <span className="or-inbox__summary">{item.summary}</span>
              <span className="or-small or-muted">{item.detail}</span>
              <span className="or-caption or-muted">
                {t('inbox.list.received', { when: formatDateTime(item.receivedAt, 'dense') })}
              </span>
            </span>

            <span className="or-inbox__state">
              <SlaBadge dueAt={item.dueAt} now={now} />
              {item.unread ? <Badge tone="neutral">{t('inbox.list.unread')}</Badge> : null}
              <Tag>{mine ? t('inbox.filter.mine') : t('inbox.filter.teamPool')}</Tag>
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
                  {t('inbox.list.assignToMe')}
                </Button>
              )}
              {item.href ? (
                <Button variant="ghost" size="sm" href={item.href} iconRight="arrow-right">
                  {t('inbox.list.open')}
                </Button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

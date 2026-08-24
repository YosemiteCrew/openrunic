'use client';

import { Badge, Button, Card, Checkbox } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { formatAge, formatDate, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import type { DuplicateMatch } from './registration';

/**
 * The duplicate panel: candidates side by side, and an override that has to be
 * said out loud.
 *
 * Legacy registration checked for duplicates and then let you save anyway, so
 * practices accumulated two records per person. Here a strong match blocks the
 * save, shows what matched and why, and offers the two things that are actually
 * useful: open the record that already exists, or state that this is a
 * different person.
 */

export interface DuplicatePanelProps {
  matches: readonly DuplicateMatch[];
  /** True when a match is strong enough to block saving. */
  blocking: boolean;
  overridden: boolean;
  onOverrideChange: (overridden: boolean) => void;
  /** The instant ages are computed against. */
  asOf: Date;
}

export function DuplicatePanel({
  matches,
  blocking,
  overridden,
  onOverrideChange,
  asOf,
}: Readonly<DuplicatePanelProps>): ReactElement {
  const t = useTranslator();

  return (
    <Card
      overline={t('patients.duplicate.overline')}
      title={
        blocking ? t('patients.duplicate.blockingTitle') : t('patients.duplicate.similarTitle')
      }
      className="or-duplicates"
    >
      {/* A blocking match interrupts a save in progress, so it is announced. */}
      <p className="or-body" role={blocking ? 'alert' : undefined}>
        {blocking ? t('patients.duplicate.blockingBody') : t('patients.duplicate.similarBody')}
      </p>

      <ul className="or-duplicates__list">
        {matches.map((match) => (
          <li key={match.patient.id} className="or-duplicates__item">
            <div className="or-duplicates__identity">
              <p className="or-body-lg">{formatName(match.patient.name, 'listing')}</p>
              <p className="or-small">
                <span className="or-mono">{formatMrn(match.patient.mrn)}</span>
                {' · '}
                {formatDate(match.patient.birthDate)}
                {' · '}
                {formatAge(match.patient.birthDate, asOf)}
              </p>
              <div className="or-duplicates__reasons">
                {match.reasonKeys.map((reasonKey) => (
                  <Badge key={reasonKey} tone="neutral">
                    {t(reasonKey)}
                  </Badge>
                ))}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              iconLeft="folder-open"
              href={`/patients/${match.patient.id}`}
              aria-label={t('patients.duplicate.openFor', {
                name: formatName(match.patient.name),
              })}
            >
              {t('patients.duplicate.open')}
            </Button>
          </li>
        ))}
      </ul>

      {blocking ? (
        <Checkbox
          label={t('patients.duplicate.overrideLabel')}
          hint={t('patients.duplicate.overrideHint')}
          checked={overridden}
          onChange={(event) => onOverrideChange(event.target.checked)}
        />
      ) : null}
    </Card>
  );
}

'use client';
import { formatCount } from '@openrunic/i18n';

import { Badge, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { counted } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

import type { ScrubFinding } from './billing';

/**
 * What is standing between this visit and a claim.
 *
 * Every finding is named, tied to the line it is about, and says what to
 * change. Blocking findings are listed first because they are the ones that
 * stop the work, and the count is stated in words above the list rather than
 * implied by a colour. When there is nothing to fix the panel says so: an empty
 * scrub panel is a result, not an absence.
 *
 * A finding arrives carrying a catalogue key and its values, or - for the prior
 * authorisation warning, which is the payer's own sentence - the text itself.
 * Both render here; only the first is translated, because rewording a payer in
 * the interface would give the practice a second version of something it will
 * be quoted back on.
 */

/**
 * How many blocking findings the sheet still has.
 *
 * Through `counted` rather than `blocking.length === 1`, because one is not the
 * only special case in every language: a fork translating into a language with
 * four plural forms would get a sentence that reads as broken only to somebody
 * who speaks it.
 */
const BLOCKING: CountedMessage = {
  oneKey: 'billing.scrub.blocking.one',
  otherKey: 'billing.scrub.blocking.other',
};

export interface ScrubPanelProps {
  findings: readonly ScrubFinding[];
}

export function ScrubPanel({ findings }: Readonly<ScrubPanelProps>): ReactElement {
  const t = useTranslator();
  const blocking = findings.filter((finding) => finding.severity === 'BLOCKING');
  const advisory = findings.filter((finding) => finding.severity === 'ADVISORY');
  const ordered = [...blocking, ...advisory];

  return (
    <Card overline={t('billing.scrub.overline')} title={t('billing.scrub.title')}>
      {/* Polite: the biller is editing the sheet, and each keystroke changing
          the count must not interrupt them mid-line. */}
      <output className="or-small or-billing__hint">
        {blocking.length === 0 ? t('billing.scrub.clear') : counted(t, BLOCKING, blocking.length)}
        {advisory.length > 0
          ? ` ${t('billing.scrub.advisory', { count: formatCount(advisory.length, t.locale) })}`
          : ''}
      </output>

      {ordered.length === 0 ? null : (
        <ul className="or-scrub-list">
          {ordered.map((finding) => (
            <li key={finding.id} className="or-scrub-list__item">
              <Badge tone={finding.severity === 'BLOCKING' ? 'danger' : 'neutral'}>
                {finding.severity === 'BLOCKING'
                  ? t('billing.scrub.severity.blocking')
                  : t('billing.scrub.severity.advisory')}
              </Badge>
              <span className="or-small">
                {finding.messageKey === null
                  ? finding.message
                  : t(finding.messageKey, finding.messageValues)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

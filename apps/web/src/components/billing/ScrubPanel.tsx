'use client';

import { Badge, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import { formatCount } from '@/lib/format';

import type { ScrubFinding } from './billing';

/**
 * What is standing between this visit and a claim.
 *
 * Every finding is named, tied to the line it is about, and says what to
 * change. Blocking findings are listed first because they are the ones that
 * stop the work, and the count is stated in words above the list rather than
 * implied by a colour. When there is nothing to fix the panel says so: an empty
 * scrub panel is a result, not an absence.
 */

export interface ScrubPanelProps {
  findings: readonly ScrubFinding[];
}

export function ScrubPanel({ findings }: Readonly<ScrubPanelProps>): ReactElement {
  const blocking = findings.filter((finding) => finding.severity === 'BLOCKING');
  const advisory = findings.filter((finding) => finding.severity === 'ADVISORY');
  const ordered = [...blocking, ...advisory];

  return (
    <Card overline="Scrub" title="Before billing">
      {/* Polite: the biller is editing the sheet, and each keystroke changing
          the count must not interrupt them mid-line. */}
      <output className="or-small or-billing__hint">
        {blocking.length === 0
          ? 'Nothing blocks this visit from billing.'
          : `${formatCount(blocking.length, 'error blocks', 'errors block')} billing.`}
        {advisory.length > 0 ? ` ${advisory.length} to review.` : ''}
      </output>

      {ordered.length === 0 ? null : (
        <ul className="or-scrub-list">
          {ordered.map((finding) => (
            <li key={finding.id} className="or-scrub-list__item">
              <Badge tone={finding.severity === 'BLOCKING' ? 'danger' : 'neutral'}>
                {finding.severity === 'BLOCKING' ? 'Blocks billing' : 'Review'}
              </Badge>
              <span className="or-small">{finding.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

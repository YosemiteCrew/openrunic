'use client';

import { Badge, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { ChargeDiagnosis, ChargeLine } from '@/lib/api';
import { formatCount } from '@/lib/format';

import { diagnosisPointer } from './billing';

/**
 * The visit's diagnoses, as justify sources.
 *
 * Each one carries its pointer letter and a live count of the charge lines
 * pointing at it, so the link between a diagnosis and the money it justifies is
 * readable in both directions: from the line to the diagnosis on the table, and
 * from the diagnosis back to the lines here. A diagnosis nothing points at says
 * so plainly rather than looking the same as one that is doing work.
 */

export interface DiagnosisPanelProps {
  diagnoses: readonly ChargeDiagnosis[];
  lines: readonly ChargeLine[];
}

export function DiagnosisPanel({ diagnoses, lines }: Readonly<DiagnosisPanelProps>): ReactElement {
  const active = lines.filter((line) => !line.deleted);

  return (
    <Card overline="Visit diagnoses" title="Justify sources">
      <p className="or-small or-billing__hint">
        Link a diagnosis to a charge with its letter on the line. A charge with no diagnosis cannot
        be billed.
      </p>
      <ul className="or-dx-list">
        {diagnoses.map((diagnosis, index) => {
          const pointer = diagnosisPointer(index);
          const uses = active.filter((line) => line.justifiedBy.includes(diagnosis.code)).length;
          return (
            <li key={diagnosis.code} className="or-dx-list__item">
              <span className="or-dx-list__pointer or-mono" aria-hidden="true">
                {pointer}
              </span>
              <span className="or-dx-list__body">
                <span className="or-dx-list__code or-mono">{diagnosis.code}</span>
                <span className="or-dx-list__display">{diagnosis.display}</span>
              </span>
              {uses === 0 ? (
                <Badge tone="neutral" icon="minus">
                  Not linked
                </Badge>
              ) : (
                <Badge tone="success">{formatCount(uses, 'charge')}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

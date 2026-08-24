'use client';

import { Badge, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { ChargeDiagnosis, ChargeLine } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

import { diagnosisPointer } from './billing';

/**
 * The visit's diagnoses, as justify sources.
 *
 * Each one carries its pointer letter and a live count of the charge lines
 * pointing at it, so the link between a diagnosis and the money it justifies is
 * readable in both directions: from the line to the diagnosis on the table, and
 * from the diagnosis back to the lines here. A diagnosis nothing points at says
 * so plainly rather than looking the same as one that is doing work.
 *
 * The code and its display are the terminology's own words and render as they
 * arrived. Only the panel's own copy is translated.
 */

export interface DiagnosisPanelProps {
  diagnoses: readonly ChargeDiagnosis[];
  lines: readonly ChargeLine[];
}

export function DiagnosisPanel({ diagnoses, lines }: Readonly<DiagnosisPanelProps>): ReactElement {
  const t = useTranslator();
  const active = lines.filter((line) => !line.deleted);

  return (
    <Card overline={t('billing.diagnoses.overline')} title={t('billing.diagnoses.title')}>
      <p className="or-small or-billing__hint">{t('billing.diagnoses.hint')}</p>
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
                  {t('billing.diagnoses.notLinked')}
                </Badge>
              ) : (
                <Badge tone="success">
                  {t(
                    uses === 1
                      ? 'billing.diagnoses.chargeCount.one'
                      : 'billing.diagnoses.chargeCount.other',
                    { count: uses }
                  )}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

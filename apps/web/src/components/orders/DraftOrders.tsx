'use client';

import { Badge, Button, Card, Select, Tag } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import type { ChangeEvent, ReactElement } from 'react';

import type { OrderCatalogEntry, OrderPriority, PatientProblem } from '@/lib/api';
import { ORDER_PRIORITIES } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

import { ORDER_CATEGORY_LABELS, ORDER_PRIORITY_LABELS } from './labels';
import { SPECIMEN_OPTIONS } from './specimens';

/**
 * The drafted orders, each with the four fields an order actually needs.
 *
 * Everything predictable is pre-filled from the catalogue: specimen,
 * destination, routine priority, and the diagnosis when the patient has exactly
 * one problem the order is commonly placed for. Nothing here is required that
 * the workflow does not require, and the one thing that is (a diagnosis to
 * justify the order) says so in words rather than by refusing to submit.
 */

export interface DraftOrder {
  /** Unique per draft row: the same test can be drafted twice deliberately. */
  key: string;
  entry: OrderCatalogEntry;
  priority: OrderPriority;
  specimen: string | null;
  diagnosisCode: string | null;
}

/** The one field the workflow does require: a coded reason, for the claim later. */
const NO_DIAGNOSIS = '';

export interface DraftOrdersProps {
  drafts: DraftOrder[];
  problems: PatientProblem[];
  onChange: (key: string, patch: Partial<Omit<DraftOrder, 'key' | 'entry'>>) => void;
  onRemove: (key: string) => void;
}

export function DraftOrders({
  drafts,
  problems,
  onChange,
  onRemove,
}: Readonly<DraftOrdersProps>): ReactElement {
  const t = useTranslator();

  const priorityOptions: SelectOption[] = ORDER_PRIORITIES.map((priority) => ({
    value: priority,
    label: t(ORDER_PRIORITY_LABELS[priority].labelKey),
  }));

  /* The problem's own display and ICD-10 code, exactly as the problem list
     holds them. A translated label on a coded diagnosis would be a second name
     for a code that already has one. */
  const diagnosisOptions: SelectOption[] = [
    { value: NO_DIAGNOSIS, label: t('orders.draft.notLinked') },
    ...problems.map((problem) => ({
      value: problem.code,
      label: `${problem.display} (${problem.code})`,
    })),
  ];

  return (
    <ol className="or-drafts" aria-label={t('orders.draft.listLabel')}>
      {drafts.map((draft) => (
        <li key={draft.key}>
          <Card
            tone="cream"
            className="or-draft"
            title={
              <span className="or-draft__title">
                <span>{draft.entry.name}</span>
                <span className="or-mono or-draft__code">{draft.entry.code}</span>
              </span>
            }
          >
            <div className="or-cluster or-draft__meta">
              <Tag>{t(ORDER_CATEGORY_LABELS[draft.entry.category].labelKey)}</Tag>
              <Tag>{draft.entry.destination}</Tag>
              <Tag>{draft.entry.turnaround}</Tag>
              {draft.diagnosisCode ? null : (
                <Badge tone="neutral" icon="circle-alert">
                  {t('orders.draft.needsDiagnosis')}
                </Badge>
              )}
            </div>

            <div className="or-draft__fields">
              <Select
                label={t('orders.draft.priority')}
                options={priorityOptions}
                value={draft.priority}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange(draft.key, { priority: event.target.value as OrderPriority })
                }
              />

              {draft.entry.category === 'LAB' ? (
                <Select
                  label={t('orders.draft.specimen')}
                  options={[...SPECIMEN_OPTIONS]}
                  value={draft.specimen ?? SPECIMEN_OPTIONS[0]}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    onChange(draft.key, { specimen: event.target.value })
                  }
                />
              ) : (
                <p className="or-small or-draft__note">
                  {t('orders.draft.noSpecimen', {
                    /* Lower-cased with the reader's own rules rather than the
                       runtime default: a Turkish "I" does not lower-case to
                       "i", and the word is a translated one. */
                    category: t(
                      ORDER_CATEGORY_LABELS[draft.entry.category].labelKey
                    ).toLocaleLowerCase(t.locale),
                  })}
                </p>
              )}

              <Select
                label={t('orders.draft.diagnosis')}
                hint={t('orders.draft.diagnosisHint')}
                options={diagnosisOptions}
                value={draft.diagnosisCode ?? NO_DIAGNOSIS}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange(draft.key, {
                    diagnosisCode: event.target.value === NO_DIAGNOSIS ? null : event.target.value,
                  })
                }
              />
            </div>

            <div className="or-cluster">
              <Button
                variant="ghost"
                size="sm"
                iconLeft="trash-2"
                onClick={() => onRemove(draft.key)}
              >
                {t('orders.draft.remove', { order: draft.entry.name })}
              </Button>
            </div>
          </Card>
        </li>
      ))}
    </ol>
  );
}

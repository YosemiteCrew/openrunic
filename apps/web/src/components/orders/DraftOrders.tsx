'use client';

import { Badge, Button, Card, Select, Tag } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import type { ChangeEvent, ReactElement } from 'react';

import type { OrderCatalogEntry, OrderPriority, PatientProblem } from '@/lib/api';
import { ORDER_PRIORITIES } from '@/lib/api';
import { formatEnumLabel } from '@/lib/format';

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

const PRIORITY_OPTIONS: SelectOption[] = ORDER_PRIORITIES.map((priority) => ({
  value: priority,
  label: formatEnumLabel(priority),
}));

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
  const diagnosisOptions: SelectOption[] = [
    { value: NO_DIAGNOSIS, label: 'Not linked yet' },
    ...problems.map((problem) => ({
      value: problem.code,
      label: `${problem.display} (${problem.code})`,
    })),
  ];

  return (
    <ol className="or-drafts" aria-label="Drafted orders">
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
              <Tag>{formatEnumLabel(draft.entry.category)}</Tag>
              <Tag>{draft.entry.destination}</Tag>
              <Tag>{draft.entry.turnaround}</Tag>
              {draft.diagnosisCode ? null : (
                <Badge tone="neutral" icon="circle-alert">
                  Needs a diagnosis
                </Badge>
              )}
            </div>

            <div className="or-draft__fields">
              <Select
                label="Priority"
                options={PRIORITY_OPTIONS}
                value={draft.priority}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange(draft.key, { priority: event.target.value as OrderPriority })
                }
              />

              {draft.entry.category === 'LAB' ? (
                <Select
                  label="Specimen"
                  options={[...SPECIMEN_OPTIONS]}
                  value={draft.specimen ?? SPECIMEN_OPTIONS[0]}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    onChange(draft.key, { specimen: event.target.value })
                  }
                />
              ) : (
                <p className="or-small or-draft__note">
                  No specimen is collected for {formatEnumLabel(draft.entry.category).toLowerCase()}
                  .
                </p>
              )}

              <Select
                label="Diagnosis this order justifies"
                hint="From the active problem list. Required before signing."
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
                {`Remove ${draft.entry.name}`}
              </Button>
            </div>
          </Card>
        </li>
      ))}
    </ol>
  );
}

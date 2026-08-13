'use client';

import { Badge, Button, IconButton, Select, Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { ChargeDiagnosis, ChargeLine } from '@/lib/api';

import { diagnosisPointer, lineCharge } from './billing';
import { Money } from './Money';

/**
 * The charge lines, and the justify control that is the point of the screen.
 *
 * Each line's diagnoses are toggles carrying the pointer letters from the
 * diagnosis panel, so the link between a CPT line and the ICD-10 code paying
 * for it is visible on the row itself rather than in a popup. A line with
 * nothing linked says "Not justified" in words. Nothing here is hover-only and
 * nothing is hidden behind an unlabelled icon: the OpenEMR fee sheet's two
 * worst habits were undiscoverable capability and un-deletable mistakes, so
 * every capability is a labelled control and every deletion is reversible.
 *
 * The toggle chip is composed here from a plain button: @openrunic/ui has no
 * toggle primitive today, and it is raised as a proposed addition rather than
 * forked out of Button.
 */

/** Modifiers a family practice reaches for. One per line keeps the row readable. */
const MODIFIERS = [
  { value: '', label: 'None' },
  { value: '25', label: '25 significant, separate service' },
  { value: '59', label: '59 distinct procedure' },
  { value: '76', label: '76 repeat by same provider' },
  { value: '95', label: '95 telehealth' },
];

const COLUMNS: TableColumn[] = [
  { key: 'code', header: 'Code', mono: true },
  { key: 'description', header: 'Description' },
  { key: 'modifier', header: 'Modifier' },
  { key: 'units', header: 'Units', numeric: true },
  { key: 'fee', header: 'Fee', numeric: true },
  { key: 'justify', header: 'Justified by' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

export interface ChargeLinesProps {
  lines: readonly ChargeLine[];
  diagnoses: readonly ChargeDiagnosis[];
  currency: string;
  /** Locked sheets render read-only: a billed visit is not edited in place. */
  readOnly?: boolean;
  onToggleJustify: (lineId: string, diagnosisCode: string) => void;
  onModifierChange: (lineId: string, modifier: string) => void;
  onUnitsChange: (lineId: string, units: number) => void;
  onDelete: (lineId: string) => void;
  onRestore: (lineId: string) => void;
}

export function ChargeLines({
  lines,
  diagnoses,
  currency,
  readOnly = false,
  onToggleJustify,
  onModifierChange,
  onUnitsChange,
  onDelete,
  onRestore,
}: ChargeLinesProps): ReactElement {
  const rows = lines.map((line): Record<string, ReactNode> => {
    const modifier = line.modifiers[0] ?? '';

    const justify: ReactNode = line.deleted ? (
      <span className="or-small">Removed</span>
    ) : (
      <div className="or-justify">
        <div className="or-justify__chips">
          {diagnoses.map((diagnosis, index) => {
            const linked = line.justifiedBy.includes(diagnosis.code);
            return (
              <button
                key={diagnosis.code}
                type="button"
                className="or-justify-chip"
                aria-pressed={linked}
                disabled={readOnly}
                aria-label={`${linked ? 'Unlink' : 'Link'} ${diagnosis.code} ${diagnosis.display} ${
                  linked ? 'from' : 'to'
                } ${line.code}`}
                onClick={() => onToggleJustify(line.id, diagnosis.code)}
              >
                <span className="or-mono">{diagnosisPointer(index)}</span>
              </button>
            );
          })}
        </div>
        {line.justifiedBy.length === 0 ? (
          <Badge tone="danger">Not justified</Badge>
        ) : (
          <span className="or-small or-justify__summary">{line.justifiedBy.join(', ')}</span>
        )}
      </div>
    );

    return {
      id: line.id,
      code: (
        <span className={line.deleted ? 'or-charge-line--deleted' : undefined}>{line.code}</span>
      ),
      description: (
        <span className={line.deleted ? 'or-charge-line--deleted' : undefined}>{line.display}</span>
      ),
      modifier: line.deleted ? (
        <span className="or-small">{modifier || 'None'}</span>
      ) : (
        <Select
          className="or-charge-line__field"
          options={MODIFIERS}
          value={modifier}
          disabled={readOnly}
          aria-label={`Modifier for ${line.code}`}
          onChange={(event) => onModifierChange(line.id, event.target.value)}
        />
      ),
      units: line.deleted ? (
        <span className="or-mono">{line.units}</span>
      ) : (
        <input
          type="number"
          className="or-units-field or-mono"
          value={line.units}
          disabled={readOnly}
          aria-label={`Units for ${line.code}`}
          onChange={(event) => onUnitsChange(line.id, Number(event.target.value))}
        />
      ),
      fee: <Money amount={lineCharge(line)} currency={currency} />,
      justify,
      actions: line.deleted ? (
        <Button
          variant="ghost"
          size="sm"
          iconLeft="rotate-ccw"
          disabled={readOnly}
          onClick={() => onRestore(line.id)}
          aria-label={`Restore ${line.code}`}
        >
          Restore
        </Button>
      ) : (
        <IconButton
          icon="trash-2"
          label={`Remove ${line.code}`}
          size="sm"
          disabled={readOnly}
          onClick={() => onDelete(line.id)}
        />
      ),
    };
  });

  return <Table caption="Charge lines" columns={COLUMNS} rows={rows} />;
}

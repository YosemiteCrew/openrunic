'use client';

import { Badge, Button, IconButton, Select, Table } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { ChargeDiagnosis, ChargeLine } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';
import { numericFieldValue } from '@/lib/numeric-field';

import { diagnosisPointer, lineCharge } from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Money } from './Money';

/**
 * The charge lines, and the justify control that is the point of the screen.
 *
 * Each line's diagnoses are toggles carrying the pointer letters from the
 * diagnosis panel, so the link between a CPT line and the ICD-10 code paying
 * for it is visible on the row itself rather than in a popup. A line with
 * nothing linked says "Not justified" in words. Nothing here is hover-only and
 * nothing is hidden behind an unlabelled icon: the legacy fee sheet's two
 * worst habits were undiscoverable capability and un-deletable mistakes, so
 * every capability is a labelled control and every deletion is reversible.
 *
 * The toggle chip is composed here from a plain button: @openrunic/ui has no
 * toggle primitive today, and it is raised as a proposed addition rather than
 * forked out of Button.
 */

/**
 * Modifiers a family practice reaches for. One per line keeps the row readable.
 *
 * The descriptions are the CPT modifiers' own, shortened. They are deliberately
 * not in the catalogue: a modifier is a coded value, and a translated label
 * would give it a second name that the payer would not recognise on the claim.
 * "None" is this screen's word for the absence of one, so it is translated.
 */
const MODIFIERS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '25', label: '25 significant, separate service' },
  { value: '59', label: '59 distinct procedure' },
  { value: '76', label: '76 repeat by same provider' },
  { value: '95', label: '95 telehealth' },
];

const COLUMNS: readonly KeyedColumn[] = [
  { key: 'code', headerKey: 'billing.chargeLines.column.code', mono: true },
  { key: 'description', headerKey: 'billing.chargeLines.column.description' },
  { key: 'modifier', headerKey: 'billing.chargeLines.column.modifier' },
  { key: 'units', headerKey: 'billing.chargeLines.column.units', numeric: true },
  { key: 'fee', headerKey: 'billing.chargeLines.column.fee', numeric: true },
  { key: 'justify', headerKey: 'billing.chargeLines.column.justify' },
  { key: 'actions', headerKey: 'billing.chargeLines.column.actions', align: 'right' },
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
}: Readonly<ChargeLinesProps>): ReactElement {
  const t = useTranslator();
  const noModifier = t('billing.chargeLines.noModifier');
  const modifierOptions = [{ value: '', label: noModifier }, ...MODIFIERS];

  const rows = lines.map((line): Record<string, ReactNode> => {
    const modifier = line.modifiers[0] ?? '';

    const justify: ReactNode = line.deleted ? (
      <span className="or-small">{t('billing.chargeLines.removed')}</span>
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
                aria-label={t(linked ? 'billing.chargeLines.unlink' : 'billing.chargeLines.link', {
                  code: diagnosis.code,
                  display: diagnosis.display,
                  line: line.code,
                })}
                onClick={() => onToggleJustify(line.id, diagnosis.code)}
              >
                <span className="or-mono">{diagnosisPointer(index)}</span>
              </button>
            );
          })}
        </div>
        {line.justifiedBy.length === 0 ? (
          <Badge tone="danger">{t('billing.chargeLines.notJustified')}</Badge>
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
        <span className="or-small">{modifier || noModifier}</span>
      ) : (
        <Select
          className="or-charge-line__field"
          options={modifierOptions}
          value={modifier}
          disabled={readOnly}
          aria-label={t('billing.chargeLines.modifierFor', { code: line.code })}
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
          aria-label={t('billing.chargeLines.unitsFor', { code: line.code })}
          onChange={(event) => {
            const next = numericFieldValue(event.target.value);
            if (next !== null) onUnitsChange(line.id, next);
          }}
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
          aria-label={t('billing.chargeLines.restoreCode', { code: line.code })}
        >
          {t('billing.chargeLines.restore')}
        </Button>
      ) : (
        <IconButton
          icon="trash-2"
          label={t('billing.chargeLines.removeCode', { code: line.code })}
          size="sm"
          disabled={readOnly}
          onClick={() => onDelete(line.id)}
        />
      ),
    };
  });

  return (
    <Table
      caption={t('billing.chargeLines.caption')}
      columns={translateColumns(COLUMNS, t)}
      rows={rows}
    />
  );
}

'use client';

import { Badge, Button, Card, Modal, Select, Tag } from '@openrunic/ui';
import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  blockingFindings,
  ChargeLines,
  ChargePicker,
  DiagnosisPanel,
  feeSheetTotals,
  Money,
  newChargeLine,
  ScrubPanel,
  scrubFeeSheet,
  ToastDock,
  useToasts,
} from '@/components/billing';
import { ScreenCommands } from '@/components/command';
import type { FeeSheetTotals } from '@/components/billing';
import type { Command } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { MOCK_PROCEDURE_PANELS, useFeeSheets } from '@/lib/api';
import type { BillingClient, ChargeLine, FeeSheet, ProcedureCode } from '@/lib/api';
import {
  formatCount,
  formatDate,
  formatMoney,
  formatMrn,
  formatName,
  formatTime,
} from '@/lib/format';

/**
 * BL-01 Fee sheet. The most-complained-about screen in legacy EMRs, rebuilt.
 *
 * Three decisions carry the whole screen. Every capability is a visible,
 * labelled control, because the original's features were undiscoverable.
 * Every mistake is reversible: a removed line is struck through and restorable
 * rather than gone. And justify state is never hidden: each line shows the
 * diagnoses paying for it by their pointer letter, an unjustified line says so
 * in words, and the sheet cannot be marked ready while one exists.
 *
 * The metric it is built for: one office visit plus two procedures, justified,
 * captured in well under thirty seconds. That is why the shortcut panels are
 * always on screen and why justification is one keystroke per line.
 *
 * Edits live in this screen rather than on the server: the mock client does not
 * accept writes on purpose, so a screen can never be taught to trust state the
 * server never saw. When the billing API lands, `edits` becomes a mutation.
 */

export interface ChargesScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

/**
 * The line under the "Mark ready" button: why the button is disabled, or that
 * the work is done. It always says something, because a disabled control with
 * no reason beside it is the thing this screen exists to stop.
 */
function readyHint(isReady: boolean, blockingCount: number): string {
  if (isReady) return 'This visit is in the claim pipeline.';
  if (blockingCount === 0) return 'Charges are clean.';
  return `${formatCount(blockingCount, 'error blocks', 'errors block')} billing. See the scrub panel.`;
}

/**
 * The copay chip on the visit header: due and taken, due and short, or nothing
 * owed. Money is always named as money, never implied by a tone.
 */
function CopayBadge({ sheet }: Readonly<{ sheet: FeeSheet }>): ReactElement {
  const money = (amount: number): string => formatMoney(amount, { currency: sheet.currency }).text;

  if (sheet.copayDue === 0) {
    return (
      <Badge tone="neutral" icon="minus">
        No copay due
      </Badge>
    );
  }
  if (sheet.copayCollected >= sheet.copayDue) {
    return <Badge tone="success">Copay collected {money(sheet.copayCollected)}</Badge>;
  }
  return (
    <Badge tone="danger">Copay outstanding {money(sheet.copayDue - sheet.copayCollected)}</Badge>
  );
}

/**
 * One visit's charges, with the money it adds up to underneath.
 *
 * Its own component so the totals sit next to the lines that produce them: a
 * fee sheet whose footer is computed three hundred lines away from its rows is
 * a fee sheet nobody checks.
 */
function VisitCharges({
  sheet,
  lines,
  totals,
  isReady,
  onToggleJustify,
  onModifierChange,
  onUnitsChange,
  onSetDeleted,
}: Readonly<{
  sheet: FeeSheet;
  lines: readonly ChargeLine[];
  totals: FeeSheetTotals | null;
  isReady: boolean;
  onToggleJustify: (lineId: string, code: string) => void;
  onModifierChange: (lineId: string, modifier: string) => void;
  onUnitsChange: (lineId: string, units: number) => void;
  onSetDeleted: (lineId: string, deleted: boolean) => void;
}>): ReactElement {
  return (
    <Card
      overline="Visit"
      title={formatName(sheet.patient.name)}
      footer={
        totals ? (
          <dl className="or-totals">
            <div className="or-totals__row">
              <dt>Charges</dt>
              <dd>
                <Money amount={totals.charges} currency={sheet.currency} emphasis />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>Copay collected</dt>
              <dd>
                <Money amount={totals.copayCollected} currency={sheet.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>Expected from payer</dt>
              <dd>
                <Money amount={totals.expectedFromPayer} currency={sheet.currency} />
              </dd>
            </div>
          </dl>
        ) : null
      }
    >
      <div className="or-visit-header">
        <Tag mono>{formatMrn(sheet.patient.mrn)}</Tag>
        <Tag>{sheet.visitType}</Tag>
        <Tag>{sheet.providerName}</Tag>
        <span className="or-small">
          {formatDate(sheet.serviceDate)}, {formatTime(sheet.serviceDate)}
        </span>
        <CopayBadge sheet={sheet} />
        {isReady ? <Badge tone="success">Ready for billing</Badge> : null}
      </div>

      <ChargeLines
        lines={lines}
        diagnoses={sheet.diagnoses}
        currency={sheet.currency}
        readOnly={isReady}
        onToggleJustify={onToggleJustify}
        onModifierChange={onModifierChange}
        onUnitsChange={onUnitsChange}
        onDelete={(lineId) => onSetDeleted(lineId, true)}
        onRestore={(lineId) => onSetDeleted(lineId, false)}
      />
    </Card>
  );
}

export function ChargesScreen({ client }: Readonly<ChargesScreenProps>): ReactElement {
  const sheetsState = useFeeSheets({}, { client });
  const sheets = useMemo(() => sheetsState.data?.data ?? [], [sheetsState.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, ChargeLine[]>>({});
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const toasts = useToasts();
  const searchInputId = useId();

  const sheet: FeeSheet | null =
    sheets.find((candidate) => candidate.id === selectedId) ?? sheets[0] ?? null;

  /* Memoised so the empty-sheet case is a stable reference: an inline `[]`
     would be a new array every render and re-run everything below it. */
  const lines = useMemo<readonly ChargeLine[]>(
    () => (sheet ? (edits[sheet.id] ?? sheet.lines) : []),
    [sheet, edits]
  );
  const isReady = sheet ? (marked[sheet.id] ?? sheet.status !== 'OPEN') : false;

  const findings = useMemo(() => (sheet ? scrubFeeSheet(sheet, lines) : []), [sheet, lines]);
  const blocking = blockingFindings(findings);
  const totals = useMemo(() => (sheet ? feeSheetTotals(sheet, lines) : null), [sheet, lines]);

  const updateLines = useCallback(
    (sheetId: string, update: (current: readonly ChargeLine[]) => ChargeLine[]) => {
      setEdits((current) => {
        const existing = current[sheetId] ?? sheets.find((row) => row.id === sheetId)?.lines ?? [];
        return { ...current, [sheetId]: update(existing) };
      });
    },
    [sheets]
  );

  const addCode = useCallback(
    (code: ProcedureCode) => {
      if (!sheet) return;
      updateLines(sheet.id, (current) => [...current, newChargeLine(code, current.length + 1)]);
      setQuery('');
      toasts.push({
        tone: 'info',
        title: `${code.code} added`,
        message: 'Link a diagnosis to it.',
      });
    },
    [sheet, updateLines, toasts]
  );

  const toggleJustify = useCallback(
    (lineId: string, diagnosisCode: string) => {
      if (!sheet) return;
      updateLines(sheet.id, (current) =>
        current.map((line) =>
          line.id === lineId
            ? {
                ...line,
                justifiedBy: line.justifiedBy.includes(diagnosisCode)
                  ? line.justifiedBy.filter((code) => code !== diagnosisCode)
                  : [...line.justifiedBy, diagnosisCode],
              }
            : line
        )
      );
    },
    [sheet, updateLines]
  );

  const setModifier = useCallback(
    (lineId: string, modifier: string) => {
      if (!sheet) return;
      updateLines(sheet.id, (current) =>
        current.map((line) =>
          line.id === lineId ? { ...line, modifiers: modifier ? [modifier] : [] } : line
        )
      );
    },
    [sheet, updateLines]
  );

  const setUnits = useCallback(
    (lineId: string, units: number) => {
      if (!sheet) return;
      const safe = Number.isFinite(units) ? Math.max(Math.trunc(units), 1) : 1;
      updateLines(sheet.id, (current) =>
        current.map((line) => (line.id === lineId ? { ...line, units: safe } : line))
      );
    },
    [sheet, updateLines]
  );

  const setDeleted = useCallback(
    (lineId: string, deleted: boolean) => {
      if (!sheet) return;
      updateLines(sheet.id, (current) =>
        current.map((line) => (line.id === lineId ? { ...line, deleted } : line))
      );
      toasts.push({
        tone: 'info',
        title: deleted ? 'Charge removed' : 'Charge restored',
        message: deleted
          ? 'It stays on the sheet, struck through, and can be restored.'
          : undefined,
      });
    },
    [sheet, updateLines, toasts]
  );

  const markReady = useCallback(() => {
    if (!sheet) return;
    setMarked((current) => ({ ...current, [sheet.id]: true }));
    setConfirming(false);
    toasts.push({
      tone: 'success',
      title: 'Visit marked ready',
      message: `A claim was created from ${lines.filter((line) => !line.deleted).length} charges.`,
    });
  }, [sheet, lines, toasts]);

  const openNextVisit = useCallback(() => {
    if (sheets.length === 0) return;
    const index = sheets.findIndex((candidate) => candidate.id === sheet?.id);
    const next = sheets[(index + 1) % sheets.length];
    if (next) setSelectedId(next.id);
  }, [sheets, sheet]);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.charges.add',
        group: 'actions',
        label: 'Add charge',
        keywords: ['cpt', 'code', 'procedure', 'fee sheet'],
        icon: 'plus',
        perform: () => document.getElementById(searchInputId)?.focus(),
      },
      {
        id: 'billing.charges.markReady',
        group: 'actions',
        label: 'Mark visit ready for billing',
        keywords: ['ready', 'bill', 'close charges', 'submit charges'],
        icon: 'check',
        perform: () => setConfirming(true),
      },
      {
        id: 'billing.charges.nextVisit',
        group: 'actions',
        label: "Open the next visit's fee sheet",
        keywords: ['next visit', 'switch visit'],
        icon: 'arrow-right',
        perform: openNextVisit,
      },
    ],
    [searchInputId, openNextVisit]
  );

  const visitOptions = sheets.map((candidate) => ({
    value: candidate.id,
    label: `${formatTime(candidate.serviceDate)} ${formatName(candidate.patient.name, 'listing')}`,
  }));

  return (
    <AppShell
      title="Fee sheet"
      description="Capture this visit's charges and link each one to the diagnosis paying for it."
      topBarActions={
        sheets.length > 0 ? (
          <Select
            className="or-billing__visit-select"
            aria-label="Visit"
            options={visitOptions}
            value={sheet?.id ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
          />
        ) : null
      }
      actions={
        sheet ? (
          <div className="or-billing__action">
            <Button
              iconLeft="check"
              disabled={isReady || blocking.length > 0}
              onClick={() => setConfirming(true)}
            >
              Mark ready for billing
            </Button>
            <p className="or-caption or-billing__action-hint">
              {readyHint(isReady, blocking.length)}
            </p>
          </div>
        ) : null
      }
      rightRail={
        sheet ? (
          <>
            <DiagnosisPanel diagnoses={sheet.diagnoses} lines={lines} />
            <ScrubPanel findings={findings} />
          </>
        ) : null
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={sheetsState}
        subject="today's fee sheets"
        isEmpty={isEmptyList}
        loadingRows={5}
        empty={{
          title: 'No visits to charge',
          message:
            'Charges appear here once a visit is checked in. Open the schedule to see today.',
          icon: 'receipt-text',
          action: <Button href="/schedule">Go to the schedule</Button>,
        }}
      >
        {() =>
          sheet ? (
            <>
              <VisitCharges
                sheet={sheet}
                lines={lines}
                totals={totals}
                isReady={isReady}
                onToggleJustify={toggleJustify}
                onModifierChange={setModifier}
                onUnitsChange={setUnits}
                onSetDeleted={setDeleted}
              />

              <ChargePicker
                catalog={sheet.catalog}
                panels={MOCK_PROCEDURE_PANELS}
                currency={sheet.currency}
                query={query}
                onQueryChange={setQuery}
                onAdd={addCode}
                searchInputId={searchInputId}
              />
            </>
          ) : null
        }
      </AsyncBoundary>

      {/* Clinically significant rather than destructive: it states exactly what
          happens, and asks once, with no typing friction. */}
      <Modal
        open={confirming}
        role="alertdialog"
        title="Mark ready for billing"
        description={
          sheet
            ? `${lines.filter((line) => !line.deleted).length} charges lock and a claim is created for ${formatName(sheet.patient.name)}. Charges can still be corrected from the claim.`
            : undefined
        }
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={markReady}>Mark ready</Button>
          </>
        }
      />

      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}

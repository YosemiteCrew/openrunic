'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Modal, Select, Tag } from '@openrunic/ui';
import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  blockingFindings,
  ChargeLines,
  ChargePicker,
  DiagnosisPanel,
  feeSheetTotals,
  keywordsOf,
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
import { formatDate, formatMoney, formatMrn, formatName, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

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
 *
 * The visit type, the provider's name and every code on the sheet arrive as
 * data and render as data. Only what this screen says about them is translated.
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
function readyHint(isReady: boolean, blockingCount: number, translate: Translator): string {
  if (isReady) return translate('billing.charges.hint.ready');
  if (blockingCount === 0) return translate('billing.charges.hint.clean');
  return translate(
    blockingCount === 1
      ? 'billing.charges.hint.blocking.one'
      : 'billing.charges.hint.blocking.other',
    { count: blockingCount }
  );
}

/**
 * The copay chip on the visit header: due and taken, due and short, or nothing
 * owed. Money is always named as money, never implied by a tone.
 */
function CopayBadge({ sheet }: Readonly<{ sheet: FeeSheet }>): ReactElement {
  const t = useTranslator();
  const money = (amount: number): string => formatMoney(amount, { currency: sheet.currency }).text;

  if (sheet.copayDue === 0) {
    return (
      <Badge tone="neutral" icon="minus">
        {t('billing.charges.copay.none')}
      </Badge>
    );
  }
  if (sheet.copayCollected >= sheet.copayDue) {
    return (
      <Badge tone="success">
        {t('billing.charges.copay.collected', { amount: money(sheet.copayCollected) })}
      </Badge>
    );
  }
  return (
    <Badge tone="danger">
      {t('billing.charges.copay.outstanding', {
        amount: money(sheet.copayDue - sheet.copayCollected),
      })}
    </Badge>
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
  const t = useTranslator();

  return (
    <Card
      overline={t('billing.charges.visit')}
      title={formatName(sheet.patient.name)}
      footer={
        totals ? (
          <dl className="or-totals">
            <div className="or-totals__row">
              <dt>{t('billing.charges.totals.charges')}</dt>
              <dd>
                <Money amount={totals.charges} currency={sheet.currency} emphasis />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>{t('billing.charges.totals.copayCollected')}</dt>
              <dd>
                <Money amount={totals.copayCollected} currency={sheet.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>{t('billing.charges.totals.expectedFromPayer')}</dt>
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
        {isReady ? <Badge tone="success">{t('billing.charges.readyBadge')}</Badge> : null}
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
  const t = useTranslator();
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
        title: t('billing.charges.toast.added', { code: code.code }),
        message: t('billing.charges.toast.addedMessage'),
      });
    },
    [sheet, updateLines, toasts, t]
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
        title: deleted ? t('billing.charges.toast.removed') : t('billing.charges.toast.restored'),
        message: deleted ? t('billing.charges.toast.removedMessage') : undefined,
      });
    },
    [sheet, updateLines, toasts, t]
  );

  const markReady = useCallback(() => {
    if (!sheet) return;
    setMarked((current) => ({ ...current, [sheet.id]: true }));
    setConfirming(false);
    toasts.push({
      tone: 'success',
      title: t('billing.charges.toast.markedReady'),
      message: t('billing.charges.toast.markedReadyMessage', {
        count: lines.filter((line) => !line.deleted).length,
      }),
    });
  }, [sheet, lines, toasts, t]);

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
        label: t('billing.charges.command.add'),
        keywords: keywordsOf(t('billing.charges.command.add.keywords')),
        icon: 'plus',
        perform: () => document.getElementById(searchInputId)?.focus(),
      },
      {
        id: 'billing.charges.markReady',
        group: 'actions',
        label: t('billing.charges.command.markReady'),
        keywords: keywordsOf(t('billing.charges.command.markReady.keywords')),
        icon: 'check',
        perform: () => setConfirming(true),
      },
      {
        id: 'billing.charges.nextVisit',
        group: 'actions',
        label: t('billing.charges.command.nextVisit'),
        keywords: keywordsOf(t('billing.charges.command.nextVisit.keywords')),
        icon: 'arrow-right',
        perform: openNextVisit,
      },
    ],
    [searchInputId, openNextVisit, t]
  );

  const visitOptions = sheets.map((candidate) => ({
    value: candidate.id,
    label: `${formatTime(candidate.serviceDate)} ${formatName(candidate.patient.name, 'listing')}`,
  }));

  return (
    <AppShell
      title={t('billing.charges.title')}
      description={t('billing.charges.description')}
      topBarActions={
        sheets.length > 0 ? (
          <Select
            className="or-billing__visit-select"
            aria-label={t('billing.charges.visitSelect')}
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
              {t('billing.charges.markReady')}
            </Button>
            <p className="or-caption or-billing__action-hint">
              {readyHint(isReady, blocking.length, t)}
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
        subject={t('billing.charges.subject')}
        isEmpty={isEmptyList}
        loadingRows={5}
        empty={{
          title: t('billing.charges.empty.title'),
          message: t('billing.charges.empty.message'),
          icon: 'receipt-text',
          action: <Button href="/schedule">{t('billing.charges.empty.action')}</Button>,
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
        title={t('billing.charges.markReady')}
        description={
          sheet
            ? t('billing.charges.confirm.description', {
                count: lines.filter((line) => !line.deleted).length,
                name: formatName(sheet.patient.name),
              })
            : undefined
        }
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('billing.charges.confirm.cancel')}
            </Button>
            <Button onClick={markReady}>{t('billing.charges.confirm.submit')}</Button>
          </>
        }
      />

      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}

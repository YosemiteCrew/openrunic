'use client';

import { Badge, Button, Card, Switch, Tag, VitalStat } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  RemittanceLines,
  remittanceSummary,
  RESOLUTION_LABEL_KEYS,
  ToastDock,
  useToasts,
} from '@/components/billing';
import type { ExceptionResolution } from '@/components/billing';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { useRemittances } from '@/lib/api';
import type { BillingClient, Remittance } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * BL-05 ERA posting, the remittance workbench.
 *
 * Auto-posting is the default and the human works the exception queue. A clean
 * 835 needs zero interactions: it reports what it posted and the biller moves
 * on. Anything that did not match what the claim expected is lifted into an
 * exception queue above the ledger, with its disposition available in the row.
 *
 * There is no file anywhere on this screen. The legacy flow was upload, then
 * review, then trust the biller to notice a short payment across two columns;
 * here the variance is computed, labelled in words, and the only thing asked of
 * a person is the decision a person is actually needed for.
 *
 * The payer's name, its identifier and the remittance reference are the
 * payer's own and render as they arrived. The method is a coded value, so the
 * two words this screen puts on it are the screen's own and are translated.
 */

export interface RemittanceScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

export function RemittanceScreen({ client }: Readonly<RemittanceScreenProps>): ReactElement {
  const t = useTranslator();
  const remittancesState = useRemittances({}, { client });
  const remittances = useMemo(() => remittancesState.data?.data ?? [], [remittancesState.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, ExceptionResolution>>({});
  const toasts = useToasts();

  const listed = exceptionsOnly
    ? remittances.filter((remittance) => remittance.status === 'EXCEPTIONS')
    : remittances;

  const remittance: Remittance | null =
    listed.find((candidate) => candidate.id === selectedId) ?? listed[0] ?? null;

  const summary = remittance ? remittanceSummary(remittance) : null;

  const openExceptions = useMemo(() => {
    if (!remittance) return [];
    return remittance.lines.filter(
      (line) => line.state === 'EXCEPTION' && resolutions[line.id] === undefined
    );
  }, [remittance, resolutions]);

  const resolve = useCallback(
    (lineId: string, resolution: ExceptionResolution) => {
      setResolutions((current) => ({ ...current, [lineId]: resolution }));
      toasts.push({
        tone: 'success',
        title: t(RESOLUTION_LABEL_KEYS[resolution]),
        message: t('billing.remittance.toast.resolvedMessage'),
      });
    },
    [toasts, t]
  );

  const openNextWithExceptions = useCallback(() => {
    const next = remittances.find(
      (candidate) => candidate.status === 'EXCEPTIONS' && candidate.id !== remittance?.id
    );
    if (next) {
      setSelectedId(next.id);
      return;
    }
    toasts.push({
      tone: 'info',
      title: t('billing.remittance.toast.noOther'),
      message: t('billing.remittance.toast.noOtherMessage'),
    });
  }, [remittances, remittance, toasts, t]);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.remittance.exceptions',
        group: 'actions',
        label: t('billing.remittance.command.exceptions'),
        keywords: searchWords(t('billing.remittance.command.exceptions.keywords')),
        icon: 'triangle-alert',
        perform: openNextWithExceptions,
      },
      {
        id: 'billing.remittance.filterExceptions',
        group: 'actions',
        label: t('billing.remittance.command.filterExceptions'),
        keywords: searchWords(t('billing.remittance.command.filterExceptions.keywords')),
        icon: 'funnel',
        perform: () => setExceptionsOnly(true),
      },
      {
        id: 'billing.remittance.showAll',
        group: 'actions',
        label: t('billing.remittance.command.showAll'),
        keywords: searchWords(t('billing.remittance.command.showAll.keywords')),
        icon: 'list',
        perform: () => setExceptionsOnly(false),
      },
    ],
    [openNextWithExceptions, t]
  );

  return (
    <AppShell
      title={t('billing.remittance.title')}
      description={t('billing.remittance.description')}
      topBarActions={
        <Switch
          label={t('billing.remittance.exceptionsOnly')}
          checked={exceptionsOnly}
          onChange={() => setExceptionsOnly((value) => !value)}
        />
      }
      rightRail={
        <Card
          overline={t('billing.remittance.listOverline')}
          title={t('billing.remittance.listTitle')}
        >
          <ul className="or-era-list">
            {listed.map((candidate) => {
              const candidateSummary = remittanceSummary(candidate);
              const active = candidate.id === remittance?.id;
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="or-era-list__button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedId(candidate.id)}
                  >
                    <span className="or-era-list__payer">{candidate.payer.name}</span>
                    <span className="or-mono or-caption">{candidate.reference}</span>
                    <span className="or-era-list__meta">
                      <span className="or-mono">
                        {
                          formatMoney(candidate.paymentAmount, { currency: candidate.currency })
                            .text
                        }
                      </span>
                      <span className="or-caption">
                        {formatDate(candidate.receivedAt, 'dense')}
                      </span>
                    </span>
                    {candidateSummary.exceptions > 0 ? (
                      <Badge tone="danger">
                        {t(
                          candidateSummary.exceptions === 1
                            ? 'billing.remittance.exceptionCount.one'
                            : 'billing.remittance.exceptionCount.other',
                          { count: candidateSummary.exceptions }
                        )}
                      </Badge>
                    ) : (
                      <Badge tone="success">{t('billing.remittance.postedInFull')}</Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={remittancesState}
        subject={t('billing.remittance.subject')}
        isEmpty={isEmptyList}
        loadingRows={6}
        empty={{
          title: t('billing.remittance.empty.title'),
          message: t('billing.remittance.empty.message'),
          icon: 'file-input',
          action: <Button href="/billing/claims">{t('billing.remittance.empty.action')}</Button>,
        }}
      >
        {() =>
          remittance && summary ? (
            <>
              <Card
                overline={remittance.payer.name}
                title={t('billing.remittance.cardTitle', { reference: remittance.reference })}
              >
                <div className="or-visit-header">
                  <Tag>
                    {remittance.method === 'EFT'
                      ? t('billing.remittance.method.eft')
                      : t('billing.remittance.method.check')}
                  </Tag>
                  <span className="or-small">
                    {t('billing.remittance.received', {
                      date: formatDate(remittance.receivedAt),
                    })}
                  </span>
                  <Tag mono>{remittance.payer.payerId}</Tag>
                </div>

                <section className="or-strip" aria-label={t('billing.remittance.summary')}>
                  <VitalStat
                    label={t('billing.remittance.payment')}
                    value={
                      formatMoney(remittance.paymentAmount, { currency: remittance.currency }).text
                    }
                    state="neutral"
                    stateLabel={t('billing.remittance.serviceLineCount', { count: summary.lines })}
                  />
                  <VitalStat
                    label={t('billing.remittance.autoPosted')}
                    value={`${summary.autoPostedPercent}`}
                    unit="%"
                    state={summary.autoPostedPercent === 100 ? 'success' : 'neutral'}
                    stateLabel={t('billing.remittance.autoPostedOf', {
                      posted: summary.autoPosted,
                      total: summary.lines,
                    })}
                  />
                  <VitalStat
                    label={t('billing.remittance.exceptions')}
                    value={`${openExceptions.length}`}
                    state={openExceptions.length === 0 ? 'success' : 'danger'}
                    stateLabel={
                      openExceptions.length === 0
                        ? t('billing.remittance.nothingToWork')
                        : t('billing.remittance.needsDecision')
                    }
                  />
                  <VitalStat
                    label={t('billing.remittance.patientResponsibility')}
                    value={
                      formatMoney(summary.patientResponsibility, {
                        currency: remittance.currency,
                      }).text
                    }
                    state="neutral"
                    stateLabel={t('billing.remittance.movesToStatements')}
                  />
                </section>
              </Card>

              {openExceptions.length > 0 ? (
                <Card
                  overline={t('billing.remittance.workQueue')}
                  title={t('billing.remittance.exceptions')}
                >
                  <p className="or-small or-billing__hint">
                    {t('billing.remittance.exceptionsHint')}
                  </p>
                  <RemittanceLines
                    caption={t('billing.remittance.exceptionCaption')}
                    lines={openExceptions}
                    currency={remittance.currency}
                    resolutions={resolutions}
                    onResolve={resolve}
                  />
                </Card>
              ) : (
                <Card
                  overline={t('billing.remittance.workQueue')}
                  title={t('billing.remittance.nothingToWork')}
                >
                  <p className="or-body">
                    {t('billing.remittance.allMatched', { reference: remittance.reference })}
                  </p>
                </Card>
              )}

              <Card
                overline={t('billing.remittance.ledger')}
                title={t('billing.remittance.ledgerTitle')}
              >
                <RemittanceLines
                  caption={t('billing.remittance.ledgerCaption', {
                    reference: remittance.reference,
                  })}
                  lines={remittance.lines}
                  currency={remittance.currency}
                  resolutions={resolutions}
                />
              </Card>
            </>
          ) : null
        }
      </AsyncBoundary>

      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}

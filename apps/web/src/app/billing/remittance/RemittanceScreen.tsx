'use client';

import { Badge, Button, Card, Switch, Tag, VitalStat } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  RemittanceLines,
  remittanceSummary,
  RESOLUTION_LABELS,
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
 */

export interface RemittanceScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

export function RemittanceScreen({ client }: Readonly<RemittanceScreenProps>): ReactElement {
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
        title: RESOLUTION_LABELS[resolution],
        message: 'The line left the exception queue.',
      });
    },
    [toasts]
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
      title: 'No other remittance has exceptions',
      message: 'Everything else posted in full.',
    });
  }, [remittances, remittance, toasts]);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.remittance.exceptions',
        group: 'actions',
        label: 'Open the next remittance with exceptions',
        keywords: ['era', '835', 'exceptions', 'work queue'],
        icon: 'triangle-alert',
        perform: openNextWithExceptions,
      },
      {
        id: 'billing.remittance.filterExceptions',
        group: 'actions',
        label: 'Show only remittances with exceptions',
        keywords: ['filter', 'era', 'exceptions'],
        icon: 'funnel',
        perform: () => setExceptionsOnly(true),
      },
      {
        id: 'billing.remittance.showAll',
        group: 'actions',
        label: 'Show every remittance',
        keywords: ['clear filter', 'all era'],
        icon: 'list',
        perform: () => setExceptionsOnly(false),
      },
    ],
    [openNextWithExceptions]
  );

  return (
    <AppShell
      title="Remittance"
      description="Post the 835s, then work only what did not match."
      topBarActions={
        <Switch
          label="Exceptions only"
          checked={exceptionsOnly}
          onChange={() => setExceptionsOnly((value) => !value)}
        />
      }
      rightRail={
        <Card overline="Remittances" title="Received">
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
                        {candidateSummary.exceptions}{' '}
                        {candidateSummary.exceptions === 1 ? 'exception' : 'exceptions'}
                      </Badge>
                    ) : (
                      <Badge tone="success">Posted in full</Badge>
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
        subject="remittances"
        isEmpty={isEmptyList}
        loadingRows={6}
        empty={{
          title: 'No remittance advice received',
          message:
            'Payer remittances arrive through the clearinghouse adapter and post themselves. Nothing has come in yet.',
          icon: 'file-input',
          action: <Button href="/billing/claims">Go to the claim workbench</Button>,
        }}
      >
        {() =>
          remittance && summary ? (
            <>
              <Card overline={remittance.payer.name} title={`Remittance ${remittance.reference}`}>
                <div className="or-visit-header">
                  <Tag>{remittance.method === 'EFT' ? 'Electronic transfer' : 'Paper check'}</Tag>
                  <span className="or-small">Received {formatDate(remittance.receivedAt)}</span>
                  <Tag mono>{remittance.payer.payerId}</Tag>
                </div>

                <section className="or-strip" aria-label="Posting summary">
                  <VitalStat
                    label="Payment"
                    value={
                      formatMoney(remittance.paymentAmount, { currency: remittance.currency }).text
                    }
                    state="neutral"
                    stateLabel={`${summary.lines} service lines`}
                  />
                  <VitalStat
                    label="Auto-posted"
                    value={`${summary.autoPostedPercent}`}
                    unit="%"
                    state={summary.autoPostedPercent === 100 ? 'success' : 'neutral'}
                    stateLabel={`${summary.autoPosted} of ${summary.lines} lines`}
                  />
                  <VitalStat
                    label="Exceptions"
                    value={`${openExceptions.length}`}
                    state={openExceptions.length === 0 ? 'success' : 'danger'}
                    stateLabel={
                      openExceptions.length === 0 ? 'Nothing to work' : 'Needs a decision'
                    }
                  />
                  <VitalStat
                    label="Patient responsibility"
                    value={
                      formatMoney(summary.patientResponsibility, {
                        currency: remittance.currency,
                      }).text
                    }
                    state="neutral"
                    stateLabel="Moves to statements"
                  />
                </section>
              </Card>

              {openExceptions.length > 0 ? (
                <Card overline="Work queue" title="Exceptions">
                  <p className="or-small or-billing__hint">
                    These lines did not pay what the claim expected. Choose what happens to each
                    balance.
                  </p>
                  <RemittanceLines
                    caption="Exception queue"
                    lines={openExceptions}
                    currency={remittance.currency}
                    resolutions={resolutions}
                    onResolve={resolve}
                  />
                </Card>
              ) : (
                <Card overline="Work queue" title="Nothing to work">
                  <p className="or-body">
                    Every line on {remittance.reference} matched the claim and posted itself.
                  </p>
                </Card>
              )}

              <Card overline="Ledger" title="All service lines">
                <RemittanceLines
                  caption={`Service lines on ${remittance.reference}`}
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

'use client';

import { Button, Card, Input, VitalStat } from '@openrunic/ui';
import type { StatusTone } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  bulkActionsFor,
  ClaimDrawer,
  ClaimTable,
  claimAgeingBands,
  claimCounts,
  CLAIM_STATUS_LABEL_KEYS,
  isBlockedByScrub,
  ToastDock,
  useToasts,
} from '@/components/billing';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { clinicNow } from '@/components/schedule/clock';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { CLAIM_STATUSES, filterClaims, useClaims } from '@/lib/api';
import type { BillingClient, Claim, ClaimStatus } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * BL-03 Claim workbench. The biller's home.
 *
 * Every claim is a row in a state ledger, and the state filter chips are the
 * primary navigation, so "what is denied" and "what is ready to submit" are one
 * click apart rather than two screens apart. There are no files anywhere on
 * this screen: acknowledgements arrive as events folded into the claim's own
 * history, which is the whole point of replacing the legacy batch-file and
 * EDI-review pair.
 *
 * The metric: a day's clean claims go from captured to submitted in three bulk
 * actions. Filter to the state, select the rows, run the action. Claims that
 * would fail a scrub are unselectable and say why, so a bulk submit never
 * silently drops a claim.
 *
 * The whole queue is fetched once and filtered in the browser. The canon says
 * not to paginate under 200 rows, and a workbench that re-fetched on every
 * keystroke would flash its skeleton at a biller who is only narrowing a list
 * they can already see.
 */

const PAGE_SIZE = 100;

/**
 * What to do about the money sitting in an ageing band, in the band's own
 * words. The tone already carries the urgency; this says the action, because a
 * colour is never the only signal.
 *
 * A literal map from the tone to a catalogue key. Both halves stay visible to
 * the drift test, which a key assembled from `band.tone` would not be.
 */
const BAND_ADVICE_KEYS: Record<StatusTone, string> = {
  danger: 'billing.claims.advice.chase',
  neutral: 'billing.claims.advice.ageing',
  success: 'billing.claims.advice.onTrack',
};

export interface ClaimsScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

export function ClaimsScreen({ client }: Readonly<ClaimsScreenProps>): ReactElement {
  const t = useTranslator();
  const claimsState = useClaims({ pageSize: PAGE_SIZE }, { client });
  const now = useMemo(() => clinicNow().toISOString(), []);

  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moved, setMoved] = useState<Record<string, ClaimStatus>>({});
  const [openClaim, setOpenClaim] = useState<Claim | null>(null);
  const toasts = useToasts();

  /** Bulk actions move claims on locally: the mock client takes no writes. */
  const claims = useMemo<Claim[]>(() => {
    const rows = claimsState.data?.data ?? [];
    return rows.map((claim) => {
      const next = moved[claim.id];
      return next ? { ...claim, status: next, statusSince: now } : claim;
    });
  }, [claimsState.data, moved, now]);

  const counts = useMemo(() => claimCounts(claims), [claims]);
  const bands = useMemo(() => claimAgeingBands(claims, now), [claims, now]);

  const visible = useMemo(
    () => filterClaims(claims, { status: status ?? undefined, q: query || undefined }),
    [claims, status, query]
  );

  const selectable = useMemo(() => visible.filter((claim) => !isBlockedByScrub(claim)), [visible]);

  const toggle = useCallback((claimId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(selectable.map((claim) => claim.id)));
  }, [selectable]);

  /**
   * The state the claims land in is what the toast reports, so the confirmation
   * is derived from the transition rather than passed alongside it. It used to
   * be a second argument carrying the past participle ("Scrubbed"), which was a
   * second English string saying what `next` already said.
   */
  const runBulk = useCallback(
    (next: ClaimStatus) => {
      const ids: string[] = [];
      for (const claim of selectable) {
        if (selected.has(claim.id)) ids.push(claim.id);
      }
      if (ids.length === 0) {
        toasts.push({
          tone: 'info',
          title: t('billing.claims.toast.nothingSelected'),
          message: t('billing.claims.toast.nothingSelectedMessage'),
        });
        return;
      }
      setMoved((current) => {
        const update = { ...current };
        for (const id of ids) update[id] = next;
        return update;
      });
      setSelected(new Set());
      const state = t(CLAIM_STATUS_LABEL_KEYS[next]).toLowerCase();
      toasts.push({
        tone: 'success',
        title: t(
          ids.length === 1
            ? 'billing.claims.toast.bulkDone.one'
            : 'billing.claims.toast.bulkDone.other',
          { count: ids.length, state }
        ),
        message: t('billing.claims.toast.movedTo', { state }),
      });
    },
    [selectable, selected, toasts, t]
  );

  const rebill = useCallback(
    (claim: Claim) => {
      setMoved((current) => ({ ...current, [claim.id]: 'REBILLED' }));
      setOpenClaim(null);
      toasts.push({
        tone: 'success',
        title: t('billing.claims.toast.rebilled', { number: claim.claimNumber }),
        message: t('billing.claims.toast.rebilledMessage', { payer: claim.payer.name }),
      });
    },
    [toasts, t]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.claims.scrub',
        group: 'actions',
        // The same key the bulk-action button uses, so the palette and the
        // button can never end up naming one action two ways.
        label: t('billing.bulkAction.scrub'),
        keywords: searchWords(t('billing.claims.command.scrub.keywords')),
        icon: 'shield-check',
        perform: () => runBulk('SCRUBBED'),
      },
      {
        id: 'billing.claims.submit',
        group: 'actions',
        label: t('billing.bulkAction.submit'),
        keywords: searchWords(t('billing.claims.command.submit.keywords')),
        icon: 'send',
        perform: () => runBulk('SUBMITTED'),
      },
      {
        id: 'billing.claims.selectAll',
        group: 'actions',
        label: t('billing.claims.command.selectAll'),
        keywords: searchWords(t('billing.claims.command.selectAll.keywords')),
        icon: 'check-check',
        perform: selectAll,
      },
      {
        id: 'billing.claims.denied',
        group: 'actions',
        label: t('billing.claims.command.denied'),
        keywords: searchWords(t('billing.claims.command.denied.keywords')),
        icon: 'triangle-alert',
        perform: () => {
          setStatus('DENIED');
          setSelected(new Set());
        },
      },
    ],
    [runBulk, selectAll, t]
  );

  const actions = status ? bulkActionsFor(status) : [];
  const selectedCount = selectable.filter((claim) => selected.has(claim.id)).length;

  return (
    <AppShell
      title={t('billing.claims.title')}
      description={t('billing.claims.description')}
      topBarActions={
        <Input
          className="or-billing__search"
          aria-label={t('billing.claims.search')}
          placeholder={t('billing.claims.searchPlaceholder')}
          iconLeft="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      }
      actions={
        actions.length > 0 ? (
          <div className="or-billing__action">
            {actions.map((action) => (
              <Button
                key={action.id}
                iconLeft="check"
                disabled={selectedCount === 0}
                onClick={() => runBulk(action.next)}
              >
                {t(action.labelKey)}
              </Button>
            ))}
            <p className="or-caption or-billing__action-hint">
              {selectedCount === 0
                ? t('billing.claims.selectPrompt')
                : t('billing.claims.selectedCount', { count: selectedCount })}
            </p>
          </div>
        ) : null
      }
    >
      <ScreenCommands commands={commands} />

      <section className="or-strip" aria-label={t('billing.claims.strip')}>
        {bands.map((band) => (
          <VitalStat
            key={band.key}
            label={t(band.labelKey)}
            value={formatMoney(band.amount, { currency: 'USD' }).text}
            state={band.tone}
            stateLabel={t(
              band.count === 1 ? 'billing.claims.bandState.one' : 'billing.claims.bandState.other',
              { count: band.count, advice: t(BAND_ADVICE_KEYS[band.tone]) }
            )}
          />
        ))}
      </section>

      <Card overline={t('billing.claims.states')} title={t('billing.claims.filterTitle')}>
        <fieldset className="or-filter-chips" aria-label={t('billing.claims.stateLegend')}>
          <button
            type="button"
            className="or-filter-chip"
            aria-pressed={status === null}
            onClick={() => {
              setStatus(null);
              setSelected(new Set());
            }}
          >
            {t('billing.claims.all')} <span className="or-mono">{claims.length}</span>
          </button>
          {CLAIM_STATUSES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="or-filter-chip"
              aria-pressed={status === candidate}
              onClick={() => {
                setStatus(candidate);
                setSelected(new Set());
              }}
            >
              {t(CLAIM_STATUS_LABEL_KEYS[candidate])}{' '}
              <span className="or-mono">{counts[candidate]}</span>
            </button>
          ))}
        </fieldset>
      </Card>

      <AsyncBoundary
        state={claimsState}
        subject={t('billing.claims.subject')}
        isEmpty={() => visible.length === 0}
        loadingRows={8}
        empty={{
          title: status
            ? t('billing.claims.empty.filtered', {
                state: t(CLAIM_STATUS_LABEL_KEYS[status]).toLowerCase(),
              })
            : t('billing.claims.empty.title'),
          message: query
            ? t('billing.claims.empty.search', { query })
            : t('billing.claims.empty.message'),
          icon: 'file-check',
          action: <Button href="/billing/charges">{t('billing.claims.empty.action')}</Button>,
        }}
      >
        {() => (
          <ClaimTable
            claims={visible}
            now={now}
            selected={selected}
            onToggle={toggle}
            onOpen={setOpenClaim}
          />
        )}
      </AsyncBoundary>

      <ClaimDrawer claim={openClaim} onClose={() => setOpenClaim(null)} onRebill={rebill} />
      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}

'use client';

import { Button, Card, Input, VitalStat } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  bulkActionsFor,
  ClaimDrawer,
  ClaimTable,
  claimAgeingBands,
  claimCounts,
  CLAIM_STATUS_LABELS,
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

/**
 * BL-03 Claim workbench. The biller's home.
 *
 * Every claim is a row in a state ledger, and the state filter chips are the
 * primary navigation, so "what is denied" and "what is ready to submit" are one
 * click apart rather than two screens apart. There are no files anywhere on
 * this screen: acknowledgements arrive as events folded into the claim's own
 * history, which is the whole point of replacing OpenEMR's batch-file and
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

export interface ClaimsScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

export function ClaimsScreen({ client }: ClaimsScreenProps = {}): ReactElement {
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

  const runBulk = useCallback(
    (next: ClaimStatus, done: string) => {
      const ids = selectable.filter((claim) => selected.has(claim.id)).map((claim) => claim.id);
      if (ids.length === 0) {
        toasts.push({
          tone: 'info',
          title: 'Nothing selected',
          message: 'Select the claims to act on first.',
        });
        return;
      }
      setMoved((current) => {
        const update = { ...current };
        for (const id of ids) update[id] = next;
        return update;
      });
      setSelected(new Set());
      toasts.push({
        tone: 'success',
        title: `${ids.length} ${ids.length === 1 ? 'claim' : 'claims'} ${done.toLowerCase()}`,
        message: `Moved to ${CLAIM_STATUS_LABELS[next].toLowerCase()}.`,
      });
    },
    [selectable, selected, toasts]
  );

  const rebill = useCallback(
    (claim: Claim) => {
      setMoved((current) => ({ ...current, [claim.id]: 'REBILLED' }));
      setOpenClaim(null);
      toasts.push({
        tone: 'success',
        title: `${claim.claimNumber} rebilled`,
        message: `A replacement claim went to ${claim.payer.name}.`,
      });
    },
    [toasts]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.claims.scrub',
        group: 'actions',
        label: 'Scrub selected claims',
        keywords: ['scrub', 'edits', 'check claims'],
        icon: 'shield-check',
        perform: () => runBulk('SCRUBBED', 'Scrubbed'),
      },
      {
        id: 'billing.claims.submit',
        group: 'actions',
        label: 'Submit selected claims',
        keywords: ['submit', 'transmit', 'send claims', '837'],
        icon: 'send',
        perform: () => runBulk('SUBMITTED', 'Submitted'),
      },
      {
        id: 'billing.claims.selectAll',
        group: 'actions',
        label: 'Select every claim in this view',
        keywords: ['select all', 'bulk'],
        icon: 'check-check',
        perform: selectAll,
      },
      {
        id: 'billing.claims.denied',
        group: 'actions',
        label: 'Show denied claims',
        keywords: ['denials', 'denied', 'rejections'],
        icon: 'triangle-alert',
        perform: () => {
          setStatus('DENIED');
          setSelected(new Set());
        },
      },
    ],
    [runBulk, selectAll]
  );

  const actions = status ? bulkActionsFor(status) : [];
  const selectedCount = selectable.filter((claim) => selected.has(claim.id)).length;

  return (
    <AppShell
      title="Claim workbench"
      description="Every claim as a state ledger row, from captured to paid."
      topBarActions={
        <Input
          className="or-billing__search"
          aria-label="Search claims"
          placeholder="Claim number, patient or MRN"
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
                onClick={() => runBulk(action.next, action.done)}
              >
                {action.label}
              </Button>
            ))}
            <p className="or-caption or-billing__action-hint">
              {selectedCount === 0 ? 'Select claims to act on them.' : `${selectedCount} selected.`}
            </p>
          </div>
        ) : null
      }
    >
      <ScreenCommands commands={commands} />

      <section className="or-strip" aria-label="Claims by age in state">
        {bands.map((band) => (
          <VitalStat
            key={band.key}
            label={band.label}
            value={formatMoney(band.amount, { currency: 'USD' }).text}
            state={band.tone}
            stateLabel={`${band.count} ${band.count === 1 ? 'claim' : 'claims'}, ${
              band.tone === 'danger'
                ? 'chase these'
                : band.tone === 'neutral'
                  ? 'ageing'
                  : 'on track'
            }`}
          />
        ))}
      </section>

      <Card overline="States" title="Filter the queue">
        <div className="or-filter-chips" role="group" aria-label="Claim state">
          <button
            type="button"
            className="or-filter-chip"
            aria-pressed={status === null}
            onClick={() => {
              setStatus(null);
              setSelected(new Set());
            }}
          >
            All <span className="or-mono">{claims.length}</span>
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
              {CLAIM_STATUS_LABELS[candidate]} <span className="or-mono">{counts[candidate]}</span>
            </button>
          ))}
        </div>
      </Card>

      <AsyncBoundary
        state={claimsState}
        subject="the claim queue"
        isEmpty={() => visible.length === 0}
        loadingRows={8}
        empty={{
          title: status ? `No ${CLAIM_STATUS_LABELS[status].toLowerCase()} claims` : 'No claims',
          message: query
            ? `Nothing in this queue matches "${query}". Clear the search to see the whole queue.`
            : 'Claims appear here once a visit is marked ready on the fee sheet.',
          icon: 'file-check',
          action: <Button href="/billing/charges">Go to the fee sheet</Button>,
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

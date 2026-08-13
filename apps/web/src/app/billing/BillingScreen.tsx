'use client';

import { Badge, Button, Card, VitalStat } from '@openrunic/ui';
import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { arSummary, claimCounts, Money, remittanceSummary } from '@/components/billing';
import { AppShell } from '@/components/shell';
import { useClaims, useRemittances, useStatements } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/**
 * The billing area's front door.
 *
 * The rail's Billing row has to land somewhere, and landing on one of the five
 * workbenches would be a guess about whose morning it is. So this screen
 * answers one question, "where is the money stuck today", and every number on
 * it leads into the workbench that owns it. It holds no state and offers no
 * verbs of its own: the work happens on the five screens below.
 */

interface AreaLink {
  href: string;
  title: string;
  description: string;
}

const AREAS: AreaLink[] = [
  {
    href: '/billing/charges',
    title: 'Fee sheet',
    description: "Capture a visit's charges and link each one to its diagnosis.",
  },
  {
    href: '/billing/claims',
    title: 'Claim workbench',
    description: 'Scrub, submit and work denials across every claim state.',
  },
  {
    href: '/billing/remittance',
    title: 'Remittance',
    description: 'Post the 835s and clear what did not match.',
  },
  {
    href: '/billing/statements',
    title: 'Statements and AR',
    description: 'Patient balances, ageing and statement runs.',
  },
  {
    href: '/billing/payments',
    title: 'Payments',
    description: 'Take a payment, allocate it, issue the receipt.',
  },
];

export function BillingScreen(): ReactElement {
  const claimsState = useClaims({ pageSize: 100 });
  const remittancesState = useRemittances();
  const statementsState = useStatements({ pageSize: 100 });

  const claims = useMemo(() => claimsState.data?.data ?? [], [claimsState.data]);
  const remittances = useMemo(() => remittancesState.data?.data ?? [], [remittancesState.data]);
  const accounts = useMemo(() => statementsState.data?.data ?? [], [statementsState.data]);

  const counts = claimCounts(claims);
  const ar = arSummary(accounts);
  const exceptions = remittances.reduce(
    (total, remittance) => total + remittanceSummary(remittance).exceptions,
    0
  );
  const denied = claims
    .filter((claim) => claim.status === 'DENIED')
    .reduce((total, claim) => total + claim.billed, 0);

  return (
    <AppShell
      title="Billing"
      description="Where the money is today, and the workbench that moves it."
    >
      <section className="or-strip" aria-label="Today's revenue cycle">
        <VitalStat
          label="Ready to submit"
          value={`${counts.SCRUBBED}`}
          state={counts.SCRUBBED > 0 ? 'neutral' : 'success'}
          stateLabel={counts.SCRUBBED > 0 ? 'Waiting on a submit' : 'Nothing waiting'}
        />
        <VitalStat
          label="Denied"
          value={formatMoney(denied, { currency: 'USD' }).text}
          state={counts.DENIED > 0 ? 'danger' : 'success'}
          stateLabel={`${counts.DENIED} ${counts.DENIED === 1 ? 'claim' : 'claims'}`}
        />
        <VitalStat
          label="Remittance exceptions"
          value={`${exceptions}`}
          state={exceptions > 0 ? 'danger' : 'success'}
          stateLabel={exceptions > 0 ? 'Needs a decision' : 'All posted'}
        />
        <VitalStat
          label="Patient AR"
          value={formatMoney(ar.total, { currency: 'USD' }).text}
          state={ar.buckets.DAYS_91_PLUS > 0 ? 'danger' : 'neutral'}
          stateLabel={
            ar.buckets.DAYS_91_PLUS > 0 ? 'Some of it is over 90 days' : `${ar.accounts} accounts`
          }
        />
      </section>

      <Card overline="Workbenches" title="Where to go">
        <ul className="or-area-list">
          {AREAS.map((area) => (
            <li key={area.href} className="or-area-list__item">
              <div className="or-area-list__body">
                <p className="or-area-list__title">{area.title}</p>
                <p className="or-small">{area.description}</p>
              </div>
              <Button variant="ghost" size="sm" iconRight="arrow-right" href={area.href}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card overline="Oldest money" title="Aged balances">
        <p className="or-body">
          <Money amount={ar.buckets.DAYS_91_PLUS} currency="USD" emphasis /> is over 90 days old
          across {ar.accounts} accounts.{' '}
          {ar.buckets.DAYS_91_PLUS > 0 ? (
            <Badge tone="danger">Work these first</Badge>
          ) : (
            <Badge tone="success">Nothing aged</Badge>
          )}
        </p>
        <Button variant="secondary" href="/billing/statements">
          Open statements and AR
        </Button>
      </Card>
    </AppShell>
  );
}

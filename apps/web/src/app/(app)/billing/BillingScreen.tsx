'use client';

import { Badge, Button, Card, VitalStat } from '@openrunic/ui';
import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { arSummary, claimCounts, Money, remittanceSummary } from '@/components/billing';
import { AppShell } from '@/components/shell';
import { useClaims, useRemittances, useStatements } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

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
  /** Catalogue key for the workbench's name. */
  titleKey: string;
  /** Catalogue key for the one line saying what is done there. */
  descriptionKey: string;
}

/**
 * The five workbenches, as data.
 *
 * Keys rather than words, because this list is built once when the module loads
 * and the reader arrives afterwards. Keeping it as a constant is still worth
 * doing - the whole of the area's navigation is reviewable in one place, in the
 * order it renders - and the two things that depend on who is reading become
 * lookups at render.
 */
const AREAS: readonly AreaLink[] = [
  {
    href: '/billing/charges',
    titleKey: 'billing.home.area.charges.title',
    descriptionKey: 'billing.home.area.charges.description',
  },
  {
    href: '/billing/claims',
    titleKey: 'billing.home.area.claims.title',
    descriptionKey: 'billing.home.area.claims.description',
  },
  {
    href: '/billing/remittance',
    titleKey: 'billing.home.area.remittance.title',
    descriptionKey: 'billing.home.area.remittance.description',
  },
  {
    href: '/billing/statements',
    titleKey: 'billing.home.area.statements.title',
    descriptionKey: 'billing.home.area.statements.description',
  },
  {
    href: '/billing/payments',
    titleKey: 'billing.home.area.payments.title',
    descriptionKey: 'billing.home.area.payments.description',
  },
];

export function BillingScreen(): ReactElement {
  const t = useTranslator();
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
    <AppShell title={t('billing.home.title')} description={t('billing.home.description')}>
      <section className="or-strip" aria-label={t('billing.home.strip')}>
        <VitalStat
          label={t('billing.home.readyToSubmit')}
          value={`${counts.SCRUBBED}`}
          state={counts.SCRUBBED > 0 ? 'neutral' : 'success'}
          stateLabel={
            counts.SCRUBBED > 0
              ? t('billing.home.waitingOnSubmit')
              : t('billing.home.nothingWaiting')
          }
        />
        <VitalStat
          label={t('billing.home.denied')}
          value={formatMoney(denied, { currency: 'USD' }).text}
          state={counts.DENIED > 0 ? 'danger' : 'success'}
          stateLabel={t(
            counts.DENIED === 1
              ? 'billing.home.deniedClaims.one'
              : 'billing.home.deniedClaims.other',
            { count: counts.DENIED }
          )}
        />
        <VitalStat
          label={t('billing.home.exceptions')}
          value={`${exceptions}`}
          state={exceptions > 0 ? 'danger' : 'success'}
          stateLabel={
            exceptions > 0 ? t('billing.home.needsDecision') : t('billing.home.allPosted')
          }
        />
        <VitalStat
          label={t('billing.home.patientAr')}
          value={formatMoney(ar.total, { currency: 'USD' }).text}
          state={ar.buckets.DAYS_91_PLUS > 0 ? 'danger' : 'neutral'}
          stateLabel={
            ar.buckets.DAYS_91_PLUS > 0
              ? t('billing.home.someOver90')
              : t('billing.home.accountCount', { count: ar.accounts })
          }
        />
      </section>

      <Card overline={t('billing.home.workbenches')} title={t('billing.home.whereToGo')}>
        <ul className="or-area-list">
          {AREAS.map((area) => (
            <li key={area.href} className="or-area-list__item">
              <div className="or-area-list__body">
                <p className="or-area-list__title">{t(area.titleKey)}</p>
                <p className="or-small">{t(area.descriptionKey)}</p>
              </div>
              <Button variant="ghost" size="sm" iconRight="arrow-right" href={area.href}>
                {t('billing.home.open')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card overline={t('billing.home.oldestMoney')} title={t('billing.home.agedBalances')}>
        {/* The amount leads, because `Money` speaks it properly for a screen
            reader and the sentence is about that number. The catalogue message
            is the rest of the sentence, so every language it is written in has
            to read with the money first. */}
        <p className="or-body">
          <Money amount={ar.buckets.DAYS_91_PLUS} currency="USD" emphasis />{' '}
          {t('billing.home.agedSentence', { count: ar.accounts })}{' '}
          {ar.buckets.DAYS_91_PLUS > 0 ? (
            <Badge tone="danger">{t('billing.home.workTheseFirst')}</Badge>
          ) : (
            <Badge tone="success">{t('billing.home.nothingAged')}</Badge>
          )}
        </p>
        <Button variant="secondary" href="/billing/statements">
          {t('billing.home.openStatements')}
        </Button>
      </Card>
    </AppShell>
  );
}

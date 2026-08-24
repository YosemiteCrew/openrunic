import { appCatalogue, createTranslator } from '@openrunic/i18n';
import type { Metadata } from 'next';

import {
  CtaLink,
  Hero,
  OFFSITE,
  OtherAudiences,
  PointList,
  PublicPage,
  Section,
  StatusNote,
  resolvePoints,
} from '@/components/marketing';
import type { PointKeys } from '@/components/marketing';
import { resolveLocale } from '@/lib/i18n/locale';

export const metadata: Metadata = {
  /* Left in English on purpose, along with every other route's `metadata` in
     this application: it is a static export the framework reads without a
     request, so translating it is a move to `generateMetadata` across all of
     them rather than a change to this file. */
  title: 'For hospitals and clinics',
  description:
    'The openrunic staff application covers scheduling, the flow board, the chart, orders, results and the revenue cycle, on a relational database a practice runs itself.',
};

/**
 * What the staff application contains. Every screen named here is a route in
 * this application; nothing on this list is planned work.
 */
const COVERAGE: readonly PointKeys[] = [
  {
    titleKey: 'marketing.hospitals.coverage.frontDesk.title',
    bodyKey: 'marketing.hospitals.coverage.frontDesk.body',
  },
  {
    titleKey: 'marketing.hospitals.coverage.chart.title',
    bodyKey: 'marketing.hospitals.coverage.chart.body',
  },
  {
    titleKey: 'marketing.hospitals.coverage.orders.title',
    bodyKey: 'marketing.hospitals.coverage.orders.body',
  },
  {
    titleKey: 'marketing.hospitals.coverage.revenue.title',
    bodyKey: 'marketing.hospitals.coverage.revenue.body',
  },
  {
    titleKey: 'marketing.hospitals.coverage.admin.title',
    bodyKey: 'marketing.hospitals.coverage.admin.body',
  },
];

/** What it means to run it, licence and posture rather than features. */
const OWNERSHIP: readonly PointKeys[] = [
  {
    titleKey: 'marketing.hospitals.ownership.database.title',
    bodyKey: 'marketing.hospitals.ownership.database.body',
  },
  {
    titleKey: 'marketing.hospitals.ownership.licence.title',
    bodyKey: 'marketing.hospitals.ownership.licence.body',
  },
  {
    titleKey: 'marketing.hospitals.ownership.compliance.title',
    bodyKey: 'marketing.hospitals.ownership.compliance.body',
  },
];

export default async function HospitalsPage() {
  const t = createTranslator(appCatalogue, await resolveLocale());

  return (
    <PublicPage active="/for/hospitals" t={t}>
      <Hero
        eyebrow={t('marketing.hospitals.eyebrow')}
        title={t('marketing.hospitals.title')}
        lead={t('marketing.hospitals.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              {t('marketing.link.readTheSource')}
            </CtaLink>
            <CtaLink href={OFFSITE.selfHosting}>{t('marketing.link.selfHosting')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.hospitals.status.label')}>
          {t('marketing.hospitals.status.body')}
        </StatusNote>
      </Hero>

      <Section
        id="coverage"
        title={t('marketing.hospitals.coverage.title')}
        lead={t('marketing.hospitals.coverage.lead')}
        tone="cream"
      >
        <PointList points={resolvePoints(COVERAGE, t)} />
      </Section>

      <Section
        id="ownership"
        title={t('marketing.hospitals.ownership.title')}
        lead={t('marketing.hospitals.ownership.lead')}
      >
        <PointList points={resolvePoints(OWNERSHIP, t)} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>{t('marketing.link.readCompliance')}</a>
        </p>
      </Section>

      <OtherAudiences current="/for/hospitals" t={t} />
    </PublicPage>
  );
}

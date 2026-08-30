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
} from '@/components/marketing';
import type { PointKeys } from '@/components/marketing';

/**
 * The tab and the search snippet, in the language of the page they describe.
 * `generateMetadata` rather than a constant because this page is prerendered
 * once per language, and a constant would put English on `/es`.
 */
export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = createTranslator(appCatalogue, locale);
  return {
    title: t('marketing.hospitals.metaTitle'),
    description: t('marketing.hospitals.metaDescription'),
  };
}

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

export default async function HospitalsPage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  const t = createTranslator(appCatalogue, locale);

  return (
    <PublicPage active="/for/hospitals" locale={locale}>
      <Hero
        eyebrow={t('marketing.hospitals.eyebrow')}
        title={t('marketing.hospitals.title')}
        lead={t('marketing.hospitals.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              {t('marketing.cta.readTheSource')}
            </CtaLink>
            <CtaLink href={OFFSITE.selfHosting}>{t('marketing.hospitals.selfHosting')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.hospitals.statusLabel')}>
          {t('marketing.hospitals.statusBody')}
        </StatusNote>
      </Hero>

      <Section
        id="coverage"
        title={t('marketing.hospitals.coverage.title')}
        lead={t('marketing.hospitals.coverage.lead')}
        tone="cream"
      >
        <PointList points={COVERAGE} locale={locale} />
      </Section>

      <Section
        id="ownership"
        title={t('marketing.hospitals.ownership.title')}
        lead={t('marketing.hospitals.ownership.lead')}
      >
        <PointList points={OWNERSHIP} locale={locale} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>{t('marketing.cta.compliance')}</a>
        </p>
      </Section>

      <OtherAudiences current="/for/hospitals" locale={locale} />
    </PublicPage>
  );
}

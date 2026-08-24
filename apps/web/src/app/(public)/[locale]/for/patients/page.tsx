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
    title: t('marketing.patients.metaTitle'),
    description: t('marketing.patients.metaDescription'),
  };
}

/** What the portal contains. Six routes, all of them in the repository. */
const PORTAL: readonly PointKeys[] = [
  {
    titleKey: 'marketing.patients.portal.upcoming.title',
    bodyKey: 'marketing.patients.portal.upcoming.body',
  },
  {
    titleKey: 'marketing.patients.portal.record.title',
    bodyKey: 'marketing.patients.portal.record.body',
  },
  {
    titleKey: 'marketing.patients.portal.messages.title',
    bodyKey: 'marketing.patients.portal.messages.body',
  },
];

/** Why the shape of the data matters to the person it describes. */
const OWNERSHIP: readonly PointKeys[] = [
  {
    titleKey: 'marketing.patients.ownership.standard.title',
    bodyKey: 'marketing.patients.ownership.standard.body',
  },
  {
    titleKey: 'marketing.patients.ownership.interpretation.title',
    bodyKey: 'marketing.patients.ownership.interpretation.body',
  },
  {
    titleKey: 'marketing.patients.ownership.product.title',
    bodyKey: 'marketing.patients.ownership.product.body',
  },
  {
    titleKey: 'marketing.patients.ownership.advice.title',
    bodyKey: 'marketing.patients.ownership.advice.body',
  },
];

export default async function PatientsPage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  const t = createTranslator(appCatalogue, locale);

  return (
    <PublicPage active="/for/patients" locale={locale}>
      <Hero
        eyebrow={t('marketing.patients.eyebrow')}
        title={t('marketing.patients.title')}
        lead={t('marketing.patients.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.patientPortal} variant="primary">
              {t('marketing.patients.howThePortalWorks')}
            </CtaLink>
            <CtaLink href={OFFSITE.repo}>{t('marketing.cta.readTheSource')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.patients.statusLabel')}>
          {t('marketing.patients.statusBody')}
        </StatusNote>
      </Hero>

      <Section
        id="portal"
        title={t('marketing.patients.portal.title')}
        lead={t('marketing.patients.portal.lead')}
        tone="cream"
      >
        <PointList points={PORTAL} locale={locale} />
      </Section>

      <Section
        id="ownership"
        title={t('marketing.patients.ownership.title')}
        lead={t('marketing.patients.ownership.lead')}
      >
        <PointList points={OWNERSHIP} locale={locale} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>{t('marketing.cta.compliance')}</a>
        </p>
      </Section>

      <OtherAudiences current="/for/patients" locale={locale} />
    </PublicPage>
  );
}

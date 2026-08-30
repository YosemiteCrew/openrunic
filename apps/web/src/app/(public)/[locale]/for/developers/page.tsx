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
    title: t('marketing.developers.metaTitle'),
    description: t('marketing.developers.metaDescription'),
  };
}

/** The service boundary, which is the part other people have to build against. */
const BOUNDARY: readonly PointKeys[] = [
  {
    titleKey: 'marketing.developers.boundary.conformance.title',
    bodyKey: 'marketing.developers.boundary.conformance.body',
  },
  {
    titleKey: 'marketing.developers.boundary.relational.title',
    bodyKey: 'marketing.developers.boundary.relational.body',
  },
  {
    titleKey: 'marketing.developers.boundary.middleware.title',
    bodyKey: 'marketing.developers.boundary.middleware.body',
  },
  {
    titleKey: 'marketing.developers.boundary.workspaces.title',
    bodyKey: 'marketing.developers.boundary.workspaces.body',
  },
];

/**
 * The agentic layer, summarised from ADR-0005. It is on this page rather than
 * the home page because it is default-off infrastructure, and a marketing page
 * that led with an assistant would be describing the product backwards.
 */
const AGENT: readonly PointKeys[] = [
  {
    titleKey: 'marketing.developers.agent.separable.title',
    bodyKey: 'marketing.developers.agent.separable.body',
  },
  {
    titleKey: 'marketing.developers.agent.tools.title',
    bodyKey: 'marketing.developers.agent.tools.body',
  },
  {
    titleKey: 'marketing.developers.agent.outbound.title',
    bodyKey: 'marketing.developers.agent.outbound.body',
  },
  {
    titleKey: 'marketing.developers.agent.retrieval.title',
    bodyKey: 'marketing.developers.agent.retrieval.body',
  },
];

export default async function DevelopersPage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  const t = createTranslator(appCatalogue, locale);

  return (
    <PublicPage active="/for/developers" locale={locale}>
      <Hero
        eyebrow={t('marketing.developers.eyebrow')}
        title={t('marketing.developers.title')}
        lead={t('marketing.developers.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              {t('marketing.cta.readTheSource')}
            </CtaLink>
            <CtaLink href={OFFSITE.apiDesign}>{t('marketing.developers.apiDesign')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.developers.statusLabel')}>
          {t('marketing.developers.statusBody')}
        </StatusNote>
      </Hero>

      <Section
        id="boundary"
        title={t('marketing.developers.boundary.title')}
        lead={t('marketing.developers.boundary.lead')}
        tone="cream"
      >
        <PointList points={BOUNDARY} locale={locale} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.architecture}>{t('marketing.cta.architecture')}</a>
        </p>
      </Section>

      <Section
        id="agent"
        title={t('marketing.developers.agent.title')}
        lead={t('marketing.developers.agent.lead')}
      >
        <PointList points={AGENT} locale={locale} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.decisions}>{t('marketing.developers.agent.adrLink')}</a>
        </p>
      </Section>

      <Section
        id="bar"
        title={t('marketing.developers.bar.title')}
        lead={t('marketing.developers.bar.lead')}
        tone="cream"
      >
        <div className="or-mk-hero__actions">
          <CtaLink href={OFFSITE.contributing} variant="primary">
            {t('marketing.cta.contributing')}
          </CtaLink>
          <CtaLink href={OFFSITE.goodFirstIssues}>{t('marketing.cta.goodFirstIssues')}</CtaLink>
        </div>
      </Section>

      <OtherAudiences current="/for/developers" locale={locale} tone="bone" />
    </PublicPage>
  );
}

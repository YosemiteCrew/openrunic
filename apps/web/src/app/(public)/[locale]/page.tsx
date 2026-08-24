import { appCatalogue, createTranslator } from '@openrunic/i18n';
import type { Metadata } from 'next';

import {
  CtaLink,
  Hero,
  OFFSITE,
  PILLARS,
  PillarCard,
  PointList,
  PublicPage,
  Section,
  StatusNote,
} from '@/components/marketing';
import type { PointKeys } from '@/components/marketing';

/**
 * The tab and the search snippet, in the language of the page they describe.
 *
 * `generateMetadata` rather than a `metadata` constant because these four pages
 * are prerendered once per language: a constant would put the same English
 * title on `/es`, which is the one place a wrong language is invisible to
 * whoever shipped it and obvious to whoever searched.
 *
 * The title is absolute rather than templated: "openrunic - openrunic" is what
 * the root template would produce, and this is the one page whose tab should
 * say what the project is to someone who has never heard of it.
 */
export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = createTranslator(appCatalogue, locale);
  return {
    title: { absolute: t('marketing.home.metaTitle') },
    description: t('marketing.home.metaDescription'),
  };
}

/**
 * Four decisions that shape the rest of the system. Each claim here is checked
 * against the file that makes it true: the schema for the audit chain, ADR-0002
 * for the FHIR boundary, ADR-0004 and ADR-0005 for the position on models, and
 * `docs/compliance.md` for terminology licensing.
 */
const FOUNDATIONS: readonly PointKeys[] = [
  {
    titleKey: 'marketing.home.foundations.storage.title',
    bodyKey: 'marketing.home.foundations.storage.body',
  },
  {
    titleKey: 'marketing.home.foundations.audit.title',
    bodyKey: 'marketing.home.foundations.audit.body',
  },
  {
    titleKey: 'marketing.home.foundations.privacy.title',
    bodyKey: 'marketing.home.foundations.privacy.body',
  },
  {
    titleKey: 'marketing.home.foundations.content.title',
    bodyKey: 'marketing.home.foundations.content.body',
  },
];

/**
 * The regulatory band. Every sentence here is the wording from
 * `docs/compliance.md`, shortened but never softened - in every language.
 */
const POSITION: readonly PointKeys[] = [
  {
    titleKey: 'marketing.home.position.certified.title',
    bodyKey: 'marketing.home.position.certified.body',
  },
  {
    titleKey: 'marketing.home.position.support.title',
    bodyKey: 'marketing.home.position.support.body',
  },
  {
    titleKey: 'marketing.home.position.advice.title',
    bodyKey: 'marketing.home.position.advice.body',
  },
];

export default async function HomePage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  const t = createTranslator(appCatalogue, locale);

  return (
    <PublicPage active="/" locale={locale}>
      <Hero
        eyebrow={t('marketing.home.eyebrow')}
        title={t('marketing.tagline')}
        lead={t('marketing.home.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              {t('marketing.cta.readTheSource')}
            </CtaLink>
            <CtaLink href={OFFSITE.gettingStarted}>{t('marketing.cta.gettingStarted')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.home.statusLabel')}>
          {t('marketing.home.statusBody')}
        </StatusNote>
      </Hero>

      <Section
        id="audiences"
        title={t('marketing.home.audiences.title')}
        lead={t('marketing.home.audiences.lead')}
        tone="cream"
      >
        <div className="or-mk-grid">
          {PILLARS.map((pillar) => (
            <PillarCard key={pillar.href} pillar={pillar} locale={locale} />
          ))}
        </div>
      </Section>

      <Section
        id="foundations"
        title={t('marketing.home.foundations.title')}
        lead={t('marketing.home.foundations.lead')}
      >
        <PointList points={FOUNDATIONS} locale={locale} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.decisions}>{t('marketing.cta.decisions')}</a>
        </p>
      </Section>

      <Section
        id="position"
        title={t('marketing.home.position.title')}
        lead={t('marketing.home.position.lead')}
        tone="cream"
      >
        <PointList points={POSITION} locale={locale} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>{t('marketing.cta.compliance')}</a>
        </p>
      </Section>

      <Section
        id="contribute"
        title={t('marketing.home.contribute.title')}
        lead={t('marketing.home.contribute.lead')}
      >
        <div className="or-mk-hero__actions">
          <CtaLink href={OFFSITE.contributing} variant="primary">
            {t('marketing.cta.contributing')}
          </CtaLink>
          <CtaLink href={OFFSITE.goodFirstIssues}>{t('marketing.cta.goodFirstIssues')}</CtaLink>
        </div>
      </Section>
    </PublicPage>
  );
}

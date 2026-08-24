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
  resolvePoints,
} from '@/components/marketing';
import type { PointKeys } from '@/components/marketing';
import { resolveLocale } from '@/lib/i18n/locale';

export const metadata: Metadata = {
  /* Absolute rather than templated: "openrunic - openrunic" is what the root
     template would produce, and this is the one page whose tab should say what
     the project is to someone who has never heard of it.

     Still an English literal, unlike the page below it. `metadata` is a static
     export the framework reads without a request, so translating it means
     moving every route in the app to `generateMetadata`; that is one change
     across every route rather than four, and it is tracked separately. */
  title: { absolute: 'openrunic - open-source operating system for human health' },
  description:
    'openrunic is an open-source operating system for human health, licensed AGPL-3.0-only. Its first product is a modern electronic medical record with FHIR R4 at the API boundary.',
};

/**
 * Four decisions that shape the rest of the system. Each claim here is checked
 * against the file that makes it true: the schema for the audit chain, ADR-0002
 * for the FHIR boundary, ADR-0004 and ADR-0005 for the position on models, and
 * `docs/compliance.md` for terminology licensing.
 */
const FOUNDATIONS: readonly PointKeys[] = [
  {
    titleKey: 'marketing.home.foundation.relational.title',
    bodyKey: 'marketing.home.foundation.relational.body',
  },
  {
    titleKey: 'marketing.home.foundation.audit.title',
    bodyKey: 'marketing.home.foundation.audit.body',
  },
  {
    titleKey: 'marketing.home.foundation.telemetry.title',
    bodyKey: 'marketing.home.foundation.telemetry.body',
  },
  {
    titleKey: 'marketing.home.foundation.content.title',
    bodyKey: 'marketing.home.foundation.content.body',
  },
];

/**
 * The regulatory band. Every sentence here is the wording from
 * `docs/compliance.md`, shortened but never softened - in every language, which
 * is why these three are the ones a translation review reads first.
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

/**
 * The home page.
 *
 * Asynchronous because the reader's language is resolved from the request
 * before anything renders. A public page that arrived in English and swapped to
 * Spanish once JavaScript loaded would have shown the wrong language to the
 * person least able to read it, and moved the layout under their cursor while
 * doing it.
 */
export default async function HomePage() {
  const t = createTranslator(appCatalogue, await resolveLocale());

  return (
    <PublicPage active="/" t={t}>
      <Hero
        eyebrow={t('marketing.home.eyebrow')}
        title={t('marketing.home.title')}
        lead={t('marketing.home.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              {t('marketing.link.readTheSource')}
            </CtaLink>
            <CtaLink href={OFFSITE.gettingStarted}>{t('marketing.link.gettingStarted')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.home.status.label')}>
          {t('marketing.home.status.body')}
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
            <PillarCard key={pillar.href} pillar={pillar} t={t} />
          ))}
        </div>
      </Section>

      <Section
        id="foundations"
        title={t('marketing.home.foundations.title')}
        lead={t('marketing.home.foundations.lead')}
      >
        <PointList points={resolvePoints(FOUNDATIONS, t)} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.decisions}>{t('marketing.link.readDecisions')}</a>
        </p>
      </Section>

      <Section
        id="position"
        title={t('marketing.home.position.title')}
        lead={t('marketing.home.position.lead')}
        tone="cream"
      >
        <PointList points={resolvePoints(POSITION, t)} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>{t('marketing.link.readCompliance')}</a>
        </p>
      </Section>

      <Section
        id="contribute"
        title={t('marketing.home.contribute.title')}
        lead={t('marketing.home.contribute.lead')}
      >
        <div className="or-mk-hero__actions">
          <CtaLink href={OFFSITE.contributing} variant="primary">
            {t('marketing.link.contributing')}
          </CtaLink>
          <CtaLink href={OFFSITE.goodFirstIssues}>{t('marketing.link.goodFirstIssues')}</CtaLink>
        </div>
      </Section>
    </PublicPage>
  );
}

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
  /* English, like every other route's static `metadata`. See the home page for
     why that is a repo-wide move to `generateMetadata` rather than an edit here. */
  title: 'For developers',
  description:
    'A pnpm and Turborepo monorepo on Node 22: a Hono service serving FHIR R4, a Next.js staff application and patient portal, and typed packages for the data model, mappers and design system.',
};

/** The service boundary, which is the part other people have to build against. */
const BOUNDARY: readonly PointKeys[] = [
  {
    titleKey: 'marketing.developers.boundary.fhir.title',
    bodyKey: 'marketing.developers.boundary.fhir.body',
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
    titleKey: 'marketing.developers.agent.defaultOff.title',
    bodyKey: 'marketing.developers.agent.defaultOff.body',
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

export default async function DevelopersPage() {
  const t = createTranslator(appCatalogue, await resolveLocale());

  return (
    <PublicPage active="/for/developers" t={t}>
      <Hero
        eyebrow={t('marketing.developers.eyebrow')}
        title={t('marketing.developers.title')}
        lead={t('marketing.developers.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              {t('marketing.link.readTheSource')}
            </CtaLink>
            <CtaLink href={OFFSITE.apiDesign}>{t('marketing.link.apiDesign')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.developers.status.label')}>
          {t('marketing.developers.status.body')}
        </StatusNote>
      </Hero>

      <Section
        id="boundary"
        title={t('marketing.developers.boundary.title')}
        lead={t('marketing.developers.boundary.lead')}
        tone="cream"
      >
        <PointList points={resolvePoints(BOUNDARY, t)} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.architecture}>{t('marketing.link.readArchitecture')}</a>
        </p>
      </Section>

      <Section
        id="agent"
        title={t('marketing.developers.agent.title')}
        lead={t('marketing.developers.agent.lead')}
      >
        <PointList points={resolvePoints(AGENT, t)} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.decisions}>{t('marketing.link.readAgentDecisions')}</a>
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
            {t('marketing.link.contributing')}
          </CtaLink>
          <CtaLink href={OFFSITE.goodFirstIssues}>{t('marketing.link.goodFirstIssues')}</CtaLink>
        </div>
      </Section>

      <OtherAudiences current="/for/developers" t={t} tone="bone" />
    </PublicPage>
  );
}

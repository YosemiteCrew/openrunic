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
  title: 'For patients',
  description:
    'openrunic keeps a patient record in FHIR R4, an open standard, so it can move between providers. The patient portal shows appointments, results, messages, forms and bills.',
};

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
    titleKey: 'marketing.patients.ownership.privacy.title',
    bodyKey: 'marketing.patients.ownership.privacy.body',
  },
  {
    titleKey: 'marketing.patients.ownership.advice.title',
    bodyKey: 'marketing.patients.ownership.advice.body',
  },
];

export default async function PatientsPage() {
  const t = createTranslator(appCatalogue, await resolveLocale());

  return (
    <PublicPage active="/for/patients" t={t}>
      <Hero
        eyebrow={t('marketing.patients.eyebrow')}
        title={t('marketing.patients.title')}
        lead={t('marketing.patients.lead')}
        actions={
          <>
            <CtaLink href={OFFSITE.patientPortal} variant="primary">
              {t('marketing.link.patientPortal')}
            </CtaLink>
            <CtaLink href={OFFSITE.repo}>{t('marketing.link.readTheSource')}</CtaLink>
          </>
        }
      >
        <StatusNote label={t('marketing.patients.status.label')}>
          {t('marketing.patients.status.body')}
        </StatusNote>
      </Hero>

      <Section
        id="portal"
        title={t('marketing.patients.portal.title')}
        lead={t('marketing.patients.portal.lead')}
        tone="cream"
      >
        <PointList points={resolvePoints(PORTAL, t)} />
      </Section>

      <Section
        id="ownership"
        title={t('marketing.patients.ownership.title')}
        lead={t('marketing.patients.ownership.lead')}
      >
        <PointList points={resolvePoints(OWNERSHIP, t)} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>{t('marketing.link.readCompliance')}</a>
        </p>
      </Section>

      <OtherAudiences current="/for/patients" t={t} />
    </PublicPage>
  );
}

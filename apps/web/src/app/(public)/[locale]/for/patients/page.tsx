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
import type { Point } from '@/components/marketing';

export const metadata: Metadata = {
  title: 'For patients',
  description:
    'openrunic keeps a patient record in FHIR R4, an open standard, so it can move between providers. The patient portal shows appointments, results, messages, forms and bills.',
};

/** What the portal contains. Six routes, all of them in the repository. */
const PORTAL: readonly Point[] = [
  {
    title: 'What is coming up, and what needs you',
    body: 'The home screen answers the two questions a patient actually opens a portal with: what is next, and is anything waiting on me. Appointments, upcoming and past, sit on their own screen.',
  },
  {
    title: 'Your health record, in words',
    body: 'Results, conditions, medicines, allergies, vaccinations and documents. A coded term never appears on its own: the plain-language wording sits beside it, so a diagnosis code is read as the thing it means. A measured value never appears on its own either, but with its unit, its usual range and a labelled verdict.',
  },
  {
    title: 'Messages, forms and bills',
    body: 'Secure messaging with the practice, intake and consent forms to complete, and balances and statements. A result you do not understand opens a way to ask about it rather than leaving you to find the message box yourself.',
  },
];

/** Why the shape of the data matters to the person it describes. */
const OWNERSHIP: readonly Point[] = [
  {
    title: 'An open standard at the boundary',
    body: 'The service speaks FHIR R4, the interoperability standard the regulatory work in both the United States and the European Union is written around. A record kept that way can be read by any other system that speaks it, which is the difference between holding your data and holding a printout of it.',
  },
  {
    title: 'Nothing is interpreted for you',
    body: 'The project has already decided, in writing and before building the feature, that plain-language wording comes from a curated mapping of the codes already in your record, and never from a model deciding what a value means for you. Software here explains a term. It does not tell you how worried to be.',
  },
  {
    title: 'You are not the product',
    body: 'openrunic transmits nothing to the project or its maintainers. There is no analytics pipeline reading a chart, and the project has committed that any future telemetry must be opt-in, documented, and structurally incapable of carrying health data.',
  },
  {
    title: 'It is not medical advice',
    body: 'openrunic is not a medical device and is not certified by any regulator. It is not intended to provide medical advice, diagnosis or treatment recommendations. Clinical decisions belong to qualified healthcare professionals, and the portal is built to make asking one easier rather than to stand in for one.',
  },
];

export default async function PatientsPage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  return (
    <PublicPage active="/for/patients" locale={locale}>
      <Hero
        eyebrow="For patients"
        title="Your record, in a format that can leave"
        lead="A health record is worth having only if it can follow you. openrunic keeps one in an open standard rather than a private format, and gives you a portal to read it in language written for a person rather than a chart."
        actions={
          <>
            <CtaLink href={OFFSITE.patientPortal} variant="primary">
              How the portal works
            </CtaLink>
            <CtaLink href={OFFSITE.repo}>Read the source</CtaLink>
          </>
        }
      >
        <StatusNote label="What this means today">
          There is nothing here to sign up for. openrunic is pre-alpha software with no releases,
          and whether you ever use it depends on a practice choosing to run it. This page describes
          how the project is built, not a service you can join.
        </StatusNote>
      </Hero>

      <Section
        id="portal"
        title="What the portal shows"
        lead="Three things, on six screens, all of them in the repository today."
        tone="cream"
      >
        <PointList points={PORTAL} />
      </Section>

      <Section
        id="ownership"
        title="Why the format matters"
        lead="The decisions behind the screens, which are the part that outlasts any particular design."
      >
        <PointList points={OWNERSHIP} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>Read the full regulatory posture</a>
        </p>
      </Section>

      <OtherAudiences current="/for/patients" />
    </PublicPage>
  );
}

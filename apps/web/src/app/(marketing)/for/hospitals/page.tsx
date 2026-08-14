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
  title: 'For hospitals and clinics',
  description:
    'The openrunic staff application covers scheduling, the flow board, the chart, orders, results and the revenue cycle, on a relational database a practice runs itself.',
};

/**
 * What the staff application contains. Every screen named here is a route in
 * this application; nothing on this list is planned work.
 */
const COVERAGE: readonly Point[] = [
  {
    title: 'The front desk',
    body: 'A day view with provider columns and a live now rule, a day pager, an available-slot finder, booking and check-in. Beside it, a flow board with five status columns, two clocks per patient, one-click status advance, room assignment, and filters for provider, room and delayed-only.',
  },
  {
    title: 'The chart',
    body: 'Patient search across given, family and preferred name and medical record number, with saved views phrased as questions. Registration runs duplicate detection while the name is typed and blocks a save on a strong match rather than letting someone click through it twice. Coverage and eligibility sit on their own screen, and the encounter note carries a signature block.',
  },
  {
    title: 'Orders and results',
    body: 'Order composition with specimen handling and warnings raised before the order is placed, a worklist that surfaces the orders that have stopped moving, and results with flags, readings and sign-off.',
  },
  {
    title: 'The revenue cycle',
    body: 'Charge capture linked to diagnoses, a claim workbench with scrubbing before submission, remittance posting with its exceptions, statements and ageing, and payment allocation with receipts.',
  },
  {
    title: 'Administration',
    body: 'Users and roles on a permission matrix, facilities, a form builder, partner integrations, a developer platform surface, and the audit trail as a screen a practice can read rather than a table only an engineer can query.',
  },
];

/** What it means to run it, licence and posture rather than features. */
const OWNERSHIP: readonly Point[] = [
  {
    title: 'Your database, and no export to request',
    body: 'The relational schema is the source of truth and it is in the repository, so a practice can read its own records with ordinary tools. There is no proprietary storage format sitting between a clinic and its data, and nobody to ask for a copy of it.',
  },
  {
    title: 'No per-seat licence, and no held-back edition',
    body: 'AGPL-3.0-only. Adding a clinician does not add a bill, and there is no paid tier where the useful features live. The licence does oblige you the other way: run a modified version as a network service and you must offer its source to its users.',
  },
  {
    title: 'Compliance stays yours, and the software is shaped for that',
    body: 'openrunic is not certified and cannot make a deployment compliant. What it does is make the work possible: security-relevant actions are recorded as a core feature rather than a bolt-on, access is designed around granting the minimum a role needs, and the whole system can run on hardware the practice controls.',
  },
];

export default function HospitalsPage() {
  return (
    <PublicPage active="/for/hospitals">
      <Hero
        eyebrow="For hospitals and clinics"
        title="Run the clinical day on software you control"
        lead="One application covering the day a practice actually has: the schedule and the flow board, the chart, the inbox, orders and results, and the revenue cycle from charge capture through remittance. Not a suite of modules sold separately."
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              Read the source
            </CtaLink>
            <CtaLink href={OFFSITE.selfHosting}>How self-hosting will work</CtaLink>
          </>
        }
      >
        <StatusNote label="What you can run today">
          Not a clinic, honestly. There are no releases, no published container images and no
          install documentation; self-host packaging is being built and is not finished. What exists
          is source you can read, and a development server that runs the whole staff application
          against deterministic synthetic fixtures without a database.
        </StatusNote>
      </Hero>

      <Section
        id="coverage"
        title="What the application covers"
        lead="Five areas, all of them screens in the repository today rather than roadmap items."
        tone="cream"
      >
        <PointList points={COVERAGE} />
      </Section>

      <Section
        id="ownership"
        title="What running it yourself means"
        lead="The parts that are about ownership and obligation rather than features."
      >
        <PointList points={OWNERSHIP} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>Read the full regulatory posture</a>
        </p>
      </Section>

      <OtherAudiences current="/for/hospitals" />
    </PublicPage>
  );
}

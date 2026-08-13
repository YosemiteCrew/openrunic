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
import type { Point } from '@/components/marketing';

export const metadata: Metadata = {
  /* Absolute rather than templated: "openrunic - openrunic" is what the root
     template would produce, and this is the one page whose tab should say what
     the project is to someone who has never heard of it. */
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
const FOUNDATIONS: readonly Point[] = [
  {
    title: 'Relational storage, FHIR at the edge',
    body: 'PostgreSQL through Prisma is the single source of truth. FHIR R4 serialisation happens at the API boundary, and every mapped resource carries round-trip tests. The conformance statement is generated from the same registry the router serves, so the server advertises only the search parameters it can actually answer.',
  },
  {
    title: 'Audit is structural, not additive',
    body: 'The audit event was the first model in the schema and the first migration in the repository. A request reaches a record through a repository that cannot run without an audit collector, so leaving a trail is not a thing a handler can forget. Events form a per-tenant hash chain, which makes tampering with history detectable rather than merely discouraged.',
  },
  {
    title: 'Nothing phones home',
    body: 'openrunic transmits nothing to the project, its maintainers, or any third party the project chose. A deployer may configure an external inference endpoint for the optional assistant; if they do, the data goes to a processor they contracted with, under an agreement they hold, and the product states that plainly at configuration time.',
  },
  {
    title: 'No vendored content, no bundled models',
    body: 'Clinical terminology is licence-restricted and is never committed to the repository: each deployment loads only what it is licensed for. The same rule covers model weights. No machine-learning runtime ships inside the deployment, and the optional assistant is off by default, calls an endpoint the deployer names, and is never on a clinical path.',
  },
];

/**
 * The regulatory band. Every sentence here is the wording from
 * `docs/compliance.md`, shortened but never softened.
 */
const POSITION: readonly Point[] = [
  {
    title: 'openrunic is not certified for anything',
    body: 'It is not a medical device, and it is not a certified EHR. It holds no clearance or approval from any regulator, and none is implied. It is not HIPAA-compliant or GDPR-compliant out of the box, because compliance is a property of a deployment - its organisation, its agreements, its configuration and its jurisdiction - and never of source code by itself.',
  },
  {
    title: 'What it is designed to support',
    body: 'The audit trail, the least-privilege access design, and the fact that a practice can run the whole system on hardware it controls are built so that a competent deployer can build a compliant deployment on top of them. They support that work. They do not perform it, and shipping them makes no deployment compliant.',
  },
  {
    title: 'It gives no medical advice',
    body: 'openrunic is not intended to provide medical advice, diagnosis or treatment recommendations, and no part of it interprets a clinical value for a patient or ranks anything by clinical risk. Clinical decisions are the responsibility of qualified healthcare professionals.',
  },
];

export default function HomePage() {
  return (
    <PublicPage active="/">
      <Hero
        eyebrow="Open source, AGPL-3.0-only"
        title="Open-source operating system for human health"
        lead="The first product is a modern, lightweight electronic medical record: registration, scheduling, encounters, orders, results and the revenue cycle, with FHIR R4 at the API boundary and an audit trail that was the first model in the schema."
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              Read the source
            </CtaLink>
            <CtaLink href={OFFSITE.gettingStarted}>Getting started</CtaLink>
          </>
        }
      >
        <StatusNote label="Where the project is">
          Pre-alpha. There are no releases and no published container images, APIs and schemas
          change without notice, and no part of this is ready for a live practice. Do not put real
          patient data into it.
        </StatusNote>
      </Hero>

      <Section
        id="audiences"
        title="Three audiences"
        lead="The project is organised around three groups of people, and every surface belongs to one of them."
        tone="cream"
      >
        <div className="or-mk-grid">
          {PILLARS.map((pillar) => (
            <PillarCard key={pillar.href} pillar={pillar} />
          ))}
        </div>
      </Section>

      <Section
        id="foundations"
        title="How it is built"
        lead="Four decisions that shape everything else. The reasoning behind each, including what was rejected, is written down in the repository."
      >
        <PointList points={FOUNDATIONS} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.decisions}>Read the architecture decision records</a>
        </p>
      </Section>

      <Section
        id="position"
        title="What openrunic does not claim"
        lead="Healthcare software attracts confident language. This is the part of the site where being accurate matters more than being persuasive."
        tone="cream"
      >
        <PointList points={POSITION} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.compliance}>Read the full regulatory posture</a>
        </p>
      </Section>

      <Section
        id="contribute"
        title="Read it, run it, change it"
        lead="AGPL-3.0-only, with no open-core edition holding features back. If you run a modified version as a network service, the licence requires you to offer its source to your users."
      >
        <div className="or-mk-hero__actions">
          <CtaLink href={OFFSITE.contributing} variant="primary">
            Contributing guide
          </CtaLink>
          <CtaLink href={OFFSITE.goodFirstIssues}>Good first issues</CtaLink>
        </div>
      </Section>
    </PublicPage>
  );
}

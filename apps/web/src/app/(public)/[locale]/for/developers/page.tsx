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
  title: 'For developers',
  description:
    'A pnpm and Turborepo monorepo on Node 22: a Hono service serving FHIR R4, a Next.js staff application and patient portal, and typed packages for the data model, mappers and design system.',
};

/** The service boundary, which is the part other people have to build against. */
const BOUNDARY: readonly Point[] = [
  {
    title: 'FHIR R4, advertising only what it can answer',
    body: 'The conformance statement is generated from the same registry the router serves, so it cannot drift from the implementation. A search parameter appears only when the repository behind it can really answer it, and a coded parameter only when the domain enum and the FHIR value set agree one for one. Where a mapping would lose information, the parameter is absent and the loss is visible rather than hidden behind a filter that half works.',
  },
  {
    title: 'Relational underneath, FHIR at the edge',
    body: 'PostgreSQL through Prisma is the source of truth; FHIR is a projection at the boundary, and every mapper ships with round-trip tests. That is the trade recorded in the second architecture decision: a smaller search surface at the edge, bought with a schema that ordinary SQL and ordinary tooling can reason about.',
  },
  {
    title: 'One middleware chain, in one order',
    body: 'A request identifier, then authentication, then tenant scoping, then policy, then audit. Repositories are handed a request-scoped audit collector and cannot run without one, so tenant isolation and access accounting are properties of the chain rather than things each handler remembers. Failures come back as problem documents, so an error is parseable rather than a string.',
  },
  {
    title: 'Typed workspaces, not one application with folders',
    body: 'Shared types, the FHIR mappers, the Prisma schema and client, the design-system component library, and domain packages for the electronic claim transaction sets, the form engine, bring-your-own terminology and versioned partner adapters. Each has its own tests and its own boundary.',
  },
];

/**
 * The agentic layer, summarised from ADR-0005. It is on this page rather than
 * the home page because it is default-off infrastructure, and a marketing page
 * that led with an assistant would be describing the product backwards.
 */
const AGENT: readonly Point[] = [
  {
    title: 'Default off, and genuinely separable',
    body: 'The assistant is a separate container the default invocation does not start. Every capability it can reach has a deterministic path in the interface, so an outage at whatever endpoint a deployer configured costs a clinic its assistant and nothing else. A configuration with no model is a first-class test target, not an afterthought.',
  },
  {
    title: 'Tools are ordinary API clients',
    body: 'No tool receives a database client. Tools call the same HTTP API carrying the credentials of the person who asked, so tenant scoping, policy checks and audit writes are enforced by the middleware that already exists rather than by a second implementation that can drift from it.',
  },
  {
    title: 'It cannot talk to the outside',
    body: 'There is no outbound-communication tool of any kind: no email, no message, no webhook, no URL fetch. Access to private records plus exposure to untrusted text plus the ability to send things out is the combination worth designing against, and the third one is made structurally impossible rather than merely disallowed.',
  },
  {
    title: 'Retrieval, not generation, for clinical content',
    body: 'A sentence that cannot carry a citation to a record row and field is not emitted, and that is enforced by a resolver in code rather than by prompting. No weights, no Python and no inference ship inside the deployment. A remote endpoint is named, configured and paid for by the deployer, and starting one takes a separate acknowledgement naming the agreement it runs under.',
  },
];

export default async function DevelopersPage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  return (
    <PublicPage active="/for/developers" locale={locale}>
      <Hero
        eyebrow="For developers"
        title="An open platform with the boundary written down"
        lead="A pnpm and Turborepo monorepo on Node 22: a Hono service serving FHIR R4, a Next.js staff application and patient portal, and typed packages for the data model, the mappers and the design system. Every significant decision, and what it rejected, is an architecture decision record in the repository."
        actions={
          <>
            <CtaLink href={OFFSITE.repo} variant="primary">
              Read the source
            </CtaLink>
            <CtaLink href={OFFSITE.apiDesign}>API design</CtaLink>
          </>
        }
      >
        <StatusNote label="Stability">
          Pre-alpha, and the version numbers say so. Nothing is published to a registry, there are
          no releases, and APIs, schemas and package boundaries change without notice. Build against
          it to learn from it or to contribute, not to ship on it.
        </StatusNote>
      </Hero>

      <Section
        id="boundary"
        title="The service boundary"
        lead="What another system has to talk to, and the rules it holds itself to."
        tone="cream"
      >
        <PointList points={BOUNDARY} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.architecture}>Read the architecture overview</a>
        </p>
      </Section>

      <Section
        id="agent"
        title="The optional agentic layer"
        lead="An assistant exists, it is off unless a deployer turns it on, and the constraints on it were written before it was built."
      >
        <PointList points={AGENT} />
        <p className="or-small or-mk-section__aside">
          <a href={OFFSITE.decisions}>
            Read ADR-0004 and ADR-0005, which set and then narrowly amend these rules
          </a>
        </p>
      </Section>

      <Section
        id="bar"
        title="The bar a change has to clear"
        lead="Every pull request is analysed for coverage, code quality, known vulnerabilities, leaked secrets, dependency licences and supply-chain provenance. Nothing merges on a green tick alone: the bar is a clean board."
        tone="cream"
      >
        <div className="or-mk-hero__actions">
          <CtaLink href={OFFSITE.contributing} variant="primary">
            Contributing guide
          </CtaLink>
          <CtaLink href={OFFSITE.goodFirstIssues}>Good first issues</CtaLink>
        </div>
      </Section>

      <OtherAudiences current="/for/developers" tone="bone" />
    </PublicPage>
  );
}

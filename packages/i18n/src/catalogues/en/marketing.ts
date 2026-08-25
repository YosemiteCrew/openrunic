import type { Messages } from '../../catalogue.js';

/**
 * The public pages. Safe to translate: nothing here is clinical.
 *
 * These four pages are prerendered once per language, so a key missing from a
 * language is a paragraph of English in the middle of a Spanish page rather
 * than something a reader can switch away from. That is the reason the whole
 * body copy is here and not only the headings.
 *
 * The regulatory sentences - not certified, not a medical device, compliance is
 * a property of a deployment - are translated but never softened. They are the
 * claims the pages exist to keep honest, and a translation that hedges one is a
 * defect rather than a wording preference.
 *
 * See `../en/index.ts` for how the areas compose and why they are separate
 * files.
 */
export const marketing: Messages = {
  'marketing.tagline': 'Open-source operating system for human health',

  /* The masthead and the closing band. */
  'marketing.header.home': 'openrunic home',
  'marketing.header.siteNav': 'Site',
  'marketing.source': 'Source',
  'marketing.nav.hospitals': 'Hospitals',
  'marketing.nav.patients': 'Patients',
  'marketing.nav.developers': 'Developers',

  'marketing.footer.note':
    'An open-source operating system for human health, built by Yosemite Crew. Pre-alpha: there are no releases yet.',
  'marketing.footer.project': 'Project',
  'marketing.footer.documentation': 'Documentation',
  'marketing.footer.architecture': 'Architecture',
  'marketing.footer.roadmap': 'Roadmap',
  'marketing.footer.contribute': 'Contribute',
  'marketing.footer.discussions': 'Discussions',
  'marketing.footer.conduct': 'Code of conduct',
  'marketing.footer.governance': 'Governance',
  'marketing.footer.licence': 'Licence: AGPL-3.0-only',
  'marketing.footer.compliance': 'Regulatory posture',
  'marketing.footer.security': 'Security policy',
  'marketing.footer.decisions': 'Architecture decisions',
  'marketing.footer.notDevice':
    'openrunic is open-source software, not a certified medical device.',
  'marketing.footer.copyright':
    'Copyright (C) 2026 openrunic contributors. Licensed under AGPL-3.0-only.',

  /* Calls to action, shared across the four pages. */
  'marketing.cta.readTheSource': 'Read the source',
  'marketing.cta.gettingStarted': 'Getting started',
  'marketing.cta.contributing': 'Contributing guide',
  'marketing.cta.goodFirstIssues': 'Good first issues',
  'marketing.cta.compliance': 'Read the full regulatory posture',
  'marketing.cta.decisions': 'Read the architecture decision records',
  'marketing.cta.architecture': 'Read the architecture overview',

  /* The three audiences. Each card's link is one message rather than a word
     joined to the card's title: "openrunic for" plus a noun is a sentence, and
     a sentence assembled from pieces cannot be reordered by a translator. */
  'marketing.pillar.hospitals.title': 'Hospitals and clinics',
  'marketing.pillar.hospitals.summary':
    'Run scheduling, charts, orders, results and billing on software your practice controls, on a database you can read.',
  'marketing.pillar.hospitals.point1':
    'A staff application covering the clinical day, from the schedule to the claim',
  'marketing.pillar.hospitals.point2':
    'Postgres you own, with no per-seat licence and no vendor holding the export',
  'marketing.pillar.hospitals.point3':
    'An audit trail the repositories cannot serve a record without writing to',
  'marketing.pillar.hospitals.link': 'openrunic for hospitals and clinics',

  'marketing.pillar.patients.title': 'Patients',
  'marketing.pillar.patients.summary':
    'Your record belongs to you. openrunic keeps it in an open standard so it can travel with you between providers.',
  'marketing.pillar.patients.point1':
    'A portal for appointments, results, messages, forms and bills',
  'marketing.pillar.patients.point2':
    'FHIR R4 at the boundary, so the record is not locked in a private format',
  'marketing.pillar.patients.point3': 'No interpretation of your results by software, by design',
  'marketing.pillar.patients.link': 'openrunic for patients',

  'marketing.pillar.developers.title': 'Developers',
  'marketing.pillar.developers.summary':
    'An open platform with a typed monorepo, a generated FHIR conformance statement and no edition holding features back.',
  'marketing.pillar.developers.point1':
    'FHIR R4 at the service boundary, advertising only what it can answer',
  'marketing.pillar.developers.point2':
    'Typed workspace packages for FHIR mapping, the data model and the UI',
  'marketing.pillar.developers.point3':
    'AGPL-3.0-only, no open core, decisions recorded as ADRs in the repository',
  'marketing.pillar.developers.link': 'openrunic for developers',

  'marketing.otherAudiences.title': 'The other audiences',
  'marketing.otherAudiences.lead':
    'The same system, described for the people on the other side of it.',

  /* The home page. */
  'marketing.home.metaTitle': 'openrunic - open-source operating system for human health',
  'marketing.home.metaDescription':
    'openrunic is an open-source operating system for human health, licensed AGPL-3.0-only. Its first product is a modern electronic medical record with FHIR R4 at the API boundary.',
  'marketing.home.eyebrow': 'Open source, AGPL-3.0-only',
  'marketing.home.lead':
    'The first product is a modern, lightweight electronic medical record: registration, scheduling, encounters, orders, results and the revenue cycle, with FHIR R4 at the API boundary and an audit trail that was the first model in the schema.',
  'marketing.home.statusLabel': 'Where the project is',
  'marketing.home.statusBody':
    'Pre-alpha. There are no releases and no published container images, APIs and schemas change without notice, and no part of this is ready for a live practice. Do not put real patient data into it.',

  'marketing.home.audiences.title': 'Three audiences',
  'marketing.home.audiences.lead':
    'The project is organised around three groups of people, and every surface belongs to one of them.',

  'marketing.home.foundations.title': 'How it is built',
  'marketing.home.foundations.lead':
    'Four decisions that shape everything else. The reasoning behind each, including what was rejected, is written down in the repository.',
  'marketing.home.foundations.storage.title': 'Relational storage, FHIR at the edge',
  'marketing.home.foundations.storage.body':
    'PostgreSQL through Prisma is the single source of truth. FHIR R4 serialisation happens at the API boundary, and every mapped resource carries round-trip tests. The conformance statement is generated from the same registry the router serves, so the server advertises only the search parameters it can actually answer.',
  'marketing.home.foundations.audit.title': 'Audit is structural, not additive',
  'marketing.home.foundations.audit.body':
    'The audit event was the first model in the schema and the first migration in the repository. A request reaches a record through a repository that cannot run without an audit collector, so leaving a trail is not a thing a handler can forget. Events form a per-tenant hash chain, which makes tampering with history detectable rather than merely discouraged.',
  'marketing.home.foundations.privacy.title': 'Nothing phones home',
  'marketing.home.foundations.privacy.body':
    'openrunic transmits nothing to the project, its maintainers, or any third party the project chose. A deployer may configure an external inference endpoint for the optional assistant; if they do, the data goes to a processor they contracted with, under an agreement they hold, and the product states that plainly at configuration time.',
  'marketing.home.foundations.content.title': 'No vendored content, no bundled models',
  'marketing.home.foundations.content.body':
    'Clinical terminology is licence-restricted and is never committed to the repository: each deployment loads only what it is licensed for. The same rule covers model weights. No machine-learning runtime ships inside the deployment, and the optional assistant is off by default, calls an endpoint the deployer names, and is never on a clinical path.',

  'marketing.home.position.title': 'What openrunic does not claim',
  'marketing.home.position.lead':
    'Healthcare software attracts confident language. This is the part of the site where being accurate matters more than being persuasive.',
  'marketing.home.position.certified.title': 'openrunic is not certified for anything',
  'marketing.home.position.certified.body':
    'It is not a medical device, and it is not a certified EHR. It holds no clearance or approval from any regulator, and none is implied. It is not HIPAA-compliant or GDPR-compliant out of the box, because compliance is a property of a deployment - its organisation, its agreements, its configuration and its jurisdiction - and never of source code by itself.',
  'marketing.home.position.support.title': 'What it is designed to support',
  'marketing.home.position.support.body':
    'The audit trail, the least-privilege access design, and the fact that a practice can run the whole system on hardware it controls are built so that a competent deployer can build a compliant deployment on top of them. They support that work. They do not perform it, and shipping them makes no deployment compliant.',
  'marketing.home.position.advice.title': 'It gives no medical advice',
  'marketing.home.position.advice.body':
    'openrunic is not intended to provide medical advice, diagnosis or treatment recommendations, and no part of it interprets a clinical value for a patient or ranks anything by clinical risk. Clinical decisions are the responsibility of qualified healthcare professionals.',

  'marketing.home.contribute.title': 'Read it, run it, change it',
  'marketing.home.contribute.lead':
    'AGPL-3.0-only, with no open-core edition holding features back. If you run a modified version as a network service, the licence requires you to offer its source to your users.',

  /* For hospitals and clinics. */
  'marketing.hospitals.metaTitle': 'For hospitals and clinics',
  'marketing.hospitals.metaDescription':
    'The openrunic staff application covers scheduling, the flow board, the chart, orders, results and the revenue cycle, on a relational database a practice runs itself.',
  'marketing.hospitals.eyebrow': 'For hospitals and clinics',
  'marketing.hospitals.title': 'Run the clinical day on software you control',
  'marketing.hospitals.lead':
    'One application covering the day a practice actually has: the schedule and the flow board, the chart, the inbox, orders and results, and the revenue cycle from charge capture through remittance. Not a suite of modules sold separately.',
  'marketing.hospitals.selfHosting': 'How self-hosting will work',
  'marketing.hospitals.statusLabel': 'What you can run today',
  'marketing.hospitals.statusBody':
    'Not a clinic, honestly. There are no releases, no published container images and no install documentation; self-host packaging is being built and is not finished. What exists is source you can read, and a development server that runs the whole staff application against deterministic synthetic fixtures without a database.',
  'marketing.hospitals.coverage.title': 'What the application covers',
  'marketing.hospitals.coverage.lead':
    'Five areas, all of them screens in the repository today rather than roadmap items.',
  'marketing.hospitals.coverage.frontDesk.title': 'The front desk',
  'marketing.hospitals.coverage.frontDesk.body':
    'A day view with provider columns and a live now rule, a day pager, an available-slot finder, booking and check-in. Beside it, a flow board with five status columns, two clocks per patient, one-click status advance, room assignment, and filters for provider, room and delayed-only.',
  'marketing.hospitals.coverage.chart.title': 'The chart',
  'marketing.hospitals.coverage.chart.body':
    'Patient search across given, family and preferred name and medical record number, with saved views phrased as questions. Registration runs duplicate detection while the name is typed and blocks a save on a strong match rather than letting someone click through it twice. Coverage and eligibility sit on their own screen, and the encounter note carries a signature block.',
  'marketing.hospitals.coverage.orders.title': 'Orders and results',
  'marketing.hospitals.coverage.orders.body':
    'Order composition with specimen handling and warnings raised before the order is placed, a worklist that surfaces the orders that have stopped moving, and results with flags, readings and sign-off.',
  'marketing.hospitals.coverage.revenue.title': 'The revenue cycle',
  'marketing.hospitals.coverage.revenue.body':
    'Charge capture linked to diagnoses, a claim workbench with scrubbing before submission, remittance posting with its exceptions, statements and ageing, and payment allocation with receipts.',
  'marketing.hospitals.coverage.admin.title': 'Administration',
  'marketing.hospitals.coverage.admin.body':
    'Users and roles on a permission matrix, facilities, a form builder, partner integrations, a developer platform surface, and the audit trail as a screen a practice can read rather than a table only an engineer can query.',
  'marketing.hospitals.ownership.title': 'What running it yourself means',
  'marketing.hospitals.ownership.lead':
    'The parts that are about ownership and obligation rather than features.',
  'marketing.hospitals.ownership.database.title': 'Your database, and no export to request',
  'marketing.hospitals.ownership.database.body':
    'The relational schema is the source of truth and it is in the repository, so a practice can read its own records with ordinary tools. There is no proprietary storage format sitting between a clinic and its data, and nobody to ask for a copy of it.',
  'marketing.hospitals.ownership.licence.title': 'No per-seat licence, and no held-back edition',
  'marketing.hospitals.ownership.licence.body':
    'AGPL-3.0-only. Adding a clinician does not add a bill, and there is no paid tier where the useful features live. The licence does oblige you the other way: run a modified version as a network service and you must offer its source to its users.',
  'marketing.hospitals.ownership.compliance.title':
    'Compliance stays yours, and the software is shaped for that',
  'marketing.hospitals.ownership.compliance.body':
    'openrunic is not certified and cannot make a deployment compliant. What it does is make the work possible: security-relevant actions are recorded as a core feature rather than a bolt-on, access is designed around granting the minimum a role needs, and the whole system can run on hardware the practice controls.',

  /* For patients. */
  'marketing.patients.metaTitle': 'For patients',
  'marketing.patients.metaDescription':
    'openrunic keeps a patient record in FHIR R4, an open standard, so it can move between providers. The patient portal shows appointments, results, messages, forms and bills.',
  'marketing.patients.eyebrow': 'For patients',
  'marketing.patients.title': 'Your record, in a format that can leave',
  'marketing.patients.lead':
    'A health record is worth having only if it can follow you. openrunic keeps one in an open standard rather than a private format, and gives you a portal to read it in language written for a person rather than a chart.',
  'marketing.patients.howThePortalWorks': 'How the portal works',
  'marketing.patients.statusLabel': 'What this means today',
  'marketing.patients.statusBody':
    'There is nothing here to sign up for. openrunic is pre-alpha software with no releases, and whether you ever use it depends on a practice choosing to run it. This page describes how the project is built, not a service you can join.',
  'marketing.patients.portal.title': 'What the portal shows',
  'marketing.patients.portal.lead':
    'Three things, on six screens, all of them in the repository today.',
  'marketing.patients.portal.upcoming.title': 'What is coming up, and what needs you',
  'marketing.patients.portal.upcoming.body':
    'The home screen answers the two questions a patient actually opens a portal with: what is next, and is anything waiting on me. Appointments, upcoming and past, sit on their own screen.',
  'marketing.patients.portal.record.title': 'Your health record, in words',
  'marketing.patients.portal.record.body':
    'Results, conditions, medicines, allergies, vaccinations and documents. A coded term never appears on its own: the plain-language wording sits beside it, so a diagnosis code is read as the thing it means. A measured value never appears on its own either, but with its unit, its usual range and a labelled verdict.',
  'marketing.patients.portal.messages.title': 'Messages, forms and bills',
  'marketing.patients.portal.messages.body':
    'Secure messaging with the practice, intake and consent forms to complete, and balances and statements. A result you do not understand opens a way to ask about it rather than leaving you to find the message box yourself.',
  'marketing.patients.ownership.title': 'Why the format matters',
  'marketing.patients.ownership.lead':
    'The decisions behind the screens, which are the part that outlasts any particular design.',
  'marketing.patients.ownership.standard.title': 'An open standard at the boundary',
  'marketing.patients.ownership.standard.body':
    'The service speaks FHIR R4, the interoperability standard the regulatory work in both the United States and the European Union is written around. A record kept that way can be read by any other system that speaks it, which is the difference between holding your data and holding a printout of it.',
  'marketing.patients.ownership.interpretation.title': 'Nothing is interpreted for you',
  'marketing.patients.ownership.interpretation.body':
    'The project has already decided, in writing and before building the feature, that plain-language wording comes from a curated mapping of the codes already in your record, and never from a model deciding what a value means for you. Software here explains a term. It does not tell you how worried to be.',
  'marketing.patients.ownership.product.title': 'You are not the product',
  'marketing.patients.ownership.product.body':
    'openrunic transmits nothing to the project or its maintainers. There is no analytics pipeline reading a chart, and the project has committed that any future telemetry must be opt-in, documented, and structurally incapable of carrying health data.',
  'marketing.patients.ownership.advice.title': 'It is not medical advice',
  'marketing.patients.ownership.advice.body':
    'openrunic is not a medical device and is not certified by any regulator. It is not intended to provide medical advice, diagnosis or treatment recommendations. Clinical decisions belong to qualified healthcare professionals, and the portal is built to make asking one easier rather than to stand in for one.',

  /* For developers. */
  'marketing.developers.metaTitle': 'For developers',
  'marketing.developers.metaDescription':
    'A pnpm and Turborepo monorepo on Node 22: a Hono service serving FHIR R4, a Next.js staff application and patient portal, and typed packages for the data model, mappers and design system.',
  'marketing.developers.eyebrow': 'For developers',
  'marketing.developers.title': 'An open platform with the boundary written down',
  'marketing.developers.lead':
    'A pnpm and Turborepo monorepo on Node 22: a Hono service serving FHIR R4, a Next.js staff application and patient portal, and typed packages for the data model, the mappers and the design system. Every significant decision, and what it rejected, is an architecture decision record in the repository.',
  'marketing.developers.apiDesign': 'API design',
  'marketing.developers.statusLabel': 'Stability',
  'marketing.developers.statusBody':
    'Pre-alpha, and the version numbers say so. Nothing is published to a registry, there are no releases, and APIs, schemas and package boundaries change without notice. Build against it to learn from it or to contribute, not to ship on it.',
  'marketing.developers.boundary.title': 'The service boundary',
  'marketing.developers.boundary.lead':
    'What another system has to talk to, and the rules it holds itself to.',
  'marketing.developers.boundary.conformance.title': 'FHIR R4, advertising only what it can answer',
  'marketing.developers.boundary.conformance.body':
    'The conformance statement is generated from the same registry the router serves, so it cannot drift from the implementation. A search parameter appears only when the repository behind it can really answer it, and a coded parameter only when the domain enum and the FHIR value set agree one for one. Where a mapping would lose information, the parameter is absent and the loss is visible rather than hidden behind a filter that half works.',
  'marketing.developers.boundary.relational.title': 'Relational underneath, FHIR at the edge',
  'marketing.developers.boundary.relational.body':
    'PostgreSQL through Prisma is the source of truth; FHIR is a projection at the boundary, and every mapper ships with round-trip tests. That is the trade recorded in the second architecture decision: a smaller search surface at the edge, bought with a schema that ordinary SQL and ordinary tooling can reason about.',
  'marketing.developers.boundary.middleware.title': 'One middleware chain, in one order',
  'marketing.developers.boundary.middleware.body':
    'A request identifier, then authentication, then tenant scoping, then policy, then audit. Repositories are handed a request-scoped audit collector and cannot run without one, so tenant isolation and access accounting are properties of the chain rather than things each handler remembers. Failures come back as problem documents, so an error is parseable rather than a string.',
  'marketing.developers.boundary.workspaces.title':
    'Typed workspaces, not one application with folders',
  'marketing.developers.boundary.workspaces.body':
    'Shared types, the FHIR mappers, the Prisma schema and client, the design-system component library, and domain packages for the electronic claim transaction sets, the form engine, bring-your-own terminology and versioned partner adapters. Each has its own tests and its own boundary.',
  'marketing.developers.agent.title': 'The optional agentic layer',
  'marketing.developers.agent.lead':
    'An assistant exists, it is off unless a deployer turns it on, and the constraints on it were written before it was built.',
  'marketing.developers.agent.separable.title': 'Default off, and genuinely separable',
  'marketing.developers.agent.separable.body':
    'The assistant is a separate container the default invocation does not start. Every capability it can reach has a deterministic path in the interface, so an outage at whatever endpoint a deployer configured costs a clinic its assistant and nothing else. A configuration with no model is a first-class test target, not an afterthought.',
  'marketing.developers.agent.tools.title': 'Tools are ordinary API clients',
  'marketing.developers.agent.tools.body':
    'No tool receives a database client. Tools call the same HTTP API carrying the credentials of the person who asked, so tenant scoping, policy checks and audit writes are enforced by the middleware that already exists rather than by a second implementation that can drift from it.',
  'marketing.developers.agent.outbound.title': 'It cannot talk to the outside',
  'marketing.developers.agent.outbound.body':
    'There is no outbound-communication tool of any kind: no email, no message, no webhook, no URL fetch. Access to private records plus exposure to untrusted text plus the ability to send things out is the combination worth designing against, and the third one is made structurally impossible rather than merely disallowed.',
  'marketing.developers.agent.retrieval.title': 'Retrieval, not generation, for clinical content',
  'marketing.developers.agent.retrieval.body':
    'A sentence that cannot carry a citation to a record row and field is not emitted, and that is enforced by a resolver in code rather than by prompting. No weights, no Python and no inference ship inside the deployment. A remote endpoint is named, configured and paid for by the deployer, and starting one takes a separate acknowledgement naming the agreement it runs under.',
  'marketing.developers.agent.adrLink':
    'Read ADR-0004 and ADR-0005, which set and then narrowly amend these rules',
  'marketing.developers.bar.title': 'The bar a change has to clear',
  'marketing.developers.bar.lead':
    'Every pull request is analysed for coverage, code quality, known vulnerabilities, leaked secrets, dependency licences and supply-chain provenance. Nothing merges on a green tick alone: the bar is a clean board.',
};

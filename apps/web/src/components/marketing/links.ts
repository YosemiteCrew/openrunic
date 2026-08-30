/**
 * Every destination the public pages point at, in one place.
 *
 * Off-site links are written out rather than assembled from a base constant:
 * a reviewer checking that a marketing page links to the real security policy
 * should be able to read the URL, not reconstruct it. They are also the only
 * thing on these pages that can rot silently, so keeping them in one module
 * makes the whole set checkable in one sitting.
 *
 * Repository links point at `dev` rather than `main`: `dev` is the branch the
 * project develops on, and `main` currently trails it.
 */
export const OFFSITE = {
  repo: 'https://github.com/YosemiteCrew/openrunic',
  wiki: 'https://github.com/YosemiteCrew/openrunic/wiki',
  gettingStarted: 'https://github.com/YosemiteCrew/openrunic/wiki/Getting-Started',
  architecture: 'https://github.com/YosemiteCrew/openrunic/wiki/Architecture-Overview',
  roadmap: 'https://github.com/YosemiteCrew/openrunic/wiki/Roadmap',
  selfHosting: 'https://github.com/YosemiteCrew/openrunic/wiki/Self-Hosting',
  apiDesign: 'https://github.com/YosemiteCrew/openrunic/wiki/API-Design',
  patientPortal: 'https://github.com/YosemiteCrew/openrunic/wiki/Patient-Portal',
  discussions: 'https://github.com/YosemiteCrew/openrunic/discussions',
  goodFirstIssues:
    'https://github.com/YosemiteCrew/openrunic/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22',
  contributing: 'https://github.com/YosemiteCrew/openrunic/blob/dev/CONTRIBUTING.md',
  conduct: 'https://github.com/YosemiteCrew/openrunic/blob/dev/CODE_OF_CONDUCT.md',
  security: 'https://github.com/YosemiteCrew/openrunic/blob/dev/SECURITY.md',
  licence: 'https://github.com/YosemiteCrew/openrunic/blob/dev/LICENSE',
  compliance: 'https://github.com/YosemiteCrew/openrunic/blob/dev/docs/compliance.md',
  decisions: 'https://github.com/YosemiteCrew/openrunic/tree/dev/docs/adr',
} as const;

/** A public route, so `aria-current` can be set without reading the URL at runtime. */
export type PublicRoute = '/' | '/for/hospitals' | '/for/patients' | '/for/developers';

export interface NavItem {
  /** Catalogue key for the link's words. Looked up by the masthead, per render. */
  readonly labelKey: string;
  readonly href: PublicRoute;
}

/**
 * The masthead sections, in pillar order: the same order the README and the
 * wiki list them in, so someone arriving from either finds them where they
 * expect. Home is reached through the lockup rather than a fourth link.
 */
export const SITE_NAV: readonly NavItem[] = [
  { labelKey: 'marketing.nav.hospitals', href: '/for/hospitals' },
  { labelKey: 'marketing.nav.patients', href: '/for/patients' },
  { labelKey: 'marketing.nav.developers', href: '/for/developers' },
];

/**
 * One audience, as catalogue keys.
 *
 * Keys rather than words because this is a module-scope constant and the
 * reader's language is not known until a page renders. Named `titleKey`,
 * `summaryKey` and so on because `catalogue-drift.test.ts` reads
 * `somethingKey:` out of the source, so a card whose copy is defined nowhere
 * fails the build instead of rendering three message keys on the home page.
 *
 * `pointKeys` is a list of objects rather than a list of strings for the same
 * reason: a bare array of keys is invisible to that scan.
 *
 * `linkKey` is a whole sentence rather than "openrunic for" joined to the
 * title. The English happens to read as a prefix plus a noun; other languages
 * do not agree about the order or the article, and a sentence assembled from
 * pieces cannot be reordered by a translator.
 */
export interface Pillar {
  readonly titleKey: string;
  readonly href: PublicRoute;
  readonly summaryKey: string;
  /** What this audience actually gets today. Three at most: a card is not a list. */
  readonly pointKeys: readonly { readonly labelKey: string }[];
  readonly linkKey: string;
}

/**
 * The three audiences the project is organised around.
 *
 * A fourth pillar covering research data-sharing is planned and unbuilt, so it
 * is deliberately absent: nothing on these pages describes something that does
 * not exist yet.
 */
export const PILLARS: readonly Pillar[] = [
  {
    titleKey: 'marketing.pillar.hospitals.title',
    href: '/for/hospitals',
    summaryKey: 'marketing.pillar.hospitals.summary',
    pointKeys: [
      { labelKey: 'marketing.pillar.hospitals.point1' },
      { labelKey: 'marketing.pillar.hospitals.point2' },
      { labelKey: 'marketing.pillar.hospitals.point3' },
    ],
    linkKey: 'marketing.pillar.hospitals.link',
  },
  {
    titleKey: 'marketing.pillar.patients.title',
    href: '/for/patients',
    summaryKey: 'marketing.pillar.patients.summary',
    pointKeys: [
      { labelKey: 'marketing.pillar.patients.point1' },
      { labelKey: 'marketing.pillar.patients.point2' },
      { labelKey: 'marketing.pillar.patients.point3' },
    ],
    linkKey: 'marketing.pillar.patients.link',
  },
  {
    titleKey: 'marketing.pillar.developers.title',
    href: '/for/developers',
    summaryKey: 'marketing.pillar.developers.summary',
    pointKeys: [
      { labelKey: 'marketing.pillar.developers.point1' },
      { labelKey: 'marketing.pillar.developers.point2' },
      { labelKey: 'marketing.pillar.developers.point3' },
    ],
    linkKey: 'marketing.pillar.developers.link',
  },
];

/** The pillars other than the one being read, in the order above. */
export function otherPillars(current: PublicRoute): readonly Pillar[] {
  return PILLARS.filter((pillar) => pillar.href !== current);
}

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
  /** Catalogue key for the label. The words themselves live in `marketing`. */
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

export interface PillarPoint {
  readonly labelKey: string;
}

export interface Pillar {
  readonly titleKey: string;
  readonly href: PublicRoute;
  readonly summaryKey: string;
  /**
   * What this audience actually gets today. Three at most: a card is not a
   * list.
   *
   * A list of objects rather than a list of bare strings, so each key sits
   * behind a `labelKey:` property. That is one of the two shapes the catalogue
   * drift test can see; an array of loose strings is neither, and would be the
   * only copy on the public site nothing checked.
   */
  readonly points: readonly PillarPoint[];
}

/**
 * The three audiences the project is organised around.
 *
 * A fourth pillar covering research data-sharing is planned and unbuilt, so it
 * is deliberately absent: nothing on these pages describes something that does
 * not exist yet.
 *
 * The copy is carried as catalogue keys rather than words. This is a module
 * constant, evaluated once at import, and there is no reader and therefore no
 * language at that moment; the card translates at render. Keeping the words in
 * one catalogue file also means the whole of the public site can be reviewed in
 * one sitting, which is how the claims on it stay checkable.
 */
export const PILLARS: readonly Pillar[] = [
  {
    titleKey: 'marketing.pillar.hospitals.title',
    href: '/for/hospitals',
    summaryKey: 'marketing.pillar.hospitals.summary',
    points: [
      { labelKey: 'marketing.pillar.hospitals.point1' },
      { labelKey: 'marketing.pillar.hospitals.point2' },
      { labelKey: 'marketing.pillar.hospitals.point3' },
    ],
  },
  {
    titleKey: 'marketing.pillar.patients.title',
    href: '/for/patients',
    summaryKey: 'marketing.pillar.patients.summary',
    points: [
      { labelKey: 'marketing.pillar.patients.point1' },
      { labelKey: 'marketing.pillar.patients.point2' },
      { labelKey: 'marketing.pillar.patients.point3' },
    ],
  },
  {
    titleKey: 'marketing.pillar.developers.title',
    href: '/for/developers',
    summaryKey: 'marketing.pillar.developers.summary',
    points: [
      { labelKey: 'marketing.pillar.developers.point1' },
      { labelKey: 'marketing.pillar.developers.point2' },
      { labelKey: 'marketing.pillar.developers.point3' },
    ],
  },
];

/** The pillars other than the one being read, in the order above. */
export function otherPillars(current: PublicRoute): readonly Pillar[] {
  return PILLARS.filter((pillar) => pillar.href !== current);
}

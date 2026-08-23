import type { Metadata, Viewport } from 'next';

/**
 * The metadata both root layouts start from.
 *
 * `robots` is fail-closed on purpose: `apps/web` is the staff EMR, a chart URL
 * has no business in a search index, and a new staff route should inherit that
 * without anyone remembering to ask for it. The public route group opts back
 * in, for its four pages and nothing else - which is the way round to be wrong.
 */
export const baseMetadata: Metadata = {
  title: {
    default: 'openrunic',
    /**
     * Screens set their own `title`. Chart screens use "PATIENTSSON, Testina -
     * Chart": two browser tabs on two patients must be impossible to confuse.
     */
    template: '%s - openrunic',
  },
  description: 'Open-source operating system for human health',
  applicationName: 'openrunic',
  robots: { index: false, follow: false },
};

export const baseViewport: Viewport = {
  // Bone, so the browser chrome matches the page rather than flashing white.
  themeColor: '#f5efe6',
};

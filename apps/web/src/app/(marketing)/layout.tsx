import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * The public pages, and the one thing that separates them from the rest of this
 * application.
 *
 * `apps/web` is the staff EMR. Its root layout declares
 * `robots: { index: false, follow: false }` because a chart URL has no business
 * in a search index, and that default is deliberately fail-closed: a new staff
 * route inherits it without anyone remembering to. The marketing pages are the
 * exact opposite case - a stranger is meant to find them - so the opt-in is
 * declared here, once, for the whole route group.
 *
 * Next merges metadata field by field from the root down, so this `robots`
 * replaces the root's for everything in this group and nothing else. Adding a
 * public page means putting it under `(marketing)/`; adding a staff route
 * anywhere else leaves it noindex, which is the way round we want to be wrong.
 *
 * Two things this is not. It is not access control: `noindex` asks a crawler
 * not to list a URL, and the thing that keeps a chart private is authentication
 * at the API. And it is not a `robots.txt`: a disallow list would have to name
 * every staff path to work, publishing the map of the application to anyone who
 * fetched it, while `noindex` on the page is both stronger and quieter.
 *
 * There is no `sitemap.ts` yet. A sitemap has to carry absolute URLs, the
 * project has no canonical host, and inventing one is exactly the kind of claim
 * these pages are written to avoid. It belongs in the pull request that puts
 * the site somewhere.
 *
 * The layout renders its children and nothing else. The visible frame - the
 * masthead, the main landmark and the footer - is `PublicPage`, a component
 * each page renders, because a layout is not told which route it wrapped and
 * the masthead needs that to mark the current section.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}

import type { ReactNode } from 'react';

import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import type { PublicRoute } from './links';

export interface PublicPageProps {
  /** The route being rendered, so the masthead can mark its own link. */
  active: PublicRoute;
  /**
   * The language segment the page is prerendered under: the addresses the
   * masthead points at, and the language the frame's own words come from.
   */
  locale: string;
  children: ReactNode;
}

/**
 * The frame every public page renders inside: masthead, main landmark, footer.
 *
 * It is a component rather than a `layout.tsx` because a layout is not told
 * which route it wrapped, and the masthead needs that to mark the current
 * section without reading the URL in the browser. The route group's layout
 * still exists, and owns the one thing a layout is the right place for: the
 * indexing rule for everything underneath it.
 *
 * `<main>` takes focus from the root layout's skip link, so it is focusable
 * (`tabIndex={-1}`) and carries the id that link points at. Its outline is
 * suppressed in CSS: it is a landmark, not a control.
 */
export function PublicPage({ active, locale, children }: Readonly<PublicPageProps>) {
  return (
    <>
      <SiteHeader active={active} locale={locale} />
      <main id="main-content" className="or-mk-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

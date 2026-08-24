import type { Translator } from '@openrunic/i18n';
import type { ReactNode } from 'react';

import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import type { PublicRoute } from './links';

export interface PublicPageProps {
  /** The route being rendered, so the masthead can mark its own link. */
  active: PublicRoute;
  /**
   * The translator for this request.
   *
   * The public pages are server components: the locale is resolved before the
   * first byte and the translator is built once per page, then handed to the
   * chrome. Rendering the masthead in one language and the footer in another is
   * exactly what passing it explicitly makes impossible.
   */
  t: Translator;
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
export function PublicPage({ active, t, children }: Readonly<PublicPageProps>) {
  return (
    <>
      <SiteHeader active={active} t={t} />
      <main id="main-content" className="or-mk-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter t={t} />
    </>
  );
}

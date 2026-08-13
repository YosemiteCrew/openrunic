import type { ReactNode } from 'react';

export interface HeroProps {
  /** Small uppercase line above the heading. Says which audience the page is for. */
  eyebrow: string;
  /** The page's one `<h1>`. */
  title: string;
  /** The paragraph that has to carry the page on its own if nothing else is read. */
  lead: string;
  /**
   * Call-to-action links. Two at most, the first drawn as the primary control,
   * and both are anchors because every one of them leaves for the repository or
   * the wiki.
   */
  actions?: ReactNode;
  /** Rendered under the actions. Used for the pre-alpha status note. */
  children?: ReactNode;
}

/**
 * The opening band of a public page.
 *
 * `.or-hero` is the design system's hero type role and its size is already a
 * clamp, so the heading scales from a 375px phone to a desktop without this
 * page inventing a breakpoint for it.
 */
export function Hero({ eyebrow, title, lead, actions, children }: Readonly<HeroProps>) {
  return (
    <div className="or-mk-hero">
      <div className="or-mk-hero__inner">
        <p className="or-overline or-mk-hero__eyebrow">{eyebrow}</p>
        <h1 className="or-hero">{title}</h1>
        <p className="or-body-lg or-mk-hero__lead">{lead}</p>
        {actions ? <div className="or-mk-hero__actions">{actions}</div> : null}
        {children}
      </div>
    </div>
  );
}

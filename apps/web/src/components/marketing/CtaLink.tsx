import type { ReactNode } from 'react';

export interface CtaLinkProps {
  href: string;
  /** One primary per page. Everything else is the espresso outline. */
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}

/**
 * A call to action, drawn with the library's own button classes.
 *
 * It is an `<a>` because every call to action on these pages leaves for the
 * repository or the wiki, and the element should say what the control does.
 * `@openrunic/ui`'s `Button` renders exactly this markup for an `href`, but it
 * also hands the anchor a click guard, which a server component cannot pass to
 * a DOM element - and reaching for it would pull the whole library across the
 * client boundary anyway. The classes are the design system; the component is
 * one way of spelling them.
 */
export function CtaLink({ href, variant = 'secondary', children }: Readonly<CtaLinkProps>) {
  return (
    <a className={`or-btn or-btn--${variant} or-btn--lg`} href={href}>
      {children}
    </a>
  );
}

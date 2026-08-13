'use client';

/**
 * The one `<h1>` on a screen, with the overline above it and a plain lede below.
 *
 * The overline is the only all-caps text in the portal. Every screen renders exactly one of
 * these, so there is exactly one `<h1>` per page.
 */

export interface PageHeaderProps {
  overline: string;
  title: string;
  /** One or two short sentences saying what this screen is for. */
  lede: string;
}

export function PageHeader({ overline, title, lede }: PageHeaderProps) {
  return (
    <div className="portal-page-header">
      <p className="or-overline portal-page-header__overline">{overline}</p>
      <h1 className="or-h1 portal-page-header__title">{title}</h1>
      <p className="or-body-lg portal-page-header__lede">{lede}</p>
    </div>
  );
}

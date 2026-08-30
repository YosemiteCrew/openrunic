import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { brandAssetCssUrl } from '../../assets/brand';
import type { BrandLogoFile } from '../../assets/brand';
import { cx } from '../../lib/cx';

/** The shipped horizontal lockup, drawn through a mask so it inherits the band's ink. */
const LOCKUP: BrandLogoFile = 'lockup-horizontal.svg';

export interface FooterColumn {
  title: string;
  links: string[];
}

export interface FooterProps extends HTMLAttributes<HTMLElement> {
  columns?: FooterColumn[];
  /** One-line description beside the lockup. */
  note?: string;
  /** Bottom rule line - licence, sibling-project mention. */
  siblingNote?: ReactNode;
  /**
   * Serve the lockup from your own copy of the design system's assets/logo directory
   * instead of the mark bundled with this package. The mark is a shipped file either way.
   */
  logoBasePath?: string;
}

/**
 * The closing espresso band for marketing and docs, and the one place the Yosemite Crew
 * sibling may be named alongside openrunic - beside it, never merged into one lockup.
 * Columns sit next to the lockup from md and stack below it on a phone.
 */
export function Footer({
  columns = [],
  note,
  siblingNote,
  logoBasePath,
  className,
  ...rest
}: FooterProps) {
  /* A stylesheet cannot know the consumer's asset path, so the one thing that has to be
     inline is the mask URL. Everything else about the lockup lives in Footer.css. */
  const logoStyle = {
    '--or-footer-logo-src': brandAssetCssUrl(LOCKUP, logoBasePath),
  } as CSSProperties;

  return (
    <footer className={cx('or-footer', className)} {...rest}>
      <div className="or-footer__inner">
        <div className="or-footer__brand">
          {/* The product's name, not a word. It is `openrunic` in every language,
              the same way it is on the README and in the page titles, so it stays
              a literal here while the words beside it became props. See #196. */}
          <span className="or-footer__logo" style={logoStyle} role="img" aria-label="openrunic" />
          {note ? <p className="or-small or-footer__note">{note}</p> : null}
        </div>

        <div className="or-footer__columns">
          {columns.map((column) => (
            <nav className="or-footer__column" key={column.title} aria-label={column.title}>
              <p className="or-overline or-footer__column-title">{column.title}</p>
              <ul className="or-footer__links">
                {column.links.map((link) => (
                  <li key={link}>
                    <a className="or-footer__link" href={`#${encodeURIComponent(link)}`}>
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      {siblingNote ? <div className="or-footer__sibling">{siblingNote}</div> : null}
    </footer>
  );
}

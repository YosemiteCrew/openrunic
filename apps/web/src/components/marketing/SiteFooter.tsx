import { Lockup } from './Lockup';
import { OFFSITE } from './links';

interface FooterColumn {
  readonly title: string;
  readonly links: readonly { readonly label: string; readonly href: string }[];
}

/**
 * Three columns: how to read the project, how to work on it, and how it is
 * governed. Every link leaves for the repository or the wiki, because those are
 * the only places the project publishes anything.
 */
const COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Project',
    links: [
      { label: 'Source', href: OFFSITE.repo },
      { label: 'Documentation', href: OFFSITE.wiki },
      { label: 'Architecture', href: OFFSITE.architecture },
      { label: 'Roadmap', href: OFFSITE.roadmap },
    ],
  },
  {
    title: 'Contribute',
    links: [
      { label: 'Contributing guide', href: OFFSITE.contributing },
      { label: 'Good first issues', href: OFFSITE.goodFirstIssues },
      { label: 'Discussions', href: OFFSITE.discussions },
      { label: 'Code of conduct', href: OFFSITE.conduct },
    ],
  },
  {
    title: 'Governance',
    links: [
      { label: 'Licence: AGPL-3.0-only', href: OFFSITE.licence },
      { label: 'Regulatory posture', href: OFFSITE.compliance },
      { label: 'Security policy', href: OFFSITE.security },
      { label: 'Architecture decisions', href: OFFSITE.decisions },
    ],
  },
];

/**
 * The closing espresso band.
 *
 * The band re-points the ink roles for its subtree the way the library's own
 * inverse surfaces do, so the lockup, the overlines and the links all resolve
 * to ink drawn for espresso paper rather than each carrying a variant.
 *
 * The last line is the compliance footnote, and it stays on every public page:
 * the regulatory position is not a page someone has to click into.
 */
export function SiteFooter() {
  return (
    <footer className="or-mk-footer">
      <div className="or-mk-footer__inner">
        <div className="or-mk-footer__brand">
          <Lockup />
          <p className="or-small or-mk-footer__note">
            An open-source operating system for human health, built by Yosemite Crew. Pre-alpha:
            there are no releases yet.
          </p>
        </div>

        <div className="or-mk-footer__columns">
          {COLUMNS.map((column) => (
            <nav className="or-mk-footer__column" key={column.title} aria-label={column.title}>
              <p className="or-overline or-mk-footer__column-title">{column.title}</p>
              <ul className="or-mk-footer__links">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a className="or-mk-footer__link" href={link.href}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="or-mk-footer__bottom">
        <p>openrunic is open-source software, not a certified medical device.</p>
        <p>Copyright (C) 2026 openrunic contributors. Licensed under AGPL-3.0-only.</p>
      </div>
    </footer>
  );
}

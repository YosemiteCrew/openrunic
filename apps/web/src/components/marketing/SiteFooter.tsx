import type { Translator } from '@openrunic/i18n';

import { Lockup } from './Lockup';
import { OFFSITE } from './links';

interface FooterColumn {
  readonly titleKey: string;
  readonly links: readonly { readonly labelKey: string; readonly href: string }[];
}

/**
 * Three columns: how to read the project, how to work on it, and how it is
 * governed. Every link leaves for the repository or the wiki, because those are
 * the only places the project publishes anything.
 *
 * The labels are catalogue keys rather than words, because this is a module
 * constant and the reader's language is not known until a request arrives.
 */
const COLUMNS: readonly FooterColumn[] = [
  {
    titleKey: 'marketing.footer.column.project',
    links: [
      { labelKey: 'marketing.link.source', href: OFFSITE.repo },
      { labelKey: 'marketing.link.documentation', href: OFFSITE.wiki },
      { labelKey: 'marketing.link.architecture', href: OFFSITE.architecture },
      { labelKey: 'marketing.link.roadmap', href: OFFSITE.roadmap },
    ],
  },
  {
    titleKey: 'marketing.footer.column.contribute',
    links: [
      { labelKey: 'marketing.link.contributing', href: OFFSITE.contributing },
      { labelKey: 'marketing.link.goodFirstIssues', href: OFFSITE.goodFirstIssues },
      { labelKey: 'marketing.link.discussions', href: OFFSITE.discussions },
      { labelKey: 'marketing.link.conduct', href: OFFSITE.conduct },
    ],
  },
  {
    titleKey: 'marketing.footer.column.governance',
    links: [
      { labelKey: 'marketing.link.licence', href: OFFSITE.licence },
      { labelKey: 'marketing.link.compliance', href: OFFSITE.compliance },
      { labelKey: 'marketing.link.security', href: OFFSITE.security },
      { labelKey: 'marketing.link.decisions', href: OFFSITE.decisions },
    ],
  },
];

export interface SiteFooterProps {
  /** The translator. These are server components, so there is no hook to call. */
  t: Translator;
}

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
export function SiteFooter({ t }: Readonly<SiteFooterProps>) {
  return (
    <footer className="or-mk-footer">
      <div className="or-mk-footer__inner">
        <div className="or-mk-footer__brand">
          <Lockup />
          <p className="or-small or-mk-footer__note">{t('marketing.footer.note')}</p>
        </div>

        <div className="or-mk-footer__columns">
          {COLUMNS.map((column) => {
            const title = t(column.titleKey);
            return (
              <nav className="or-mk-footer__column" key={column.titleKey} aria-label={title}>
                <p className="or-overline or-mk-footer__column-title">{title}</p>
                <ul className="or-mk-footer__links">
                  {column.links.map((link) => (
                    <li key={link.labelKey}>
                      <a className="or-mk-footer__link" href={link.href}>
                        {t(link.labelKey)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}
        </div>
      </div>

      <div className="or-mk-footer__bottom">
        <p>{t('marketing.footer.notCertified')}</p>
        <p>{t('marketing.footer.copyright')}</p>
      </div>
    </footer>
  );
}

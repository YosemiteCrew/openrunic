import { appCatalogue, createTranslator } from '@openrunic/i18n';

import { Lockup } from './Lockup';
import { OFFSITE } from './links';

interface FooterColumn {
  /** Catalogue key for the column heading, which also names the landmark. */
  readonly titleKey: string;
  readonly links: readonly { readonly labelKey: string; readonly href: string }[];
}

/**
 * Three columns: how to read the project, how to work on it, and how it is
 * governed. Every link leaves for the repository or the wiki, because those are
 * the only places the project publishes anything.
 *
 * Carried as keys rather than words because this is a module-scope constant and
 * the reader's language is not known until a page renders. `titleKey` and
 * `labelKey` are also the shapes `catalogue-drift.test.ts` reads out of the
 * source, so a footer link whose key is defined nowhere fails the build rather
 * than putting a message key in the closing band of all four pages.
 */
const COLUMNS: readonly FooterColumn[] = [
  {
    titleKey: 'marketing.footer.project',
    links: [
      { labelKey: 'marketing.source', href: OFFSITE.repo },
      { labelKey: 'marketing.footer.documentation', href: OFFSITE.wiki },
      { labelKey: 'marketing.footer.architecture', href: OFFSITE.architecture },
      { labelKey: 'marketing.footer.roadmap', href: OFFSITE.roadmap },
    ],
  },
  {
    titleKey: 'marketing.footer.contribute',
    links: [
      { labelKey: 'marketing.cta.contributing', href: OFFSITE.contributing },
      { labelKey: 'marketing.cta.goodFirstIssues', href: OFFSITE.goodFirstIssues },
      { labelKey: 'marketing.footer.discussions', href: OFFSITE.discussions },
      { labelKey: 'marketing.footer.conduct', href: OFFSITE.conduct },
    ],
  },
  {
    titleKey: 'marketing.footer.governance',
    links: [
      { labelKey: 'marketing.footer.licence', href: OFFSITE.licence },
      { labelKey: 'marketing.footer.compliance', href: OFFSITE.compliance },
      { labelKey: 'marketing.footer.security', href: OFFSITE.security },
      { labelKey: 'marketing.footer.decisions', href: OFFSITE.decisions },
    ],
  },
];

export interface SiteFooterProps {
  /** The language segment the page is prerendered under, for its own copy. */
  locale: string;
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
export function SiteFooter({ locale }: Readonly<SiteFooterProps>) {
  const t = createTranslator(appCatalogue, locale);

  return (
    <footer className="or-mk-footer">
      <div className="or-mk-footer__inner">
        <div className="or-mk-footer__brand">
          <Lockup />
          <p className="or-small or-mk-footer__note">{t('marketing.footer.note')}</p>
        </div>

        <div className="or-mk-footer__columns">
          {COLUMNS.map((column) => (
            <nav
              className="or-mk-footer__column"
              key={column.titleKey}
              aria-label={t(column.titleKey)}
            >
              <p className="or-overline or-mk-footer__column-title">{t(column.titleKey)}</p>
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
          ))}
        </div>
      </div>

      <div className="or-mk-footer__bottom">
        <p>{t('marketing.footer.notDevice')}</p>
        <p>{t('marketing.footer.copyright')}</p>
      </div>
    </footer>
  );
}

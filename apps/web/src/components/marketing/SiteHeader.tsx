import { appCatalogue, createTranslator } from '@openrunic/i18n';
import Link from 'next/link';

import { localisedPath } from '@/lib/auth/routes';

import { Lockup } from './Lockup';
import { OFFSITE, SITE_NAV } from './links';
import type { PublicRoute } from './links';

export interface SiteHeaderProps {
  /**
   * The route being read. Its link carries `aria-current="page"`, and the class
   * that draws the terracotta rule under it, so the current section is stated
   * in the accessibility tree and not only in the colour.
   *
   * It is a prop rather than a `usePathname()` read on purpose: reading the URL
   * would make the masthead a client component, and a masthead that needs
   * JavaScript to know which of four links to underline is a bad trade on the
   * page a stranger loads first.
   */
  active?: PublicRoute;
  /**
   * The language segment these links live under, and the language their words
   * are looked up in.
   *
   * The public pages are prerendered once per language, so their addresses
   * carry it: the masthead on `/es` has to point at `/es/for/hospitals` and not
   * at `/for/hospitals`, which no longer exists. Passed rather than read,
   * because reading the URL would make the masthead a client component - the
   * same reason `active` is a prop, and the same reason the translator is built
   * here rather than taken from a provider.
   */
  locale: string;
}

/**
 * The public masthead: the lockup home, the three pillar sections, and the
 * repository.
 *
 * There is no menu button. The library's `NavBar` collapses behind one below
 * 768px, which is the right answer for a bar of eight sections; four short
 * labels fit a 375px viewport on two rows, and a row that wraps needs no
 * disclosure, no focus trap and no JavaScript.
 *
 * The addresses go through `localisedPath` rather than being built here. They
 * used to be built here, and `PillarCard` shipped rendering `pillar.href` raw
 * because the rule lived in this file rather than in a function anything else
 * could reach - so the masthead stayed inside the reader's language and the
 * cards on the same page did not.
 */
export function SiteHeader({ active, locale }: Readonly<SiteHeaderProps>) {
  const t = createTranslator(appCatalogue, locale);

  return (
    <header className="or-mk-header">
      <div className="or-mk-header__inner">
        <Link
          className="or-mk-header__home"
          href={localisedPath('/', locale)}
          aria-label={t('marketing.header.home')}
        >
          <Lockup />
        </Link>

        <nav className="or-mk-header__nav" aria-label={t('marketing.header.siteNav')}>
          <ul className="or-mk-header__list">
            {SITE_NAV.map((item) => {
              const current = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    className={
                      current
                        ? 'or-mk-header__link or-mk-header__link--current'
                        : 'or-mk-header__link'
                    }
                    href={localisedPath(item.href, locale)}
                    aria-current={current ? 'page' : undefined}
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              );
            })}
            <li>
              <a className="or-mk-header__link" href={OFFSITE.repo}>
                {t('marketing.source')}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

import type { Translator } from '@openrunic/i18n';
import Link from 'next/link';

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
  /** The translator, for the same reason the route is a prop: no hooks here. */
  t: Translator;
}

/**
 * The public masthead: the lockup home, the three pillar sections, and the
 * repository.
 *
 * There is no menu button. The library's `NavBar` collapses behind one below
 * 768px, which is the right answer for a bar of eight sections; four short
 * labels fit a 375px viewport on two rows, and a row that wraps needs no
 * disclosure, no focus trap and no JavaScript.
 */
export function SiteHeader({ active, t }: Readonly<SiteHeaderProps>) {
  return (
    <header className="or-mk-header">
      <div className="or-mk-header__inner">
        <Link className="or-mk-header__home" href="/" aria-label={t('marketing.header.home')}>
          <Lockup />
        </Link>

        <nav className="or-mk-header__nav" aria-label={t('marketing.header.nav')}>
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
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              );
            })}
            <li>
              <a className="or-mk-header__link" href={OFFSITE.repo}>
                {t('marketing.link.source')}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

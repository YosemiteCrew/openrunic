'use client';

/**
 * The chrome every portal screen sits in.
 *
 * One `<nav>` in the DOM at every width. Below 768px CSS lays it out as a fixed bottom tab
 * bar, between 768px and 1023px as a horizontal strip under the masthead, and from 1024px
 * up as a left rail. Rendering three separate navigations would put the same six links in
 * the accessibility tree three times and leave a keyboard user tabbing through copies they
 * cannot see, so the layout changes and the markup does not.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@openrunic/ui';
import { useTranslator } from '@/lib/i18n/messages';
import { isActiveRoute, navItemsFor } from '@/lib/nav';
import type { Patient } from '@/lib/api/types';

export interface AppShellProps {
  /**
   * Whose record is open, once it is known. The identity strip simply appears when the
   * patient resolves rather than holding a placeholder: chrome that flickers a fake name
   * is worse than chrome that arrives a moment late.
   */
  patient?: Patient;
  /**
   * Whether this practice configured an assistant. Defaults to no, so the navigation a
   * portal renders before anything has been asked is the one it has always had.
   */
  assistantEnabled?: boolean;
  children: ReactNode;
}

export function AppShell({ patient, assistantEnabled = false, children }: Readonly<AppShellProps>) {
  const t = useTranslator();
  const pathname = usePathname();
  const items = navItemsFor(assistantEnabled);

  return (
    <div className="portal">
      <a className="portal__skip" href="#portal-main">
        {t('portal.skipToContent')}
      </a>

      <header className="portal__masthead">
        <p className="or-overline portal__eyebrow">{t('portal.eyebrow')}</p>
        {patient ? (
          <p className="portal__identity">
            <span className="portal__identity-name">{patient.name}</span>
            {/* One message rather than a label and a number joined here: where
                the number sits in the phrase is a language decision. */}
            <span className="portal__identity-mrn">
              {t('portal.recordNumber', { mrn: patient.mrn })}
            </span>
          </p>
        ) : null}
      </header>

      <nav className="portal__nav" aria-label={t('portal.navLabel')}>
        <ul className="portal__nav-list">
          {items.map((item) => {
            const current = isActiveRoute(item.href, pathname);
            return (
              <li className="portal__nav-item" key={item.href}>
                <Link
                  className={`portal__nav-link${current ? ' portal__nav-link--current' : ''}`}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                >
                  <Icon className="portal__nav-icon" name={item.icon} size={22} />
                  <span className="portal__nav-label">{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="portal__main" id="portal-main">
        {children}
      </main>

      <footer className="portal__footer">
        <p className="or-small portal__footer-text">{t('portal.footer.whatThisIs')}</p>
        <p className="or-small portal__footer-text">{t('portal.footer.emergency')}</p>
      </footer>
    </div>
  );
}

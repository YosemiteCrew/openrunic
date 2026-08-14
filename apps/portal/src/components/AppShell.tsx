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
import { isActiveRoute, navItemsFor } from '@/lib/nav';
import type { Patient } from '@/lib/api/types';

export interface AppShellProps {
  /**
   * Whose record is open, once it is known. The identity strip simply appears when the
   * patient resolves rather than holding a placeholder: chrome that flickers a fake name
   * is worse than chrome that arrives a moment late.
   */
  patient?: Patient | undefined;
  /**
   * Whether this practice configured an assistant. Defaults to no, so the navigation a
   * portal renders before anything has been asked is the one it has always had.
   */
  assistantEnabled?: boolean;
  children: ReactNode;
}

export function AppShell({ patient, assistantEnabled = false, children }: AppShellProps) {
  const pathname = usePathname();
  const items = navItemsFor(assistantEnabled);

  return (
    <div className="portal">
      <a className="portal__skip" href="#portal-main">
        Skip to content
      </a>

      <header className="portal__masthead">
        <p className="or-overline portal__eyebrow">Patient portal</p>
        {patient ? (
          <p className="portal__identity">
            <span className="portal__identity-name">{patient.name}</span>
            <span className="portal__identity-mrn">Record number {patient.mrn}</span>
          </p>
        ) : null}
      </header>

      <nav className="portal__nav" aria-label="Portal sections">
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
                  <span className="portal__nav-label">{item.label}</span>
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
        <p className="or-small portal__footer-text">
          This portal shows the record your care team keeps. If something looks wrong, message your
          care team and ask for it to be checked.
        </p>
        <p className="or-small portal__footer-text">
          For a medical emergency, call the emergency services on your local number.
        </p>
      </footer>
    </div>
  );
}

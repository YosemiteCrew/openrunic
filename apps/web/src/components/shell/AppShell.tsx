'use client';

import { SideNav } from '@openrunic/ui';
import type { SideNavItem } from '@openrunic/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { CommandPalette, CommandProvider } from '@/components/command';

import { Breadcrumb } from './Breadcrumb';
import type { BreadcrumbItem } from './Breadcrumb';
import { NAVIGATE_COMMANDS, NAV_AREAS, activeAreaLabel } from './navigation';
import { TopBar } from './TopBar';

/**
 * The staff shell every screen renders inside.
 *
 * It owns four things and nothing else: the rail, the top bar, the page
 * header (breadcrumb, heading, actions) and the right-rail slot. Screens own
 * their content. That split is what keeps sixty screens looking like one
 * product.
 *
 * Responsive behaviour comes from the library's SideNav: a persistent rail from
 * 1024px, and below it an off-canvas drawer behind a labelled Menu button with
 * its own focus trap. The staff EMR is designed at 1440 with a 1024 floor, and
 * this shell stays usable down to 768 rather than breaking, because a laptop
 * lid half-closed on a tablet dock is a real clinic.
 */

export interface AppShellProps {
  /** The page heading. Sentence case, no full stop. Becomes the `<h1>`. */
  title: string;
  /** One calm line under the heading. Optional. */
  description?: string;
  /**
   * Breadcrumb trail. Admin and Reports only: inside the chart the context rail
   * and the tab row already say where you are.
   */
  breadcrumb?: BreadcrumbItem[];
  /** Page-level controls, right of the heading. One primary at most. */
  actions?: ReactNode;
  /** Controls that belong in the top bar rather than the page (filters, pagers). */
  topBarActions?: ReactNode;
  /**
   * The right rail: patient context on chart screens, day counters on the
   * schedule, an exceptions queue on billing. Stacks under the content below
   * 1280px rather than being hidden, so nothing is unreachable on a laptop.
   */
  rightRail?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  title,
  description,
  breadcrumb,
  actions,
  topBarActions,
  rightRail,
  children,
}: AppShellProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const active = activeAreaLabel(pathname ?? '');

  const items = useMemo<SideNavItem[]>(
    () => NAV_AREAS.map((area) => ({ label: area.label, icon: area.icon })),
    []
  );

  const navigate = (label: string) => {
    const area = NAV_AREAS.find((candidate) => candidate.label === label);
    if (area) router.push(area.href);
  };

  return (
    <CommandProvider baseCommands={NAVIGATE_COMMANDS}>
      <div className="or-app">
        <SideNav
          className="or-app__nav"
          items={items}
          active={active}
          onNavigate={navigate}
          logoBasePath="/assets/logo"
        />

        <div className="or-app__body">
          <TopBar area={active}>{topBarActions}</TopBar>

          {/* The skip link in the root layout lands here. tabIndex -1 makes the
              landmark focusable so the skip actually moves the caret, not just
              the scroll position. */}
          <main id="main-content" className="or-app__main" tabIndex={-1}>
            <div className="or-app__page">
              {breadcrumb && breadcrumb.length > 0 ? <Breadcrumb items={breadcrumb} /> : null}

              <div className="or-app__header">
                <div className="or-app__heading">
                  <h1 className="or-h2">{title}</h1>
                  {description ? (
                    <p className="or-body or-app__description">{description}</p>
                  ) : null}
                </div>
                {actions ? <div className="or-app__actions">{actions}</div> : null}
              </div>

              <div className="or-app__content">{children}</div>
            </div>

            {rightRail ? (
              <aside className="or-app__rail" aria-label="Page context">
                {rightRail}
              </aside>
            ) : null}
          </main>
        </div>
      </div>

      <CommandPalette />
    </CommandProvider>
  );
}

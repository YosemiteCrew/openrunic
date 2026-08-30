'use client';

import { SideNav } from '@openrunic/ui';
import type { SideNavItem } from '@openrunic/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AssistantPanel, AssistantProvider } from '@/components/assistant';
import { CommandPalette, CommandProvider } from '@/components/command';

import { Breadcrumb } from './Breadcrumb';
import type { BreadcrumbItem } from './Breadcrumb';
import { useTranslator } from '@/lib/i18n/messages';

import { NAV_AREAS, activeArea, navigateCommands } from './navigation';
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
}: Readonly<AppShellProps>): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslator();
  const area = activeArea(pathname ?? '');
  const active = area === undefined ? undefined : t(area.labelKey);

  // The rail's API is label-based, so the mapping back from a label to a route
  // is built here from the same translator in the same render. Building it in
  // one place is what stops a translated rail navigating to the wrong screen.
  const routes = useMemo(
    () => new Map(NAV_AREAS.map((entry) => [t(entry.labelKey), entry.href])),
    [t]
  );

  const items = useMemo<SideNavItem[]>(
    () => NAV_AREAS.map((entry) => ({ label: t(entry.labelKey), icon: entry.icon })),
    [t]
  );

  const commands = useMemo(() => navigateCommands(t), [t]);

  const navigate = (label: string) => {
    const href = routes.get(label);
    if (href !== undefined) router.push(href);
  };

  return (
    <CommandProvider baseCommands={commands}>
      {/* Inside the command registry so the assistant can register its own
          palette entry, and around the shell so the panel keeps one
          conversation while a clinician walks from chart to chart. It asks the
          API once whether an assistant exists; when the answer is no - which is
          the shipped default - nothing below changes by so much as a pixel. */}
      <AssistantProvider>
        <div className="or-app">
          {/* The words the rail says come from here rather than from the design
              system, which has no translator: it used to announce itself as
              "Primary" and its menu button as "Menu" on a Spanish screen. */}
          <SideNav
            className="or-app__nav"
            items={items}
            active={active}
            onNavigate={navigate}
            logoBasePath="/assets/logo"
            navLabel={t('shell.mainNavigation')}
            menuLabel={t('shell.menu')}
            closeLabel={t('shell.closeMenu')}
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
                <aside className="or-app__rail" aria-label={t('shell.pageContext')}>
                  {rightRail}
                </aside>
              ) : null}
            </main>

            {/* A sibling of the content, never an overlay on it: a clinician
                asking about the chart has to keep reading the chart. It renders
                null unless the API reported an assistant, and the stylesheet
                gives this row a second column only when the panel is actually
                present, so an unconfigured deployment lays out exactly as
                before. */}
            <AssistantPanel />
          </div>
        </div>

        <CommandPalette />
      </AssistantProvider>
    </CommandProvider>
  );
}

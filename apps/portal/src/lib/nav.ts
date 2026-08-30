/**
 * The portal's sections, in one list.
 *
 * The same array draws the bottom tab bar below 768px, the strip on a tablet and the left
 * rail from 1024px up. One list means one set of links in the DOM at every width, so a
 * screen reader never meets the navigation twice and a keyboard user never tabs through a
 * hidden copy of it.
 *
 * Six of the seven are always there. The assistant is the exception: it exists only where
 * a practice configured one, so it is appended by {@link navItemsFor} rather than living
 * in the constant, and a portal without one has the navigation it always had.
 */

export type PortalRoute =
  '/' | '/health-record' | '/messages' | '/appointments' | '/forms' | '/bills' | '/assistant';

export interface NavItem {
  href: PortalRoute;
  /**
   * Full label, used at every width; the tab bar shortens nothing.
   *
   * A key rather than the word, in the `labelKey` shape the staff application's
   * navigation table already uses. That shape is one `catalogue-drift.test.ts`
   * can see, which a key assembled from the route could not be.
   */
  labelKey: string;
  /** Lucide slug. Decorative - the label always carries the meaning. */
  icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', labelKey: 'portal.nav.home', icon: 'house' },
  { href: '/health-record', labelKey: 'portal.nav.healthRecord', icon: 'heart-pulse' },
  { href: '/messages', labelKey: 'portal.nav.messages', icon: 'message-square' },
  { href: '/appointments', labelKey: 'portal.nav.appointments', icon: 'calendar' },
  { href: '/forms', labelKey: 'portal.nav.forms', icon: 'clipboard-list' },
  { href: '/bills', labelKey: 'portal.nav.bills', icon: 'receipt' },
];

/**
 * The assistant's own entry, appended only where one is configured.
 *
 * Last in the list on purpose. It is the newest thing here and the one a patient is least
 * likely to be looking for, and putting it first would push Home off the first tab stop of
 * a phone for a feature most deployments will not have.
 */
export const ASSISTANT_NAV_ITEM: NavItem = {
  href: '/assistant',
  labelKey: 'portal.nav.assistant',
  icon: 'message-circle',
};

/**
 * The sections to draw.
 *
 * The default is the portal without an assistant, so a practice that configured nothing
 * gets exactly the navigation it had before. ADR-0005 asks that no screen reserve space
 * for the agent, and a seventh tab that is sometimes a placeholder is space reserved.
 */
export function navItemsFor(assistantEnabled: boolean): readonly NavItem[] {
  return assistantEnabled ? [...NAV_ITEMS, ASSISTANT_NAV_ITEM] : NAV_ITEMS;
}

/**
 * Which section a pathname belongs to. '/' matches only itself; every other section also
 * owns its sub-paths, so a detail page keeps its tab lit.
 */
export function isActiveRoute(href: PortalRoute, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

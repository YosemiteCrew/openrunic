/**
 * The portal's six sections, in one list.
 *
 * The same array draws the bottom tab bar below 768px, the strip on a tablet and the left
 * rail from 1024px up. One list means one set of links in the DOM at every width, so a
 * screen reader never meets the navigation twice and a keyboard user never tabs through a
 * hidden copy of it.
 */

export type PortalRoute =
  '/' | '/health-record' | '/messages' | '/appointments' | '/forms' | '/bills';

export interface NavItem {
  href: PortalRoute;
  /** Full label, used at every width; the tab bar shortens nothing. */
  label: string;
  /** Lucide slug. Decorative - the label always carries the meaning. */
  icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home', icon: 'house' },
  { href: '/health-record', label: 'Health record', icon: 'heart-pulse' },
  { href: '/messages', label: 'Messages', icon: 'message-square' },
  { href: '/appointments', label: 'Appointments', icon: 'calendar' },
  { href: '/forms', label: 'Forms', icon: 'clipboard-list' },
  { href: '/bills', label: 'Bills', icon: 'receipt' },
];

/**
 * Which section a pathname belongs to. '/' matches only itself; every other section also
 * owns its sub-paths, so a detail page keeps its tab lit.
 */
export function isActiveRoute(href: PortalRoute, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

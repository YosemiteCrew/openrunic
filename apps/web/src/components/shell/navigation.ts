import type { Command, NavigateCommand } from '@/components/command';

/**
 * The staff navigation model.
 *
 * Seven areas in the rail, in workflow order rather than alphabetical: a front
 * desk lands on Schedule and works rightwards. Results is a real route but not
 * a rail item, because a provider reaches results from the inbox or the chart,
 * never by navigating to a list of everybody's labs.
 *
 * Badge counts appear on Inbox only. Nothing else nags.
 */

export interface NavArea {
  /**
   * Stable identity for this area, independent of what it is called.
   *
   * The palette's command id is built from this rather than from the label,
   * which used to be lowercased into the id directly. That was fine while there
   * was one language: it means a command's id changes when the reader's
   * language does, and anything keyed on it - a recently-used list, a shortcut,
   * a test - silently stops matching.
   */
  id: string;
  /** Catalogue key for the rail label and the palette's "Go to" entry. */
  labelKey: string;
  href: string;
  /** Lucide slug. */
  icon: string;
  /**
   * Catalogue key for the search words a tired person types instead of the
   * label, comma separated.
   *
   * Per-language and not transliterations: somebody searching in Spanish does
   * not type "flow", so the Spanish catalogue carries the words they do type.
   */
  keywordsKey: string;
}

export const NAV_AREAS: readonly NavArea[] = [
  {
    id: 'schedule',
    labelKey: 'nav.schedule',
    href: '/schedule',
    icon: 'calendar-days',
    keywordsKey: 'nav.schedule.keywords',
  },
  {
    // Kept verbatim from legacy systems: migrants know this board by this name.
    id: 'flow-board',
    labelKey: 'nav.flowBoard',
    href: '/schedule/flow-board',
    icon: 'columns-3',
    keywordsKey: 'nav.flowBoard.keywords',
  },
  {
    id: 'patients',
    labelKey: 'nav.patients',
    href: '/patients',
    icon: 'users',
    keywordsKey: 'nav.patients.keywords',
  },
  {
    id: 'inbox',
    labelKey: 'nav.inbox',
    href: '/inbox',
    icon: 'inbox',
    keywordsKey: 'nav.inbox.keywords',
  },
  {
    id: 'orders',
    labelKey: 'nav.orders',
    href: '/orders',
    icon: 'clipboard-list',
    keywordsKey: 'nav.orders.keywords',
  },
  {
    id: 'billing',
    labelKey: 'nav.billing',
    href: '/billing',
    icon: 'receipt',
    keywordsKey: 'nav.billing.keywords',
  },
  {
    id: 'reports',
    labelKey: 'nav.reports',
    href: '/reports',
    icon: 'chart-column',
    keywordsKey: 'nav.reports.keywords',
  },
  {
    id: 'admin',
    labelKey: 'nav.admin',
    href: '/admin',
    icon: 'settings',
    keywordsKey: 'nav.admin.keywords',
  },
];

/** Routes that are reachable but do not earn a rail row. */
const SECONDARY_ROUTES: readonly NavArea[] = [
  {
    id: 'results',
    labelKey: 'nav.results',
    href: '/results',
    icon: 'flask-conical',
    keywordsKey: 'nav.results.keywords',
  },
  {
    id: 'new-patient',
    labelKey: 'nav.newPatient',
    href: '/patients/new',
    icon: 'user-plus',
    keywordsKey: 'nav.newPatient.keywords',
  },
  {
    id: 'new-order',
    labelKey: 'nav.newOrder',
    href: '/orders/new',
    icon: 'circle-plus',
    keywordsKey: 'nav.newOrder.keywords',
  },
  {
    id: 'fee-sheet',
    labelKey: 'nav.feeSheet',
    href: '/billing/charges',
    icon: 'receipt-text',
    keywordsKey: 'nav.feeSheet.keywords',
  },
  {
    id: 'claim-workbench',
    labelKey: 'nav.claimWorkbench',
    href: '/billing/claims',
    icon: 'file-check',
    keywordsKey: 'nav.claimWorkbench.keywords',
  },
  {
    id: 'remittance',
    labelKey: 'nav.remittance',
    href: '/billing/remittance',
    icon: 'file-input',
    keywordsKey: 'nav.remittance.keywords',
  },
  {
    id: 'statements-and-ar',
    labelKey: 'nav.statements',
    href: '/billing/statements',
    icon: 'mail',
    keywordsKey: 'nav.statements.keywords',
  },
  {
    id: 'payments',
    labelKey: 'nav.payments',
    href: '/billing/payments',
    icon: 'credit-card',
    keywordsKey: 'nav.payments.keywords',
  },
  {
    id: 'users-and-roles',
    labelKey: 'nav.usersAndRoles',
    href: '/admin/users',
    icon: 'users',
    keywordsKey: 'nav.usersAndRoles.keywords',
  },
  {
    id: 'facilities',
    labelKey: 'nav.facilities',
    href: '/admin/facilities',
    icon: 'building-2',
    keywordsKey: 'nav.facilities.keywords',
  },
  {
    id: 'form-builder',
    labelKey: 'nav.formBuilder',
    href: '/admin/forms',
    icon: 'layout-template',
    keywordsKey: 'nav.formBuilder.keywords',
  },
  {
    id: 'audit-trail',
    labelKey: 'nav.auditTrail',
    href: '/admin/audit',
    icon: 'scroll-text',
    keywordsKey: 'nav.auditTrail.keywords',
  },
  {
    id: 'integrations',
    labelKey: 'nav.integrations',
    href: '/admin/integrations',
    icon: 'plug',
    keywordsKey: 'nav.integrations.keywords',
  },
  {
    id: 'developer-platform',
    labelKey: 'nav.developerPlatform',
    href: '/admin/developer',
    icon: 'code',
    keywordsKey: 'nav.developerPlatform.keywords',
  },
];

/** The rail row that owns a path, so a chart route still lights up "Patients". */
export function activeArea(pathname: string): NavArea | undefined {
  return [...NAV_AREAS]
    .filter((area) => pathname === area.href || pathname.startsWith(`${area.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * Every route as a palette command, in the reader's language.
 *
 * A function rather than a constant, because the labels and the search words
 * both depend on who is reading. The id does not: it comes from the area's own
 * `id`, so a command keeps its identity when the language changes. It used to
 * be the lowercased label, which meant every command silently got a new id the
 * moment the reader switched language, and anything keyed on it stopped
 * matching.
 */
export function navigateCommands(translate: (key: string) => string): Command[] {
  return [...NAV_AREAS, ...SECONDARY_ROUTES].map((area): NavigateCommand => ({
    id: `navigate.${area.id}`,
    group: 'navigate',
    label: translate(area.labelKey),
    href: area.href,
    icon: area.icon,
    keywords: translate(area.keywordsKey)
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word !== ''),
  }));
}

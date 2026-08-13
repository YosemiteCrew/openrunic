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
  /** Rail label and the palette's "Go to" entry. Sentence case. */
  label: string;
  href: string;
  /** Lucide slug. */
  icon: string;
  /** What a tired person might type instead of the label. */
  keywords: string[];
}

export const NAV_AREAS: readonly NavArea[] = [
  {
    label: 'Schedule',
    href: '/schedule',
    icon: 'calendar-days',
    keywords: ['calendar', 'day view', 'appointments', 'book', 'front desk'],
  },
  {
    // Kept verbatim from OpenEMR: migrants know this board by this name.
    label: 'Flow Board',
    href: '/schedule/flow-board',
    icon: 'columns-3',
    keywords: ['flow', 'board', 'waiting', 'rooms', 'check in', 'arrived', 'wait time'],
  },
  {
    label: 'Patients',
    href: '/patients',
    icon: 'users',
    keywords: ['chart', 'register', 'search', 'demographics', 'mrn'],
  },
  {
    label: 'Inbox',
    href: '/inbox',
    icon: 'inbox',
    keywords: ['tasks', 'messages', 'refills', 'cosign', 'worklist'],
  },
  {
    label: 'Orders',
    href: '/orders',
    icon: 'clipboard-list',
    keywords: ['labs', 'imaging', 'prescriptions', 'erx', 'requisition'],
  },
  {
    label: 'Billing',
    href: '/billing',
    icon: 'receipt',
    keywords: ['fee sheet', 'charges', 'claims', 'era', 'payments', 'aging'],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: 'chart-column',
    keywords: ['dashboard', 'kpi', 'exports', 'analytics'],
  },
  {
    label: 'Admin',
    href: '/admin',
    icon: 'settings',
    keywords: ['users', 'roles', 'facilities', 'form builder', 'settings', 'audit'],
  },
];

/** Routes that are reachable but do not earn a rail row. */
const SECONDARY_ROUTES: readonly NavArea[] = [
  {
    label: 'Results',
    href: '/results',
    icon: 'flask-conical',
    keywords: ['labs', 'flowsheet', 'sign off', 'abnormal', 'pending review'],
  },
  {
    label: 'New patient',
    href: '/patients/new',
    icon: 'user-plus',
    keywords: ['register', 'registration', 'walk-in', 'add patient', 'new record'],
  },
  {
    label: 'New order',
    href: '/orders/new',
    icon: 'circle-plus',
    keywords: ['order labs', 'order imaging', 'requisition', 'composer', 'procedure'],
  },
  /* Billing is one rail row and five workbenches. Each one is named here so a
     biller reaches the screen they mean by typing the word they use for it,
     rather than landing on Billing and hunting. */
  {
    label: 'Fee sheet',
    href: '/billing/charges',
    icon: 'receipt-text',
    keywords: ['charges', 'charge capture', 'superbill', 'cpt', 'justify', 'dx link'],
  },
  {
    label: 'Claim workbench',
    href: '/billing/claims',
    icon: 'file-check',
    keywords: ['claims', 'scrub', 'submit', 'denied', 'ageing', 'aging', '837'],
  },
  {
    label: 'Remittance',
    href: '/billing/remittance',
    icon: 'file-input',
    keywords: ['era', '835', 'eob', 'auto-post', 'posting', 'exceptions'],
  },
  {
    label: 'Statements and AR',
    href: '/billing/statements',
    icon: 'mail',
    keywords: ['statements', 'ar', 'aging', 'ageing', 'dunning', 'balances', 'text to pay'],
  },
  {
    label: 'Payments',
    href: '/billing/payments',
    icon: 'credit-card',
    keywords: ['payment', 'copay', 'collect', 'receipt', 'card on file', 'allocation'],
  },
  /* Admin is one rail row and six screens. Same reasoning as billing: an admin
     types the thing they came to change, not the section it lives under. */
  {
    label: 'Users and roles',
    href: '/admin/users',
    icon: 'users',
    keywords: ['staff', 'accounts', 'permissions', 'acl', 'invite', 'mfa', 'deactivate'],
  },
  {
    label: 'Facilities',
    href: '/admin/facilities',
    icon: 'building-2',
    keywords: ['locations', 'sites', 'pos code', 'hours', 'rooms', 'npi'],
  },
  {
    label: 'Form builder',
    href: '/admin/forms',
    icon: 'layout-template',
    keywords: ['forms', 'layout', 'lbf', 'intake', 'questionnaire', 'fields', 'publish'],
  },
  {
    label: 'Audit trail',
    href: '/admin/audit',
    icon: 'scroll-text',
    keywords: ['audit', 'access log', 'phi', 'breakglass', 'compliance', 'export'],
  },
  {
    label: 'Integrations',
    href: '/admin/integrations',
    icon: 'plug',
    keywords: ['adapters', 'erx', 'clearinghouse', 'labs', 'payments', 'fax', 'connections'],
  },
  {
    label: 'Developer platform',
    href: '/admin/developer',
    icon: 'code',
    keywords: ['api', 'keys', 'smart', 'fhir', 'oauth', 'webhooks', 'subscriptions'],
  },
];

/** The rail row that owns a path, so a chart route still lights up "Patients". */
export function activeAreaLabel(pathname: string): string | undefined {
  const match = [...NAV_AREAS]
    .filter((area) => pathname === area.href || pathname.startsWith(`${area.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label;
}

/**
 * Every route as a palette command. Registered once by the shell, so a new
 * screen becomes keyboard-reachable by adding one entry here and nothing else.
 */
export const NAVIGATE_COMMANDS: Command[] = [...NAV_AREAS, ...SECONDARY_ROUTES].map(
  (area): NavigateCommand => ({
    id: `navigate.${area.label.toLowerCase()}`,
    group: 'navigate',
    label: area.label,
    href: area.href,
    icon: area.icon,
    keywords: area.keywords,
  })
);

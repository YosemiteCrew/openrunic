/**
 * The admin area's own map.
 *
 * One entry gives the hub its card and the palette its "Go to" command, the
 * same way `navigation.ts` works for the rail. Admin and Reports are the only
 * places in the product that carry a breadcrumb, and this is where the trail's
 * middle segment comes from.
 */

export interface AdminArea {
  label: string;
  href: string;
  /** Lucide slug. */
  icon: string;
  /** One sentence: what an admin comes here to do. */
  description: string;
  keywords: string[];
}

export const ADMIN_AREAS: readonly AdminArea[] = [
  {
    label: 'Users and roles',
    href: '/admin/users',
    icon: 'users',
    description:
      'Staff accounts, the roles they hold, the facilities they work at, and who can do what.',
    keywords: ['staff', 'accounts', 'permissions', 'acl', 'invite', 'mfa', 'deactivate'],
  },
  {
    label: 'Facilities',
    href: '/admin/facilities',
    icon: 'building-2',
    description: 'Locations with their billing attributes, opening hours and rooms.',
    keywords: ['locations', 'sites', 'pos code', 'hours', 'rooms', 'npi'],
  },
  {
    label: 'Form builder',
    href: '/admin/forms',
    icon: 'layout-template',
    description: 'Build and publish the forms behind intake, encounters, referrals and the portal.',
    keywords: ['forms', 'layout', 'lbf', 'intake', 'questionnaire', 'fields', 'publish'],
  },
  {
    label: 'Audit trail',
    href: '/admin/audit',
    icon: 'scroll-text',
    description: 'Every access to patient data, append-only and exportable.',
    keywords: ['audit', 'access log', 'phi', 'breakglass', 'compliance', 'export'],
  },
  {
    label: 'Integrations',
    href: '/admin/integrations',
    icon: 'plug',
    description: 'The partner seams: prescribing, claims, labs, payments, fax, text and video.',
    keywords: ['adapters', 'erx', 'clearinghouse', 'labs', 'payments', 'fax', 'sms', 'connections'],
  },
  {
    label: 'Developer platform',
    href: '/admin/developer',
    icon: 'code',
    description: 'API keys, SMART on FHIR apps, and webhook subscriptions with their deliveries.',
    keywords: ['api', 'keys', 'smart', 'fhir', 'oauth', 'webhooks', 'subscriptions', 'developer'],
  },
];

/** The breadcrumb trail for a screen inside the admin area. */
export function adminBreadcrumb(label: string, current?: string) {
  const trail: Array<{ label: string; href?: string }> = [{ label: 'Admin', href: '/admin' }];
  const area = ADMIN_AREAS.find((candidate) => candidate.label === label);
  trail.push(current ? { label, href: area?.href } : { label });
  if (current) trail.push({ label: current });
  return trail;
}

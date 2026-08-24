/**
 * The admin area's own map.
 *
 * One entry gives the hub its card and the palette its "Go to" command, the
 * same way `navigation.ts` works for the rail. Admin and Reports are the only
 * places in the product that carry a breadcrumb, and this is where the trail's
 * middle segment comes from.
 *
 * The words are catalogue keys rather than sentences, for the same reason the
 * rail's are: this table is a module-scope constant, so it is built once and
 * cannot know who is reading it. `labelKey` is deliberately one key per area
 * rather than one per surface - the hub card, the breadcrumb crumb and the
 * screen's own `<h1>` all read it, so a screen cannot end up called one thing
 * in the trail and another at the top of itself.
 */

/**
 * The six areas, by a stable identity that is independent of what they are
 * called.
 *
 * Screens name themselves by this rather than by their label. A label-keyed
 * lookup would find nothing the moment the label was translated, and a
 * breadcrumb whose middle crumb has quietly lost its link reads as a design
 * decision rather than as a bug.
 */
export type AdminAreaId = 'users' | 'facilities' | 'forms' | 'audit' | 'integrations' | 'developer';

export interface AdminArea {
  /** Catalogue key for the area's name, everywhere it appears. */
  labelKey: string;
  href: string;
  /** Lucide slug. */
  icon: string;
  /** Catalogue key for one sentence: what an admin comes here to do. */
  descriptionKey: string;
  /** Catalogue key for the search words, comma separated and per-language. */
  keywordsKey: string;
}

/**
 * Keyed rather than searched, so `adminArea` is total: every id the type allows
 * resolves to an area, and there is no "area not found" path for a caller to
 * handle or for a test to have to reach.
 */
const AREAS: Readonly<Record<AdminAreaId, AdminArea>> = {
  users: {
    labelKey: 'admin.areas.users.label',
    href: '/admin/users',
    icon: 'users',
    descriptionKey: 'admin.areas.users.description',
    keywordsKey: 'admin.areas.users.keywords',
  },
  facilities: {
    labelKey: 'admin.areas.facilities.label',
    href: '/admin/facilities',
    icon: 'building-2',
    descriptionKey: 'admin.areas.facilities.description',
    keywordsKey: 'admin.areas.facilities.keywords',
  },
  forms: {
    labelKey: 'admin.areas.forms.label',
    href: '/admin/forms',
    icon: 'layout-template',
    descriptionKey: 'admin.areas.forms.description',
    keywordsKey: 'admin.areas.forms.keywords',
  },
  audit: {
    labelKey: 'admin.areas.audit.label',
    href: '/admin/audit',
    icon: 'scroll-text',
    descriptionKey: 'admin.areas.audit.description',
    keywordsKey: 'admin.areas.audit.keywords',
  },
  integrations: {
    labelKey: 'admin.areas.integrations.label',
    href: '/admin/integrations',
    icon: 'plug',
    descriptionKey: 'admin.areas.integrations.description',
    keywordsKey: 'admin.areas.integrations.keywords',
  },
  developer: {
    labelKey: 'admin.areas.developer.label',
    href: '/admin/developer',
    icon: 'code',
    descriptionKey: 'admin.areas.developer.description',
    keywordsKey: 'admin.areas.developer.keywords',
  },
};

/** The hub's reading order: what an admin reaches for most, first. */
export const ADMIN_AREAS: readonly AdminArea[] = [
  AREAS.users,
  AREAS.facilities,
  AREAS.forms,
  AREAS.audit,
  AREAS.integrations,
  AREAS.developer,
];

/** One area by its stable id. */
export function adminArea(id: AdminAreaId): AdminArea {
  return AREAS[id];
}

/**
 * The breadcrumb trail for a screen inside the admin area.
 *
 * Takes the translator rather than the words, because `Breadcrumb` renders
 * strings: the crumbs have to be in the reader's language by the time they get
 * there. `current` names the record being edited - a form's name and version -
 * and arrives already formatted, because it is data rather than copy.
 */
export function adminBreadcrumb(
  translate: (key: string) => string,
  areaId: AdminAreaId,
  current?: string
) {
  const area = adminArea(areaId);
  const label = translate(area.labelKey);
  const trail: Array<{ label: string; href?: string }> = [
    { label: translate('nav.admin'), href: '/admin' },
  ];
  trail.push(current ? { label, href: area.href } : { label });
  if (current) trail.push({ label: current });
  return trail;
}

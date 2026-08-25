import { describe, expect, it } from 'vitest';
import { ASSISTANT_NAV_ITEM, NAV_ITEMS, isActiveRoute, navItemsFor } from '@/lib/nav';

describe('NAV_ITEMS', () => {
  it('lists the portal six in order, each with a label to look up and an icon', () => {
    // Keys rather than words. The words are in the catalogue and the shell looks
    // them up, so what this file owns is the order and the completeness of the
    // list; `catalogue-drift.test.ts` owns whether each key resolves.
    expect(NAV_ITEMS.map((item) => item.labelKey)).toEqual([
      'portal.nav.home',
      'portal.nav.healthRecord',
      'portal.nav.messages',
      'portal.nav.appointments',
      'portal.nav.forms',
      'portal.nav.bills',
    ]);
    expect(NAV_ITEMS.every((item) => item.icon.length > 0)).toBe(true);
  });

  it('has no duplicate destinations', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('navItemsFor', () => {
  it('gives a portal with no assistant the navigation it has always had', () => {
    expect(navItemsFor(false)).toEqual(NAV_ITEMS);
    expect(navItemsFor(false)).not.toContain(ASSISTANT_NAV_ITEM);
  });

  it('appends the assistant last, where it cannot displace Home on a phone', () => {
    const items = navItemsFor(true);
    expect(items).toHaveLength(NAV_ITEMS.length + 1);
    expect(items.at(-1)).toEqual(ASSISTANT_NAV_ITEM);
    expect(items[0]?.labelKey).toBe('portal.nav.home');
  });

  it('never repeats a destination', () => {
    const hrefs = navItemsFor(true).map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('isActiveRoute', () => {
  it('lights home only on home', () => {
    expect(isActiveRoute('/', '/')).toBe(true);
    expect(isActiveRoute('/', '/bills')).toBe(false);
  });

  it('lights a section on its own path', () => {
    expect(isActiveRoute('/messages', '/messages')).toBe(true);
    expect(isActiveRoute('/messages', '/bills')).toBe(false);
  });

  it('keeps a section lit on its sub-paths', () => {
    expect(isActiveRoute('/bills', '/bills/stmt-1')).toBe(true);
  });

  it('does not match a section that merely shares a prefix', () => {
    expect(isActiveRoute('/forms', '/forms-archive')).toBe(false);
  });
});

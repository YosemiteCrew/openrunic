import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isActiveRoute } from '@/lib/nav';

describe('NAV_ITEMS', () => {
  it('lists the portal six, each with a label and an icon', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Home',
      'Health record',
      'Messages',
      'Appointments',
      'Forms',
      'Bills',
    ]);
    expect(NAV_ITEMS.every((item) => item.icon.length > 0)).toBe(true);
  });

  it('has no duplicate destinations', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
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

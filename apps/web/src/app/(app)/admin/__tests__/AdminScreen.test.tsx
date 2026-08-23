import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminScreen } from '@/app/(app)/admin/AdminScreen';
import { ADMIN_AREAS, adminBreadcrumb } from '@/components/admin';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
}));

describe('AdminScreen', () => {
  it('offers every admin area as a real link, one sentence each', () => {
    render(<AdminScreen />);

    for (const area of ADMIN_AREAS) {
      const link = screen.getByRole('link', { name: area.label });
      expect(link).toHaveAttribute('href', area.href);
    }
    expect(screen.getByText(/Staff accounts, the roles they hold/)).toBeInTheDocument();
  });

  it('keeps the hub reachable by keyboard: no clickable boxes', () => {
    render(<AdminScreen />);
    // The hub is the <main> content; the rail is its own landmark.
    const main = screen.getByRole('main');
    const headings = within(main).getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(ADMIN_AREAS.length);
    for (const heading of headings) {
      expect(within(heading).getByRole('link')).toBeInTheDocument();
    }
  });

  it('lights Admin in the rail', () => {
    render(<AdminScreen />);
    const rail = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(rail).getByRole('link', { name: /Admin/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('adminBreadcrumb', () => {
  it('trails Admin then the area, with the area as the current page', () => {
    expect(adminBreadcrumb('Audit trail')).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'Audit trail' },
    ]);
  });

  it('links the area when a third crumb names the record being edited', () => {
    expect(adminBreadcrumb('Form builder', 'Adult intake v3')).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'Form builder', href: '/admin/forms' },
      { label: 'Adult intake v3' },
    ]);
  });
});

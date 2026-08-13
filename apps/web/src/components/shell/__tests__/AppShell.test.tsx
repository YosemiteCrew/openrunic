import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/shell/AppShell';
import { activeAreaLabel, NAVIGATE_COMMANDS, NAV_AREAS } from '@/components/shell/navigation';

const push = vi.fn();
let pathname = '/schedule';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
}));

beforeEach(() => {
  push.mockClear();
  pathname = '/schedule';
});

describe('activeAreaLabel', () => {
  it('lights the rail row that owns the route', () => {
    expect(activeAreaLabel('/schedule')).toBe('Schedule');
    expect(activeAreaLabel('/patients')).toBe('Patients');
  });

  it('keeps a chart route under Patients', () => {
    expect(activeAreaLabel('/patients/0192f1a0-0000-7000-8000-00000000p001')).toBe('Patients');
  });

  it('lights nothing for a route outside the rail', () => {
    expect(activeAreaLabel('/')).toBeUndefined();
  });
});

describe('NAVIGATE_COMMANDS', () => {
  it('makes every rail area reachable from the palette', () => {
    for (const area of NAV_AREAS) {
      expect(NAVIGATE_COMMANDS.some((command) => command.href === area.href)).toBe(true);
    }
  });

  it('also reaches the routes that have no rail row', () => {
    expect(NAVIGATE_COMMANDS.some((command) => command.href === '/results')).toBe(true);
  });
});

describe('AppShell', () => {
  it('gives every screen the same landmarks', () => {
    render(
      <AppShell title="Schedule">
        <p>day view</p>
      </AppShell>
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument();
  });

  it('exposes the main landmark as the skip link target', () => {
    render(<AppShell title="Schedule">content</AppShell>);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('marks the current area in the rail with aria-current, not colour alone', () => {
    render(<AppShell title="Schedule">content</AppShell>);
    const rail = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(rail).getByRole('link', { name: /Schedule/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('collapses to a labelled Menu button below the rail breakpoint', () => {
    render(<AppShell title="Schedule">content</AppShell>);

    // The library's SideNav is a drawer below 1024px. jsdom has no viewport, so
    // what is asserted here is the behaviour the breakpoint switches on: a
    // named control that opens a focus-trapped dialog and reports its state.
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('navigates by pushing the area route, never by reloading', () => {
    render(<AppShell title="Schedule">content</AppShell>);
    const rail = screen.getByRole('navigation', { name: 'Primary' });

    fireEvent.click(within(rail).getByRole('link', { name: /Billing/ }));
    expect(push).toHaveBeenCalledWith('/billing');
  });

  it('renders the breadcrumb slot with the last crumb as the current page', () => {
    render(
      <AppShell
        title="Intake v3"
        breadcrumb={[
          { label: 'Admin', href: '/admin' },
          { label: 'Form builder', href: '/admin/forms' },
          { label: 'Intake v3' },
        ]}
      >
        content
      </AppShell>
    );

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(within(crumbs).getByText('Intake v3')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the right rail as its own labelled region', () => {
    render(
      <AppShell title="Chart" rightRail={<p>allergies</p>}>
        content
      </AppShell>
    );

    const rail = screen.getByRole('complementary', { name: 'Page context' });
    expect(within(rail).getByText('allergies')).toBeInTheDocument();
  });

  it('omits the rail and the breadcrumb when a screen does not fill them', () => {
    render(<AppShell title="Schedule">content</AppShell>);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('offers the palette as a visible control, not a hidden shortcut', () => {
    render(<AppShell title="Schedule">content</AppShell>);
    expect(screen.getByRole('button', { name: /Search or run a command/ })).toBeInTheDocument();
  });

  it('says when the screen is reading demo data', () => {
    render(<AppShell title="Schedule">content</AppShell>);
    expect(screen.getByText('Placeholder data')).toBeInTheDocument();
  });
});

describe('the shell with no assistant configured', () => {
  /**
   * The most important guarantee in ADR-0005, asserted through the real shell
   * rather than through the panel in isolation: a clinic that configured
   * nothing gets the product it had before. No control, no reserved column, no
   * "not configured" empty state, and nothing in the top bar.
   */
  it('renders no assistant affordance anywhere', async () => {
    const { container } = render(<AppShell title="Schedule">content</AppShell>);

    // After the capability probe has had a chance to settle, not merely on the
    // first frame: a placeholder that appears and then disappears is still
    // layout space reserved for the agent.
    await waitFor(() => expect(container.querySelector('.or-assistant')).toBeNull());

    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(container.textContent).not.toMatch(/assistant/i);
  });

  it('leaves the shell a single column, with only the bar and the content in it', async () => {
    const { container } = render(<AppShell title="Schedule">content</AppShell>);
    await waitFor(() => expect(container.querySelector('.or-assistant')).toBeNull());

    // The stylesheet gives `.or-app__body` a second column only through
    // `:has(> .or-assistant)`, so with no panel node there is nothing for that
    // rule to match and the layout is exactly what it was.
    const body = container.querySelector('.or-app__body');
    expect(body?.children).toHaveLength(2);
    expect(body?.children[0]).toHaveClass('or-topbar');
    expect(body?.children[1]?.tagName).toBe('MAIN');
  });
});

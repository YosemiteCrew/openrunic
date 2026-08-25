import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brandAssetCssUrl } from '../../assets/brand';
import { SideNav } from './SideNav';
import type { SideNavItem } from './SideNav';

const ITEMS: SideNavItem[] = [
  { label: 'Today', icon: 'sun' },
  { label: 'Records', icon: 'folder-open', badge: 128 },
  { label: 'Results', icon: 'flask-conical', badge: 4 },
  { label: 'Care team', icon: 'users' },
  { label: 'Consent', icon: 'shield-check' },
];

const openDrawer = async () => {
  const toggle = screen.getByRole('button', { name: 'Menu' });
  await userEvent.click(toggle);
  return toggle;
};

describe('SideNav', () => {
  it('renders a named navigation landmark with the lockup and every row', () => {
    render(<SideNav items={ITEMS} active="Records" />);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(screen.getByRole('img', { name: 'openrunic' })).toBeInTheDocument();

    const rows = within(nav).getAllByRole('link');
    expect(rows).toHaveLength(ITEMS.length);
    expect(rows[0]).toHaveAttribute('href', '#Today');
    expect(within(nav).getByRole('link', { name: /Care team/ })).toHaveAttribute(
      'href',
      '#Care%20team'
    );
  });

  it('fills the active row and says so beyond the colour', () => {
    render(<SideNav items={ITEMS} active="Records" />);

    const records = screen.getByRole('link', { name: /Records/ });
    expect(records).toHaveClass('or-side-nav__link--active');
    expect(records).toHaveAttribute('aria-current', 'page');

    const today = screen.getByRole('link', { name: 'Today' });
    expect(today).not.toHaveClass('or-side-nav__link--active');
    expect(today).not.toHaveAttribute('aria-current');
  });

  it('renders a row icon hidden from assistive technology, and copes with an unknown slug', () => {
    const mixed: SideNavItem[] = [
      { label: 'Today', icon: 'sun' },
      { label: 'Ledger', icon: 'not-a-lucide-slug' },
    ];
    const { container } = render(<SideNav items={mixed} />);

    const icons = container.querySelectorAll('.or-side-nav__icon');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: 'Ledger' })).toBeInTheDocument();
  });

  it('shows a trailing count only when there is one', () => {
    const { container } = render(
      <SideNav
        items={[
          { label: 'Records', icon: 'folder-open', badge: 128 },
          { label: 'Results', icon: 'flask-conical', badge: 0 },
          { label: 'Today', icon: 'sun' },
        ]}
      />
    );
    const badges = container.querySelectorAll('.or-side-nav__badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('128');
  });

  it('reports the row and suppresses navigation when one is chosen', () => {
    const onNavigate = vi.fn();
    render(<SideNav items={ITEMS} active="Today" onNavigate={onNavigate} />);

    expect(fireEvent.click(screen.getByRole('link', { name: /Records/ }))).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith('Records');
  });

  it('survives a missing onNavigate', async () => {
    render(<SideNav items={ITEMS} />);
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('opens the drawer from the Menu button and reports its state', async () => {
    const { container } = render(<SideNav items={ITEMS} active="Today" />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const panel = container.querySelector('.or-side-nav__panel');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', panel?.id ?? '');
    expect(container.querySelector('.or-side-nav__scrim')).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.or-side-nav')).toHaveClass('or-side-nav--open');
    expect(container.querySelector('.or-side-nav__scrim')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Primary' })).toBe(panel);
  });

  it('moves focus into the drawer on open and back to the Menu button on Escape', async () => {
    const { container } = render(<SideNav items={ITEMS} />);
    const toggle = await openDrawer();

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();

    expect(fireEvent.keyDown(close, { key: 'Escape' })).toBe(true);
    expect(container.querySelector('.or-side-nav')).not.toHaveClass('or-side-nav--open');
    expect(toggle).toHaveFocus();
  });

  it('closes the drawer from the Close button and from the scrim', async () => {
    const { container } = render(<SideNav items={ITEMS} />);
    const toggle = await openDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(container.querySelector('.or-side-nav')).not.toHaveClass('or-side-nav--open');
    expect(toggle).toHaveFocus();

    await userEvent.click(toggle);
    const scrim = container.querySelector('.or-side-nav__scrim');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);
    expect(container.querySelector('.or-side-nav')).not.toHaveClass('or-side-nav--open');
  });

  it('closes the drawer once a row is chosen', async () => {
    const onNavigate = vi.fn();
    const { container } = render(<SideNav items={ITEMS} onNavigate={onNavigate} />);
    await openDrawer();

    await userEvent.click(screen.getByRole('link', { name: /Records/ }));
    expect(onNavigate).toHaveBeenCalledWith('Records');
    expect(container.querySelector('.or-side-nav')).not.toHaveClass('or-side-nav--open');
  });

  it('traps Tab inside the open drawer and wraps at both ends', async () => {
    render(<SideNav items={ITEMS} />);
    await openDrawer();

    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('link', { name: 'Consent' });

    expect(close).toHaveFocus();
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();

    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(close).toHaveFocus();
  });

  it('leaves Tab alone in the middle of the drawer, and every key while it is shut', async () => {
    render(<SideNav items={ITEMS} />);
    const toggle = await openDrawer();

    const middle = screen.getByRole('link', { name: 'Today' });
    middle.focus();
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true);
    expect(middle).toHaveFocus();

    expect(fireEvent.keyDown(middle, { key: 'ArrowDown' })).toBe(true);
    expect(middle).toHaveFocus();

    await userEvent.click(toggle);
    expect(fireEvent.keyDown(toggle, { key: 'Escape' })).toBe(true);
    expect(fireEvent.keyDown(toggle, { key: 'Tab' })).toBe(true);
  });

  it('pins a footer below the rows only when one is supplied', () => {
    const { container, rerender } = render(<SideNav items={ITEMS} />);
    expect(container.querySelector('.or-side-nav__footer')).toBeNull();

    rerender(<SideNav items={ITEMS} footer={<span>Ines Moreau - self-hosted</span>} />);
    expect(container.querySelector('.or-side-nav__footer')).toHaveTextContent(
      'Ines Moreau - self-hosted'
    );
  });

  it('masks the bundled lockup by default and honours a caller asset directory', () => {
    const { container, rerender } = render(<SideNav items={ITEMS} />);
    const read = () =>
      container
        .querySelector<HTMLElement>('.or-side-nav__logo')
        ?.style.getPropertyValue('--or-side-nav-logo-src');

    expect(read()).toBe(brandAssetCssUrl('lockup-horizontal.svg'));
    expect(read()).toContain('data:image/svg+xml');

    rerender(<SideNav items={ITEMS} logoBasePath="/brand/open runic" />);
    expect(read()).toBe('url("/brand/open%20runic/lockup-horizontal.svg")');
  });

  it('merges className and forwards native attributes', () => {
    const { container } = render(
      <SideNav items={ITEMS} className="or-shell-rail" id="shell-rail" data-testid="rail" />
    );
    const root = container.querySelector('.or-side-nav');
    expect(root).toHaveClass('or-side-nav', 'or-shell-rail');
    expect(root).toHaveAttribute('id', 'shell-rail');
    expect(screen.getByTestId('rail')).toBe(root);
    expect(screen.getByRole('navigation')).toHaveAttribute('id', 'shell-rail-drawer');
  });

  it('takes every word it says from the consumer', () => {
    /*
     * The design system has no translator, so these were English literals in the
     * component: a Spanish staff screen announced its primary navigation as
     * "Primary" and its buttons as "Menu" and "Close". They are props with those
     * English defaults now, and this is what says the props are actually read.
     */
    render(
      <SideNav
        items={ITEMS}
        navLabel="Navegación principal"
        menuLabel="Menú"
        closeLabel="Cerrar el menú"
        brandLabel="openrunic"
      />
    );

    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menú' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar el menú' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'openrunic' })).toBeInTheDocument();
  });
});

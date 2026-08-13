import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavBar } from './NavBar';

const ITEMS = ['Product', 'Docs', 'Open source', 'Blog'];

describe('NavBar', () => {
  it('renders a banner with the lockup, the sections and the default call to action', () => {
    const { container } = render(<NavBar items={ITEMS} active="Docs" />);

    const bar = screen.getByRole('banner');
    expect(bar).toHaveClass('or-nav-bar', 'or-nav-bar--bone');
    expect(screen.getByRole('link', { name: 'OpenRunic home' })).toBeInTheDocument();
    expect(container.querySelector('.or-nav-bar__logo')).toHaveAttribute('aria-hidden', 'true');

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const sections = within(nav).getAllByRole('link');
    expect(sections.map((link) => link.textContent)).toEqual(ITEMS);
    expect(screen.getByRole('button', { name: 'Get started' })).toHaveClass('or-btn--primary');
  });

  it('marks the active section with the terracotta modifier and aria-current', () => {
    render(<NavBar items={ITEMS} active="Docs" />);

    const docs = screen.getByRole('link', { name: 'Docs' });
    expect(docs).toHaveClass('or-nav-bar__link--active');
    expect(docs).toHaveAttribute('aria-current', 'page');

    const blog = screen.getByRole('link', { name: 'Blog' });
    expect(blog).not.toHaveClass('or-nav-bar__link--active');
    expect(blog).not.toHaveAttribute('aria-current');
  });

  it('links each section to its own fragment, encoded', () => {
    render(<NavBar items={ITEMS} />);
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute(
      'href',
      '#Open%20source'
    );
  });

  it('reports the section and suppresses navigation when one is chosen', async () => {
    const onNavigate = vi.fn();
    render(<NavBar items={ITEMS} active="Product" onNavigate={onNavigate} />);

    const docs = screen.getByRole('link', { name: 'Docs' });
    expect(fireEvent.click(docs)).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith('Docs');
  });

  it('sends the lockup link to the first section, and does nothing without sections', async () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<NavBar items={ITEMS} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole('link', { name: 'OpenRunic home' }));
    expect(onNavigate).toHaveBeenCalledWith('Product');

    onNavigate.mockClear();
    rerender(<NavBar onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('link', { name: 'OpenRunic home' }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('survives a missing onNavigate on both the sections and the lockup', async () => {
    render(<NavBar items={ITEMS} />);
    await userEvent.click(screen.getByRole('link', { name: 'Docs' }));
    await userEvent.click(screen.getByRole('link', { name: 'OpenRunic home' }));
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('opens and closes the phone menu, and reports its state on the toggle', async () => {
    const { container } = render(<NavBar items={ITEMS} active="Docs" />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const panel = container.querySelector('.or-nav-bar__panel');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', panel?.id ?? '');
    expect(panel).not.toHaveClass('or-nav-bar__panel--open');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveClass('or-nav-bar__panel--open');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toHaveClass('or-nav-bar__panel--open');
  });

  it('closes the phone menu on Escape and leaves other keys alone', async () => {
    const { container } = render(<NavBar items={ITEMS} />);
    const bar = screen.getByRole('banner');
    const panel = container.querySelector('.or-nav-bar__panel');

    fireEvent.keyDown(bar, { key: 'Escape' });
    expect(panel).not.toHaveClass('or-nav-bar__panel--open');

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.keyDown(bar, { key: 'ArrowDown' });
    expect(panel).toHaveClass('or-nav-bar__panel--open');

    fireEvent.keyDown(bar, { key: 'Escape' });
    expect(panel).not.toHaveClass('or-nav-bar__panel--open');
  });

  it('closes the phone menu once a section is chosen', async () => {
    const { container } = render(<NavBar items={ITEMS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'Blog' }));
    expect(container.querySelector('.or-nav-bar__panel')).not.toHaveClass(
      'or-nav-bar__panel--open'
    );
  });

  it('closes the phone menu when the lockup is chosen', async () => {
    const { container } = render(<NavBar items={ITEMS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'OpenRunic home' }));
    expect(container.querySelector('.or-nav-bar__panel')).not.toHaveClass(
      'or-nav-bar__panel--open'
    );
  });

  it('repaints for the espresso band and swaps the default call to action to inverse', () => {
    render(<NavBar items={ITEMS} tone="espresso" />);
    expect(screen.getByRole('banner')).toHaveClass('or-nav-bar--espresso');
    expect(screen.getByRole('button', { name: 'Get started' })).toHaveClass('or-btn--inverse');
  });

  it('replaces the default call to action when one is supplied', () => {
    render(<NavBar items={ITEMS} cta={<button type="button">Open the app</button>} />);
    expect(screen.getByRole('button', { name: 'Open the app' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Get started' })).not.toBeInTheDocument();
  });

  it('points the lockup mask at the supplied asset directory', () => {
    const { container, rerender } = render(<NavBar items={ITEMS} />);
    const read = () =>
      container
        .querySelector<HTMLElement>('.or-nav-bar__logo')
        ?.style.getPropertyValue('--or-nav-bar-logo-src');

    expect(read()).toBe('url("assets/logo/lockup-horizontal.svg")');

    rerender(<NavBar items={ITEMS} logoBasePath="/brand/open runic" />);
    expect(read()).toBe('url("/brand/open%20runic/lockup-horizontal.svg")');
  });

  it('merges className and forwards native attributes', () => {
    render(<NavBar items={ITEMS} className="or-docs-bar" id="docs-bar" data-testid="bar" />);
    const bar = screen.getByRole('banner');
    expect(bar).toHaveClass('or-nav-bar', 'or-docs-bar');
    expect(bar).toHaveAttribute('id', 'docs-bar');
    expect(screen.getByTestId('bar')).toBe(bar);
  });
});

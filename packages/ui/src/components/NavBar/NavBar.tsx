import { useState } from 'react';
import type { CSSProperties, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';
import type { BandTone } from '../../types';
import { Button } from '../Button';

/** The shipped horizontal lockup, drawn through a mask so it inherits the band's ink. */
const LOCKUP = 'lockup-horizontal.svg';

export interface NavBarProps extends HTMLAttributes<HTMLElement> {
  /** Section labels in bar order. The first is treated as home by the lockup link. */
  items?: string[];
  /** Label of the section currently being read. */
  active?: string;
  onNavigate?: (item: string) => void;
  /** Band the bar sits on. */
  tone?: BandTone;
  /** Replaces the default primary button on the right. */
  cta?: ReactNode;
  /** Path to the copied assets/logo directory, relative to the page. */
  logoBasePath?: string;
}

/**
 * Marketing and docs top bar. Horizontal from md; below md the sections and the call to
 * action collapse behind a menu button, because a row of links cannot survive a 375px
 * viewport. The active section is terracotta ink plus a 1.5px terracotta rule, and the
 * espresso tone swaps the whole bar to the inverse band without changing the shape.
 */
export function NavBar({
  items = [],
  active,
  onNavigate,
  tone = 'bone',
  cta,
  logoBasePath = 'assets/logo',
  className,
  id,
  ...rest
}: NavBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const barId = useFieldId(id);
  const menuId = `${barId}-menu`;
  const inverse = tone === 'espresso';

  /* A stylesheet cannot know the consumer's asset path, so the one thing that has to be
     inline is the mask URL. Everything else about the lockup lives in NavBar.css. */
  const logoStyle = {
    '--or-nav-bar-logo-src': `url("${encodeURI(logoBasePath)}/${LOCKUP}")`,
  } as CSSProperties;

  const navigate = (item: string) => (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate?.(item);
  };

  const handleHome = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuOpen(false);
    const home = items[0];
    if (home !== undefined) onNavigate?.(home);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && menuOpen) setMenuOpen(false);
  };

  return (
    <header
      id={barId}
      className={cx('or-nav-bar', `or-nav-bar--${tone}`, className)}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      <a className="or-nav-bar__home" href="#" aria-label="OpenRunic home" onClick={handleHome}>
        <span className="or-nav-bar__logo" style={logoStyle} aria-hidden="true" />
      </a>

      <Button
        className="or-nav-bar__toggle"
        variant="ghost"
        size="sm"
        iconLeft={menuOpen ? 'x' : 'menu'}
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenuOpen((open) => !open)}
      >
        Menu
      </Button>

      <div id={menuId} className={cx('or-nav-bar__panel', menuOpen && 'or-nav-bar__panel--open')}>
        {items.length > 0 ? (
          <nav className="or-nav-bar__nav" aria-label="Sections">
            <ul className="or-nav-bar__list">
              {items.map((item) => {
                const current = item === active;
                return (
                  <li key={item}>
                    <a
                      className={cx('or-nav-bar__link', current && 'or-nav-bar__link--active')}
                      href={`#${encodeURIComponent(item)}`}
                      aria-current={current ? 'page' : undefined}
                      onClick={navigate(item)}
                    >
                      <span className="or-nav-bar__link-label">{item}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
        <div className="or-nav-bar__actions">
          {cta ?? (
            <Button size="sm" variant={inverse ? 'inverse' : 'primary'}>
              Get started
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

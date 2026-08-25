import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { brandAssetCssUrl } from '../../assets/brand';
import type { BrandLogoFile } from '../../assets/brand';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';
import type { IconSlug } from '../../types';
import { Button } from '../Button';

/** The shipped horizontal lockup, drawn through a mask so it inherits the rail's ink. */
const LOCKUP: BrandLogoFile = 'lockup-horizontal.svg';

/** Row icon size, straight from the design system's sidebar specimen. */
const ICON_SIZE = 17;

/** Everything the drawer can hand focus to while it is trapping it. */
const FOCUSABLE = 'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface SideNavItem {
  label: string;
  /** Lucide icon slug. */
  icon: IconSlug;
  /** Trailing count. */
  badge?: string | number;
}

export interface SideNavProps extends HTMLAttributes<HTMLElement> {
  items?: SideNavItem[];
  /** Label of the row currently being read. */
  active?: string;
  onNavigate?: (label: string) => void;
  /** Pinned to the bottom - account row, help link. */
  footer?: ReactNode;
  /**
   * THE WORDS THIS COMPONENT SAYS, AND WHY THEY ARE PROPS.
   *
   * A design system has no translator and should not grow one. The label on a
   * navigation landmark is configuration, the same as its items are, and a
   * consumer that renders in more than one language has to be able to supply it.
   * These were written into the component, so a Spanish staff screen announced
   * its primary navigation as "Primary" and its menu button as "Menu".
   *
   * Every one defaults to the English it used to hardcode, so a consumer who
   * passes nothing gets exactly today's behaviour.
   */
  /** The accessible name of the navigation landmark. */
  navLabel?: string;
  /** The button that opens the panel below lg. */
  menuLabel?: string;
  /** The button that closes it. */
  closeLabel?: string;
  /** Alt text for the brand lockup. */
  brandLabel?: string;
  /**
   * Serve the lockup from your own copy of the design system's assets/logo directory
   * instead of the mark bundled with this package. The mark is a shipped file either way.
   */
  logoBasePath?: string;
}

/**
 * Primary navigation inside the product shell. A persistent rail from lg, and below lg an
 * off-canvas drawer behind a labelled Menu button: Escape closes it, focus is trapped while
 * it is open and returns to the button when it shuts. The active row is a cream fill with a
 * terracotta icon, never colour alone - it also carries aria-current and a heavier weight.
 */
export function SideNav({
  items = [],
  active,
  onNavigate,
  footer,
  logoBasePath,
  navLabel = 'Primary',
  menuLabel = 'Menu',
  closeLabel = 'Close',
  brandLabel = 'openrunic',
  className,
  id,
  ...rest
}: SideNavProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const navId = useFieldId(id);
  const panelId = `${navId}-drawer`;

  /* A stylesheet cannot know the consumer's asset path, so the one thing that has to be
     inline is the mask URL. Everything else about the lockup lives in SideNav.css. */
  const logoStyle = {
    '--or-side-nav-logo-src': brandAssetCssUrl(LOCKUP, logoBasePath),
  } as CSSProperties;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLElement>('.or-side-nav__toggle')?.focus();
  };

  const navigate = (label: string) => (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    // Only the drawer needs shutting; the lg rail never opened, so leave focus on the row.
    if (open) close();
    onNavigate?.(label);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;

    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      id={navId}
      className={cx('or-side-nav', open && 'or-side-nav--open', className)}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      <Button
        className="or-side-nav__toggle"
        variant="secondary"
        size="sm"
        iconLeft={open ? 'x' : 'menu'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {menuLabel}
      </Button>

      {open ? <div className="or-side-nav__scrim" aria-hidden="true" onClick={close} /> : null}

      <nav
        ref={panelRef}
        id={panelId}
        className="or-side-nav__panel"
        aria-label={navLabel}
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
      >
        <div className="or-side-nav__brand">
          <span
            className="or-side-nav__logo"
            style={logoStyle}
            role="img"
            aria-label={brandLabel}
          />
          <Button
            className="or-side-nav__close"
            variant="ghost"
            size="sm"
            iconLeft="x"
            onClick={close}
          >
            {closeLabel}
          </Button>
        </div>

        <ul className="or-side-nav__list">
          {items.map((item) => {
            const current = item.label === active;
            const RowIcon = resolveLucideIcon(item.icon);
            return (
              <li key={item.label}>
                <a
                  className={cx('or-side-nav__link', current && 'or-side-nav__link--active')}
                  href={`#${encodeURIComponent(item.label)}`}
                  aria-current={current ? 'page' : undefined}
                  onClick={navigate(item.label)}
                >
                  {RowIcon ? (
                    <RowIcon
                      className="or-side-nav__icon"
                      size={ICON_SIZE}
                      strokeWidth={ICON_STROKE_WIDTH}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="or-side-nav__label">{item.label}</span>
                  {item.badge ? <span className="or-side-nav__badge">{item.badge}</span> : null}
                </a>
              </li>
            );
          })}
        </ul>

        {footer ? <div className="or-side-nav__footer">{footer}</div> : null}
      </nav>
    </div>
  );
}

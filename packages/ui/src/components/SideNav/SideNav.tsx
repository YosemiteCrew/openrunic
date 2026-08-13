import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';
import type { IconSlug } from '../../types';
import { Button } from '../Button';

/** The shipped horizontal lockup, drawn through a mask so it inherits the rail's ink. */
const LOCKUP = 'lockup-horizontal.svg';

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
  /** Path to the copied assets/logo directory, relative to the page. */
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
  logoBasePath = 'assets/logo',
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
    '--or-side-nav-logo-src': `url("${encodeURI(logoBasePath)}/${LOCKUP}")`,
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
        Menu
      </Button>

      {open ? <div className="or-side-nav__scrim" aria-hidden="true" onClick={close} /> : null}

      <nav
        ref={panelRef}
        id={panelId}
        className="or-side-nav__panel"
        aria-label="Primary"
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
      >
        <div className="or-side-nav__brand">
          <span className="or-side-nav__logo" style={logoStyle} role="img" aria-label="OpenRunic" />
          <Button
            className="or-side-nav__close"
            variant="ghost"
            size="sm"
            iconLeft="x"
            onClick={close}
          >
            Close
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

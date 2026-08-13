import type { HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { IconButtonVariant, IconSlug, Size } from '../../types';

/** Glyph inside each box: 16 / 19 / 22, straight off the design system's control specimen. */
const ICON_SIZE: Record<Size, number> = { sm: 16, md: 19, lg: 22 };

/* `title` is omitted from the inherited attributes on purpose: the component owns it and
   always sets it to `label`, so the tooltip and the accessible name can never disagree. */
export interface IconButtonProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Lucide icon slug. */
  icon: IconSlug;
  /** Accessible name; also used as the tooltip title. */
  label: string;
  /**
   * primary = terracotta-deep fill; secondary = espresso outline; ghost = cream wash on
   * hover. The three chrome-safe variants only: an icon alone never carries danger.
   */
  variant?: IconButtonVariant;
  size?: Size;
  disabled?: boolean;
}

/**
 * Square icon-only control for toolbars, card overflow menus and dismissals. `label` is
 * required and becomes both the accessible name and the native tooltip, so the control is
 * never anonymous to a screen reader or to a mouse user who does not know the glyph.
 *
 * Below the md breakpoint every box grows to a 44px touch target; above it the boxes are
 * the exact control heights (32 / 40 / 48px), so reach for `size="lg"` on a surface that
 * stays touch-first on the desktop layout too.
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  className,
  ...rest
}: IconButtonProps) {
  const Glyph = resolveLucideIcon(icon);

  return (
    <button
      className={cx('or-icon-btn', `or-icon-btn--${variant}`, `or-icon-btn--${size}`, className)}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      {...rest}
    >
      {Glyph ? (
        <Glyph
          className="or-icon-btn__icon"
          size={ICON_SIZE[size]}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

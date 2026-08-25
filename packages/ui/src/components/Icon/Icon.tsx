import type { HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { IconSlug } from '../../types';

export interface IconProps extends HTMLAttributes<HTMLElement> {
  /** Lucide icon slug, e.g. 'activity', 'heart-pulse', 'file-text'. */
  name: IconSlug;
  /** Rendered box in px. */
  size?: number;
  /** Any CSS colour; defaults to currentColor. */
  color?: string;
  /** Set only when the icon carries meaning on its own; otherwise it is hidden from AT. */
  label?: string;
}

/**
 * Any UI icon. openrunic ships no icon set of its own, so the library draws from Lucide,
 * the closest geometric, butt-cap stroke set, at the brand's 1.75px weight.
 *
 * The icon inherits `currentColor`, so it takes espresso, bone or terracotta ink from its
 * context. Never communicate status by icon colour alone: pair it with a text label.
 * An unknown slug degrades to an empty box of the right size rather than crashing, so a
 * typo never takes a screen down.
 */
export function Icon({
  name,
  size = 20,
  color = 'currentColor',
  label,
  className,
  style,
  ...rest
}: IconProps) {
  const Mark = resolveLucideIcon(name);

  return (
    <span
      className={cx('or-icon', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, color, ...style }}
      {...rest}
    >
      {Mark ? (
        <Mark
          className="or-icon__svg"
          size={size}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
          focusable="false"
        />
      ) : null}
    </span>
  );
}

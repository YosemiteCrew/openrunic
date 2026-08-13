import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { BadgeTone, IconSlug } from '../../types';

/** Icon size from the design system's badge specimen: small enough to read as punctuation. */
const ICON_SIZE = 13;

/** The tone's default Lucide slug. `icon` overrides it, `icon={null}` removes it. */
const TONE_ICON: Record<BadgeTone, IconSlug> = {
  success: 'check',
  neutral: 'info',
  danger: 'triangle-alert',
  accent: 'sparkle',
  ink: 'circle',
};

export interface BadgeProps extends HTMLAttributes<HTMLElement> {
  /**
   * Semantic status: olive = in range, hazelnut = informational, red = out of range.
   * `accent` and `ink` are the two non-clinical tones.
   */
  tone?: BadgeTone;
  /** Override the tone's default Lucide icon, or pass null for text only. */
  icon?: IconSlug | null;
  /** The status word. Always pass one: the colour is never the signal on its own. */
  children?: ReactNode;
}

/**
 * Status pill for results, records and schedules.
 *
 * The health rule is absolute: never colour alone. The label carries the meaning and the
 * icon reinforces it, so the badge still reads on a monochrome print-out or to anyone who
 * cannot separate olive from red.
 */
export function Badge({ tone = 'neutral', icon, children, className, ...rest }: BadgeProps) {
  const slug = icon === null ? null : icon || TONE_ICON[tone];
  const ToneIcon = slug ? resolveLucideIcon(slug) : undefined;

  return (
    <span className={cx('or-badge', `or-badge--${tone}`, className)} {...rest}>
      {ToneIcon ? (
        <ToneIcon
          className="or-badge__icon"
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

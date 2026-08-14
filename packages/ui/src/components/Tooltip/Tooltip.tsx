import type { FocusEvent, HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cloneElement, isValidElement, useState } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';
import type { Side } from '../../types';

/** The shape of the one prop the tooltip writes onto its trigger. */
interface DescribableProps {
  'aria-describedby'?: string;
}

export interface TooltipProps extends HTMLAttributes<HTMLElement> {
  /** The clarification, in a phrase. Sentence case, no full stop. */
  label: string;
  /** Which edge of the trigger the bubble sits on. */
  side?: Side;
  /** The trigger. Give it a focusable element, or pass `tabIndex={0}` through. */
  children?: ReactNode;
}

/**
 * Short clarification on hover or focus. Never the only place information lives - a
 * tooltip is a second reading of something already written down, because it cannot be
 * reached by a screen magnifier user mid-gesture and does not exist on touch at all.
 *
 * It is keyboard reachable in both directions: the bubble opens on focus and closes on
 * Escape, and the trigger is wired to it with `aria-describedby` whether it is open or
 * not, so the label is announced even when nothing is drawn. A trigger that is not
 * natively focusable (a tag, a code span) needs `tabIndex={0}`, which passes through to
 * the wrapper.
 */
export function Tooltip({
  label,
  side = 'top',
  children,
  className,
  id,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapperId = useFieldId(id);
  const bubbleId = `${wrapperId}-tooltip`;

  const handleMouseEnter = (event: MouseEvent<HTMLElement>) => {
    setOpen(true);
    onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLElement>) => {
    setOpen(false);
    onMouseLeave?.(event);
  };

  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    setOpen(true);
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    setOpen(false);
    onBlur?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') setOpen(false);
    onKeyDown?.(event);
  };

  /* An element trigger is described by the bubble; a bare string cannot carry the
     attribute, which is one more reason the label is never the only copy. */
  const trigger = isValidElement<DescribableProps>(children)
    ? cloneElement(children, {
        'aria-describedby': cx(children.props['aria-describedby'], bubbleId),
      })
    : children;

  return (
    <span
      id={wrapperId}
      className={cx('or-tooltip', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {trigger}
      <span
        id={bubbleId}
        role="tooltip"
        className={cx(
          'or-tooltip__bubble',
          `or-tooltip__bubble--${side}`,
          open && 'or-tooltip__bubble--open'
        )}
      >
        {label}
      </span>
    </span>
  );
}

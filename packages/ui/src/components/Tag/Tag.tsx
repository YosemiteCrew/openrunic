import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';

/** Icon size from the tag specimen: the remove cross is quieter than the label. */
const REMOVE_ICON_SIZE = 12;

export interface TagProps extends HTMLAttributes<HTMLElement> {
  /** Renders in Spline Sans Mono for codes and identifiers. */
  mono?: boolean;
  /** Adds a remove affordance. */
  onRemove?: () => void;
  children?: ReactNode;
}

/**
 * Neutral metadata chip - filters, categories, FHIR resource codes. Square-ish at 6px so it
 * never reads as a Badge; a Tag says what something is, a Badge says how it is going.
 *
 * When `onRemove` is set the chip grows to a 44px touch target below md, because the remove
 * control has to be reachable with a thumb without overlapping the chips around it.
 */
export function Tag({ mono = false, onRemove, children, className, ...rest }: TagProps) {
  const RemoveIcon = resolveLucideIcon('x');
  // A row of chips that all say "Remove" is useless to a screen reader, so the label names
  // the chip whenever its content is plain text.
  const removeLabel = typeof children === 'string' ? `Remove ${children}` : 'Remove';

  return (
    <span
      className={cx('or-tag', mono && 'or-tag--mono', onRemove && 'or-tag--removable', className)}
      {...rest}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          className="or-tag__remove"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          {RemoveIcon ? (
            <RemoveIcon
              className="or-tag__remove-icon"
              size={REMOVE_ICON_SIZE}
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
            />
          ) : null}
        </button>
      ) : null}
    </span>
  );
}

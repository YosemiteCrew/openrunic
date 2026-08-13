import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';
import type { SurfaceTone } from '../../types';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  tone?: SurfaceTone;
  /** Adds the 'raised' shadow. Use at most on one layer per screen. */
  raised?: boolean;
  /** Uppercase 13px eyebrow above the title. */
  overline?: string;
  title?: ReactNode;
  /** Content pinned below a hairline. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Raised surface. Depth comes from the paper steps (bone -> cream -> white) before shadows.
 * Avoid boxes-in-boxes: nest a white card inside a cream one only for data tables and fields.
 *
 * Renders a `<section>`, named by its own title through `aria-labelledby` whenever one is
 * given, so a screen reader announces the card as a region rather than anonymous content.
 */
export function Card({
  tone = 'cream',
  raised = false,
  overline,
  title,
  footer,
  children,
  className,
  id,
  ...rest
}: CardProps) {
  const cardId = useFieldId(id);
  const titleId = `${cardId}-title`;

  return (
    <section
      id={cardId}
      className={cx('or-card', `or-card--${tone}`, raised && 'or-card--raised', className)}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {overline ? <p className="or-overline or-card__overline">{overline}</p> : null}
      {title ? (
        <h3 id={titleId} className="or-h3 or-card__title">
          {title}
        </h3>
      ) : null}
      {children}
      {footer ? <div className="or-card__footer">{footer}</div> : null}
    </section>
  );
}

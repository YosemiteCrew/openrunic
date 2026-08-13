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
  /**
   * Heading level for `title`. Defaults to 2: a card is a section of a page, and
   * the page's own heading is the `<h1>`, so its sections are level 2. Pass 3 or
   * lower for a card nested inside another card's region, so the outline still
   * descends one level at a time.
   *
   * The visual size does not move with it - `or-h3` is the card-title type ramp
   * at every level. Heading level is document structure, not a font size.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
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
  headingLevel = 2,
  footer,
  children,
  className,
  id,
  ...rest
}: CardProps) {
  const cardId = useFieldId(id);
  const titleId = `${cardId}-title`;
  const Heading = `h${headingLevel}` as const;

  return (
    <section
      id={cardId}
      className={cx('or-card', `or-card--${tone}`, raised && 'or-card--raised', className)}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {overline ? <p className="or-overline or-card__overline">{overline}</p> : null}
      {title ? (
        <Heading id={titleId} className="or-h3 or-card__title">
          {title}
        </Heading>
      ) : null}
      {children}
      {footer ? <div className="or-card__footer">{footer}</div> : null}
    </section>
  );
}

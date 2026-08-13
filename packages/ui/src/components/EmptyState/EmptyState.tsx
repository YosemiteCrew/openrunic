import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { IconSlug } from '../../types';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The fact, in one line: "No records yet". */
  title: string;
  /** The next action: "Connect a clinic or upload a document and it will appear here." */
  message?: string;
  /** Usually a single Button. */
  action?: ReactNode;
  /** Lucide slug; omit to use the terracotta glyph. */
  icon?: IconSlug;
  /**
   * Directory the brand glyph is served from, without a trailing slash. The mark is a
   * shipped file that the consuming app hosts; it is never redrawn in code.
   */
  glyphBasePath?: string;
}

/**
 * Nothing-here state, written in the calm voice: the fact, then the next action. No jokes
 * in clinical flows, and never an exclamation mark.
 *
 * The mark above the title is decorative and hidden from assistive technology - the
 * heading and the message carry the whole meaning.
 */
export function EmptyState({
  title,
  message,
  action,
  icon,
  glyphBasePath = 'assets/logo',
  className,
  ...rest
}: EmptyStateProps) {
  const MarkIcon = icon ? resolveLucideIcon(icon) : undefined;
  /* An inline style, and it is unavoidable here: the glyph path is a runtime prop, so the
     mask URL cannot live in the stylesheet. Everything else about the mark (size, colour,
     mask geometry) is in EmptyState.css. */
  const maskUrl = `url('${glyphBasePath}/glyph.svg')`;
  const glyphMask: CSSProperties = { maskImage: maskUrl, WebkitMaskImage: maskUrl };

  return (
    <div className={cx('or-empty-state', className)} {...rest}>
      {MarkIcon ? (
        <MarkIcon
          className="or-empty-state__icon"
          size={32}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : (
        <span className="or-empty-state__glyph" style={glyphMask} aria-hidden="true" />
      )}
      <h3 className="or-h3 or-empty-state__title">{title}</h3>
      {message ? <p className="or-body or-empty-state__message">{message}</p> : null}
      {action ? <div className="or-empty-state__action">{action}</div> : null}
    </div>
  );
}

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { brandAssetCssUrl } from '../../assets/brand';
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
  /** Lucide slug; omit to use the brand glyph. */
  icon?: IconSlug;
  /**
   * Serve the glyph from your own copy of the design system's assets/logo directory
   * instead of the mark bundled with this package. The mark is a shipped file either way.
   */
  glyphBasePath?: string;
}

/**
 * Nothing-here state, written in the calm voice: the fact, then the next action. No jokes
 * in clinical flows, and never an exclamation mark.
 *
 * The mark above the title is decorative and hidden from assistive technology - the heading
 * and the message carry the whole meaning. It defaults to the brand glyph, which is
 * vendored into this package and inlined by the bundler, so no call site has to pass an
 * icon or host a file. Pass `icon` for a Lucide slug instead.
 */
export function EmptyState({
  title,
  message,
  action,
  icon,
  glyphBasePath,
  className,
  ...rest
}: EmptyStateProps) {
  const MarkIcon = icon ? resolveLucideIcon(icon) : undefined;
  /* An inline style, and it is unavoidable here: the mask URL depends on `glyphBasePath`,
     a runtime prop, so it cannot live in the stylesheet. Everything else about the mark
     (size, colour, mask geometry) is in EmptyState.css. */
  const maskUrl = brandAssetCssUrl('glyph.svg', glyphBasePath);
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

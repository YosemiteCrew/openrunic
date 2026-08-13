import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { IconSlug } from '../../types';

/**
 * info = hazelnut wash; caution = caramel wash with espresso ink; danger = warm red;
 * success = olive.
 *
 * Declared here rather than in types.ts because the union belongs to this component
 * alone: the toast has no caution, and nothing else in the library takes these four.
 */
export type AlertTone = 'info' | 'caution' | 'danger' | 'success';

/** The tone icon at 18px and the dismiss glyph at 16px, as the notice specimen draws them. */
const TONE_ICON_SIZE = 18;
const CLOSE_ICON_SIZE = 16;

/**
 * Per tone: the icon, and the word a screen reader hears before the body. The word is
 * what keeps the tone off colour alone; sighted readers get the fact from the title.
 *
 * `danger` takes the octagon rather than the toast's triangle. Alert carries a caution
 * tone too, and the triangle is caution's shape everywhere; two tones sharing one
 * silhouette would leave the tone word carrying the difference by itself.
 */
const TONE: Record<AlertTone, { icon: IconSlug; label: string }> = {
  info: { icon: 'info', label: 'Information' },
  caution: { icon: 'alert-triangle', label: 'Caution' },
  danger: { icon: 'octagon-alert', label: 'Error' },
  success: { icon: 'check', label: 'Success' },
};

export interface AlertProps extends HTMLAttributes<HTMLElement> {
  /** info, caution and success announce politely; danger interrupts. */
  tone?: AlertTone;
  /** The fact, in one line. */
  title?: string;
  /** The next action, or the detail behind the fact. */
  message?: string;
  /** Optional inline action node, usually a single ghost Button. */
  action?: ReactNode;
  /** Overrides the tone's default icon. Lucide slug. */
  icon?: IconSlug;
  /** Renders the dismiss control when given. */
  onClose?: () => void;
  /** Free-form body, used when `message` is not enough. Renders after the message. */
  children?: ReactNode;
}

/**
 * In-page notice on warm paper. Where the toast passes by and clears itself, the alert
 * stays in the content flow and holds its place until the fact it states stops being
 * true. State the fact, then the next action.
 *
 * Every tone is a wash with espresso ink and a hairline, never a saturated fill: the
 * colour tints the paper, and the tone word plus the icon carry the meaning, so nothing
 * here depends on hue alone.
 *
 * `info`, `caution` and `success` render `role="status"` (announced at the next pause);
 * `danger` renders `role="alert"`, which interrupts whatever a screen reader is saying,
 * so keep that tone for things that went wrong. This follows the toast's precedent.
 */
export function Alert({
  tone = 'info',
  title,
  message,
  action,
  icon,
  onClose,
  className,
  children,
  ...rest
}: AlertProps) {
  const { icon: toneIcon, label } = TONE[tone];
  const ToneIcon = resolveLucideIcon(icon ?? toneIcon);
  const CloseIcon = resolveLucideIcon('x');

  return (
    <div
      className={cx('or-alert', `or-alert--${tone}`, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
      {...rest}
    >
      {ToneIcon ? (
        <ToneIcon
          className="or-alert__icon"
          size={TONE_ICON_SIZE}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : null}
      <span className="or-alert__tone">{label}</span>
      <div className="or-alert__body">
        {title ? <span className="or-alert__title">{title}</span> : null}
        {message ? <span className="or-alert__message">{message}</span> : null}
        {children}
        {action}
      </div>
      {onClose ? (
        <button type="button" className="or-alert__close" aria-label="Dismiss" onClick={onClose}>
          {CloseIcon ? (
            <CloseIcon size={CLOSE_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

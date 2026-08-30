import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { IconSlug, ToastTone } from '../../types';

/**
 * Per tone: the icon, and the word a screen reader hears before the message. The word is
 * what keeps the tone off colour alone; sighted readers get the fact from the title.
 */
const TONE: Record<ToastTone, { icon: IconSlug; label: string }> = {
  info: { icon: 'info', label: 'Information' },
  success: { icon: 'check', label: 'Success' },
  danger: { icon: 'alert-triangle', label: 'Error' },
};

export interface ToastProps extends HTMLAttributes<HTMLElement> {
  /** info and success announce politely; danger interrupts. */
  tone?: ToastTone;
  /** The fact, in one line. */
  title?: string;
  /** The next action, or the detail behind the fact. */
  message?: string;
  /** Optional inline action node. */
  action?: ReactNode;
  /** Renders the dismiss control when given. */
  onClose?: () => void;
  /**
   * The accessible name of the dismiss control. A prop rather than a literal
   * because a design system has no translator: "Dismiss" is the only word this
   * component says, and a consumer rendering in another language has to be able
   * to say it. Defaults to the English it used to hardcode.
   */
  closeLabel?: string;
}

/**
 * Transient confirmation on an espresso surface. State the fact, then the next action.
 *
 * The toast draws itself and nothing more: placement, stacking and auto-dismiss belong to
 * the consumer, so one app can put it in a corner rail and another inline in a form.
 * `info` and `success` render `role="status"` (announced at the next pause); `danger`
 * renders `role="alert"`, which interrupts, so keep that tone for things that went wrong.
 */
export function Toast({
  tone = 'info',
  title,
  message,
  action,
  onClose,
  closeLabel = 'Dismiss',
  className,
  ...rest
}: ToastProps) {
  const { icon, label } = TONE[tone];
  const ToneIcon = resolveLucideIcon(icon);
  const CloseIcon = resolveLucideIcon('x');

  return (
    <div
      className={cx('or-toast', `or-toast--${tone}`, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
      {...rest}
    >
      {ToneIcon ? (
        <ToneIcon
          className="or-toast__icon"
          size={18}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : null}
      <span className="or-toast__tone">{label}</span>
      <div className="or-toast__body">
        {title ? <span className="or-toast__title">{title}</span> : null}
        {message ? <span className="or-toast__message">{message}</span> : null}
        {action}
      </div>
      {onClose ? (
        <button type="button" className="or-toast__close" aria-label={closeLabel} onClick={onClose}>
          {CloseIcon ? (
            <CloseIcon size={16} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

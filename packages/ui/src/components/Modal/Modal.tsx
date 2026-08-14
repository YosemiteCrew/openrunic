import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';
import { IconButton } from '../IconButton';

/* Every Tab stop inside the panel, in DOM order. tabindex="-1" nodes are left out on
   purpose: they take focus programmatically, as the panel itself does, but never a Tab. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * `width` travels to the stylesheet as a custom property rather than an inline
 * `max-width`, because an inline declaration would beat the below-md full-screen rule and
 * leave a 460px panel floating on a phone.
 */
interface ModalPanelStyle extends CSSProperties {
  '--or-modal-width'?: string;
}

/* `title` is omitted from the inherited attributes: here it is a ReactNode heading, not
   the native tooltip string. */
export interface ModalProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Mounts the dialog. Nothing renders, and no focus moves, while it is false. */
  open?: boolean;
  title?: ReactNode;
  /** One calm line: the fact, then what happens next. */
  description?: string;
  children?: ReactNode;
  /** Action row, right-aligned - cancel first, confirm last. */
  footer?: ReactNode;
  /** Called by the close control and by Escape. Omit it for a decision that must be made. */
  onClose?: () => void;
  /** Maximum panel width in px from md up. Below md the panel is a full-screen sheet. */
  width?: number;
}

/**
 * Centred dialog over an espresso scrim, and the required wrapper for a destructive
 * confirmation. Focus moves to the panel when it opens so the title and description are
 * announced, Tab cycles inside the panel, Escape closes, and focus returns to whatever
 * opened it. Below md the panel is a full-screen sheet.
 *
 * Renders `role="dialog"`; pass `role="alertdialog"` for a confirmation that must not be
 * missed, and the rest of the wiring is unchanged.
 */
export function Modal({
  open = true,
  title,
  description,
  children,
  footer,
  onClose,
  width = 460,
  className,
  id,
  style,
  ...rest
}: ModalProps) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const modalId = useFieldId(id);
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;

  /* Read through a ref so the trap below never re-registers, and so an inline
     `onClose={() => ...}` cannot re-run the effect and steal focus back mid-dialog. */
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(panel);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const atLastStop = active === (event.shiftKey ? first : last);

      // Anywhere in the middle of the panel, the browser's own Tab order is correct.
      if (first && !atLastStop && panel.contains(active)) return;

      event.preventDefault();
      const wrapTo = event.shiftKey ? last : first;
      // Wraps to the other end, pulls drifted focus back in, and with nothing inside able
      // to hold focus the panel keeps it rather than handing it to the page behind.
      (wrapTo ?? panel).focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      // Back to the control that opened the dialog, so a keyboard user is never dropped
      // at the top of the page after confirming.
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [open]);

  if (!open) return null;

  const panelStyle: ModalPanelStyle = { '--or-modal-width': `${width}px`, ...style };

  return (
    <div className="or-modal">
      {/* A real <dialog>, not a div wearing role="dialog". Rendered with `open`
          rather than through `showModal()`: the top layer would replace this
          design's espresso scrim with a `::backdrop` and take the panel out of
          the page's stacking context, and modality is already carried by the
          scrim, the Escape handler and the Tab trap above. `role` still comes
          through `rest`, so `role="alertdialog"` keeps working. */}
      <dialog
        ref={panelRef}
        id={modalId}
        className={cx('or-modal__dialog', className)}
        open
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={panelStyle}
        {...rest}
      >
        {title || onClose ? (
          <div className="or-modal__header">
            {title ? (
              <h2 id={titleId} className="or-h3 or-modal__title">
                {title}
              </h2>
            ) : null}
            {onClose ? (
              <IconButton
                icon="x"
                label="Close"
                size="sm"
                className="or-modal__close"
                onClick={onClose}
              />
            ) : null}
          </div>
        ) : null}
        {description ? (
          <p id={descriptionId} className="or-body or-modal__description">
            {description}
          </p>
        ) : null}
        {children ? <div className="or-modal__body">{children}</div> : null}
        {footer ? <div className="or-modal__footer">{footer}</div> : null}
      </dialog>
    </div>
  );
}

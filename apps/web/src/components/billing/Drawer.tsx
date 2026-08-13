'use client';

import { IconButton } from '@openrunic/ui';
import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The side modal the component canon calls C17, composed in the app.
 *
 * @openrunic/ui has no drawer today, and forking `Modal` would have been the
 * wrong fix: a drawer is not a centred dialog with different CSS, it is a
 * different promise. The list behind it stays visible and live, because a
 * biller working a denial is reading the queue while the claim is open, and a
 * full-screen modal would hide the very context the work needs. Raised as a
 * proposed library addition (`Drawer`), not forked.
 *
 * The accessibility contract is the same as the library's Modal, and is
 * implemented here rather than approximated: focus moves into the panel on
 * open so its title is announced, Tab cycles inside it, Escape closes it, and
 * focus returns to whatever opened it. Nothing about this drawer is
 * hover-only, and every control inside it is a real button.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DrawerProps {
  open: boolean;
  /** The panel heading. Becomes the dialog's accessible name. */
  title: string;
  /** One line of context under the title: a patient, a claim number, a date. */
  subtitle?: ReactNode;
  /** Action row pinned to the bottom, right-aligned: cancel first, confirm last. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({
  open,
  title,
  subtitle,
  footer,
  onClose,
  children,
}: Readonly<DrawerProps>): ReactElement | null {
  const panelRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const baseId = useId();
  const titleId = `${baseId}-title`;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const trigger = document.activeElement;
    panel.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = stops[0];
      const last = stops.at(-1);
      const active = document.activeElement;
      const atEdge = active === (event.shiftKey ? first : last);

      if (first && !atEdge && panel.contains(active)) return;

      event.preventDefault();
      ((event.shiftKey ? last : first) ?? panel).focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Back to the row that opened it, so a keyboard user resumes where they
      // were in the queue rather than at the top of the page.
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="or-drawer">
      {/* Escape is the keyboard route out and the close control is the pointer
          route, so the scrim is decoration and stays out of the reading order. */}
      <div className="or-drawer__scrim" aria-hidden="true" onClick={onClose} />
      {/* A real <dialog>, not a div wearing role="dialog". Rendered with `open`
          rather than through `showModal()`: the top layer would pull the panel
          out of the drawer's right-edge layout and swap the scrim for a
          `::backdrop`, and modality is already carried by the scrim, the Escape
          handler and the focus trap above. */}
      <dialog
        ref={panelRef}
        className="or-drawer__panel"
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="or-drawer__header">
          <div className="or-drawer__heading">
            <h2 id={titleId} className="or-h3">
              {title}
            </h2>
            {subtitle ? <p className="or-small or-drawer__subtitle">{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
        </div>

        <div className="or-drawer__body">{children}</div>

        {footer ? <div className="or-drawer__footer">{footer}</div> : null}
      </dialog>
    </div>
  );
}

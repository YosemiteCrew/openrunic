'use client';

import { IconButton } from '@openrunic/ui';
import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useTranslator } from '@/lib/i18n/messages';

/**
 * The side modal (canon C17), composed in the app.
 *
 * PROPOSED LIBRARY ADDITION. `@openrunic/ui` has `Modal` (a centred dialog for
 * confirmations) but no drawer, and the admin area needs one on five screens:
 * the list behind it must stay visible and live while a single record is
 * edited, which is exactly what a centred modal cannot do. It is composed here
 * from the same primitives rather than forked from `Modal`, and the geometry,
 * focus handling and copy are ready to move into the library as `Drawer`.
 *
 * Behaviour: enters from the right and leaves to the right (spatial
 * consistency), Escape closes, focus moves in on open and returns to the
 * trigger on close, and Tab cycles inside the panel. Never stack two.
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
  /** Sentence case, names the record: "Dev Sandoval", "Laboratory network". */
  title: string;
  /** One calm line under the title. */
  description?: string;
  /** Context beside the title: a version chip, a status badge, an MRN. */
  meta?: ReactNode;
  /** Action row pinned to the bottom. Cancel first, primary last. */
  footer?: ReactNode;
  /** 480 for a form, 720 for a composer or a preview. */
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({
  open,
  title,
  description,
  meta,
  footer,
  width = 480,
  onClose,
  children,
}: Readonly<DrawerProps>): ReactElement | null {
  const t = useTranslator();
  const panelRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

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
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      const atLastStop = active === (event.shiftKey ? first : last);
      if (first && !atLastStop && panel.contains(active)) return;

      event.preventDefault();
      (event.shiftKey ? (last ?? panel) : (first ?? panel)).focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Back to whatever opened the drawer: a keyboard user is never dropped at
      // the top of the page.
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="or-drawer">
      {/* Decorative: Escape and the Close button are the real controls, so the
          scrim needs no keyboard handler of its own. */}
      <div className="or-drawer__scrim" aria-hidden="true" onClick={onClose} />
      {/* A real <dialog>, not a div wearing role="dialog". It is rendered with
          `open` rather than opened through `showModal()`: the top layer would
          take the panel out of the drawer's right-edge layout and replace the
          scrim with a `::backdrop` this design does not want, and modality here
          is already carried by the scrim, the Escape handler and the focus trap
          below. */}
      <dialog
        ref={panelRef}
        className="or-drawer__panel"
        style={{ width: `min(${width}px, 100%)` }}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="or-drawer__header">
          <div className="or-drawer__heading">
            <h2 id={titleId} className="or-h3">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="or-small or-drawer__description">
                {description}
              </p>
            ) : null}
            {meta ? <div className="or-drawer__meta">{meta}</div> : null}
          </div>
          <IconButton
            icon="x"
            label={t('admin.action.close')}
            size="sm"
            variant="ghost"
            onClick={onClose}
          />
        </div>

        <div className="or-drawer__body">{children}</div>

        {footer ? <div className="or-drawer__footer">{footer}</div> : null}
      </dialog>
    </div>
  );
}

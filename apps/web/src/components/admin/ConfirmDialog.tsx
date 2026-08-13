'use client';

import { Button, Input, Modal } from '@openrunic/ui';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The two grades of confirmation (canon C20), on the library's `Modal`.
 *
 * Destructive: names the object and the consequence and asks for the object's
 * name to be typed. Clinical-significant: states exactly what will happen, one
 * deliberate button, no typing friction. Neither is used for a reversible act:
 * those get an undo toast instead.
 *
 * The button always names the verb and its object ("Deactivate Dev Sandoval"),
 * never "OK".
 */

export interface ConfirmDialogProps {
  open: boolean;
  /** "Deactivate Dev Sandoval". Verb and object. */
  title: string;
  /** The consequence, in one sentence, before the button. */
  consequence: string;
  /** Verb and object again: "Deactivate account", "Revoke key". */
  confirmLabel: string;
  /**
   * The exact phrase that must be typed before the confirm button enables.
   * Destructive grade only; omit it for a clinical-significant confirmation.
   */
  typedConfirmation?: string;
  /** Extra detail rows: what will move, what will be kept. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  ...rest
}: Readonly<ConfirmDialogProps>): ReactElement | null {
  // The panel holds the typed phrase, and it only exists while the dialog is
  // open. That is what makes a reopened dialog impossible to arrive
  // pre-confirmed, without an effect that resets state behind the user.
  if (!open) return null;
  return <ConfirmPanel {...rest} />;
}

function ConfirmPanel({
  title,
  consequence,
  confirmLabel,
  typedConfirmation,
  children,
  onConfirm,
  onCancel,
}: Readonly<Omit<ConfirmDialogProps, 'open'>>): ReactElement {
  const [typed, setTyped] = useState('');
  const ready = typedConfirmation === undefined || typed.trim() === typedConfirmation;

  return (
    <Modal
      open
      role="alertdialog"
      title={title}
      description={consequence}
      onClose={onCancel}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ready} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {typedConfirmation === undefined ? null : (
        <Input
          label={`Type ${typedConfirmation} to confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          hint="This is deliberate friction. Nothing is deleted; the record is kept for the audit trail."
        />
      )}
    </Modal>
  );
}

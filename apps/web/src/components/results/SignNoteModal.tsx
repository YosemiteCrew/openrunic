'use client';

import { Button, Modal } from '@openrunic/ui';
import { useId, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

/**
 * Sign with note: the same signature, plus the sentence the patient or the
 * next clinician needs.
 *
 * Signing is a clinical-legal act, so the dialog states exactly what happens in
 * one sentence and asks for one deliberate confirmation. No typed friction: the
 * note is optional, and an empty note signs the result unchanged.
 *
 * Proposed @openrunic/ui addition: a `Textarea` field. `Input` is single line,
 * and a note that has to fit on one line is a note nobody writes. Composed here
 * from the field tokens rather than forking Input.
 */

export interface SignNoteModalProps {
  open: boolean;
  /** What is being signed, named in the dialog: "Lipid panel". */
  subject: string;
  patientName: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

export function SignNoteModal({
  open,
  subject,
  patientName,
  onCancel,
  onConfirm,
}: Readonly<SignNoteModalProps>): ReactElement {
  const [note, setNote] = useState('');
  const fieldId = useId();

  return (
    <Modal
      open={open}
      title="Sign with a note"
      description={`Signing ${subject} for ${patientName} moves it out of the queue and releases it to the portal with your note attached.`}
      onClose={onCancel}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            iconLeft="pen-line"
            onClick={() => {
              onConfirm(note.trim());
              setNote('');
            }}
          >
            Sign with note
          </Button>
        </>
      }
    >
      <div className="or-textarea">
        <label className="or-textarea__label" htmlFor={fieldId}>
          Note for the record
        </label>
        <textarea
          id={fieldId}
          className="or-textarea__control"
          rows={4}
          value={note}
          placeholder="What the patient should do next"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
        />
        <p className="or-caption or-textarea__hint">
          The note is part of the signed record and is visible to the patient.
        </p>
      </div>
    </Modal>
  );
}

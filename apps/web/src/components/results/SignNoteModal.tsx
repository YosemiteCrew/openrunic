'use client';

import { Button, Modal } from '@openrunic/ui';
import { useId, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { useTranslator } from '@/lib/i18n/messages';

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
  const t = useTranslator();
  const [note, setNote] = useState('');
  const fieldId = useId();

  return (
    <Modal
      open={open}
      title={t('results.note.title')}
      /* The panel and the patient are named as they are recorded; only the
         sentence around them is translated. */
      description={t('results.note.description', { panel: subject, patient: patientName })}
      onClose={onCancel}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('results.note.cancel')}
          </Button>
          <Button
            iconLeft="pen-line"
            onClick={() => {
              onConfirm(note.trim());
              setNote('');
            }}
          >
            {t('results.note.confirm')}
          </Button>
        </>
      }
    >
      <div className="or-textarea">
        <label className="or-textarea__label" htmlFor={fieldId}>
          {t('results.note.label')}
        </label>
        <textarea
          id={fieldId}
          className="or-textarea__control"
          rows={4}
          value={note}
          placeholder={t('results.note.placeholder')}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
        />
        <p className="or-caption or-textarea__hint">{t('results.note.hint')}</p>
      </div>
    </Modal>
  );
}

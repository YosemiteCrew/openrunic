'use client';

import type { Translator } from '@openrunic/i18n';
import { Button, Modal } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Appointment, Patient } from '@/lib/api';
import { formatName, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { givenName } from './schedule';

/**
 * Check-in, confirmed in one deliberate step.
 *
 * Checking a patient in moves them onto a board other people are working, so
 * it states the consequence in a sentence and names the verb on the button.
 * It is not made harder than that: friction on a routine, correct action is
 * how a system trains a front desk to click through warnings.
 *
 * The dialog stays open while the write is outstanding and stays open if it is
 * refused, with the server's own sentence above the buttons. Closing on a
 * refusal would leave the desk believing a patient was checked in when the
 * board will not show them.
 */

export interface CheckInDialogProps {
  appointment: Appointment;
  /** Absent for a held slot: bookable time with nobody attached to it yet. */
  patient: Patient | undefined;
  /** True while the check-in is with the server. */
  pending?: boolean;
  /** What the server said when it refused. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: (appointment: Appointment) => void;
}

/** The verb names the patient, so the button says who it is about to check in. */
function confirmLabel(t: Translator, patient: Patient | undefined, pending: boolean): string {
  if (pending) return t('schedule.checkIn.submitting');
  return patient
    ? t('schedule.checkIn.named', { name: givenName(patient.name) })
    : t('schedule.checkIn.visit');
}

/**
 * The visit type is interpolated as it stands on the appointment, lower-cased,
 * because it is the practice's own catalogue entry rather than a word this
 * screen owns. See `BookingModal`'s note on why it is not translated.
 */
function describe(t: Translator, appointment: Appointment, patient: Patient | undefined): string {
  if (!patient) return t('schedule.checkIn.describeUnassigned');
  return t('schedule.checkIn.describe', {
    name: formatName(patient.name),
    time: formatTime(t, appointment.start),
    visitType: appointment.type.display.toLowerCase(),
  });
}

export function CheckInDialog({
  appointment,
  patient,
  pending = false,
  error = null,
  onCancel,
  onConfirm,
}: Readonly<CheckInDialogProps>): ReactElement {
  const t = useTranslator();

  return (
    <Modal
      open
      role="alertdialog"
      width={520}
      title={t('schedule.checkIn.title')}
      description={describe(t, appointment, patient)}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            {t('schedule.action.cancel')}
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(appointment)}>
            {confirmLabel(t, patient, pending)}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="or-body" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

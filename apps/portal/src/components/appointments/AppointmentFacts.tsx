/**
 * The when, who and where of one appointment, as a description list.
 *
 * Shared because both screens that show an appointment answer the same three questions in
 * the same order, and a patient who learns the shape of it on the home card should not
 * have to relearn it on the appointments page. It lived in both files until the duplicate
 * detector said so.
 *
 * The one thing that genuinely differs is how much the "Where" line says about a video
 * call. On the home card the call is the next thing happening and the reader may be about
 * to join it, so it says where the link opens; in a list of every appointment that
 * sentence would repeat down the page for no gain. Hence `videoLocation` rather than two
 * copies of the list.
 */

import type { Translator } from '@openrunic/i18n';

import type { Appointment } from '@/lib/api/types';
import { formatDateTime, formatDuration } from '@/lib/format';

export interface AppointmentFactsProps {
  appointment: Appointment;
  /**
   * The reader's translator. A prop rather than a hook because this file is not
   * a client module of its own: both screens that render it are, and passing it
   * keeps that true rather than pulling a second directive into the tree.
   */
  t: Translator;
  /**
   * What the "Where" line says for a video appointment, already translated.
   * Defaults to the short form, which is what a list of every appointment wants.
   */
  videoLocation?: string;
}

export function AppointmentFacts({
  appointment,
  t,
  videoLocation,
}: Readonly<AppointmentFactsProps>) {
  /*
   * Both values are one message with two holes rather than two pieces joined by
   * a comma here. The comma is punctuation this language happens to use between
   * these two facts, and which fact comes first is the same kind of decision.
   */
  return (
    <dl className="portal-data-list">
      <div className="portal-data-list__row">
        <dt className="portal-data-list__term">{t('portal.appointment.when')}</dt>
        <dd className="portal-data-list__value">
          {t('portal.appointment.whenValue', {
            dateTime: formatDateTime(t, appointment.startsAt),
            duration: formatDuration(t, appointment.durationMinutes),
          })}
        </dd>
      </div>
      <div className="portal-data-list__row">
        <dt className="portal-data-list__term">{t('portal.appointment.whoWith')}</dt>
        <dd className="portal-data-list__value">
          {t('portal.appointment.whoWithValue', {
            clinician: appointment.clinician,
            department: appointment.department,
          })}
        </dd>
      </div>
      <div className="portal-data-list__row">
        <dt className="portal-data-list__term">{t('portal.appointment.where')}</dt>
        <dd className="portal-data-list__value">
          {appointment.mode === 'video'
            ? (videoLocation ?? t('portal.appointment.videoDefault'))
            : (appointment.location ?? t('portal.appointment.roomUnconfirmed'))}
        </dd>
      </div>
    </dl>
  );
}

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

import type { Appointment } from '@/lib/api/types';
import { formatDateTime, formatDuration } from '@/lib/format';

export interface AppointmentFactsProps {
  appointment: Appointment;
  /** What the "Where" line says for a video appointment. */
  videoLocation?: string;
}

export function AppointmentFacts({
  appointment,
  videoLocation = 'A video call',
}: Readonly<AppointmentFactsProps>) {
  return (
    <dl className="portal-data-list">
      <div className="portal-data-list__row">
        <dt className="portal-data-list__term">When</dt>
        <dd className="portal-data-list__value">
          {formatDateTime(appointment.startsAt)}, {formatDuration(appointment.durationMinutes)}
        </dd>
      </div>
      <div className="portal-data-list__row">
        <dt className="portal-data-list__term">Who with</dt>
        <dd className="portal-data-list__value">
          {appointment.clinician}, {appointment.department}
        </dd>
      </div>
      <div className="portal-data-list__row">
        <dt className="portal-data-list__term">Where</dt>
        <dd className="portal-data-list__value">
          {appointment.mode === 'video'
            ? videoLocation
            : (appointment.location ?? 'The practice will confirm the room.')}
        </dd>
      </div>
    </dl>
  );
}

import type { Appointment } from '@/lib/api';
import { calendarDay } from '@/lib/format';

/**
 * Which appointment the rail should name.
 *
 * Pure lookups over an already-sorted list, kept beside the rail rather than
 * inside it so the rules about status and clinic day can be tested without a
 * patient fetch.
 */

/** The next booked appointment at or after `now`; the fixtures are already sorted by start. */
export function nextBookedAppointment(
  appointments: readonly Appointment[],
  now: string
): Appointment | null {
  return (
    appointments.find(
      (appointment) =>
        appointment.start >= now &&
        (appointment.status === 'BOOKED' ||
          appointment.status === 'PENDING' ||
          appointment.status === 'PROPOSED')
    ) ?? null
  );
}

/** The appointment that belongs to the clinic day `now` falls in, whatever its status. */
export function appointmentOnDay(
  appointments: readonly Appointment[],
  now: string
): Appointment | null {
  const day = calendarDay(now);
  return appointments.find((appointment) => calendarDay(appointment.start) === day) ?? null;
}

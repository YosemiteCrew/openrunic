import type { ReactElement } from 'react';

import { Button } from '@openrunic/ui';

import { Toast } from '@/components/state';
import { BookingModal, CheckInDialog } from '@/components/schedule';
import type { BookingDetails, OpenSlot, ScheduleProvider } from '@/components/schedule';
import type { Appointment, FacilityDto, Patient } from '@/lib/api';

export interface ToastMessage {
  title: string;
  message: string;
  href?: string;
  hrefLabel?: string;
}

export interface ScheduleOverlaysProps {
  /** The visit awaiting a check-in confirmation, or null when none is. */
  readonly confirming: Appointment | null;
  readonly confirmingPatient: Patient | undefined;
  readonly checkInPending: boolean;
  readonly checkInError: string | null;
  readonly onCancelCheckIn: () => void;
  readonly onConfirmCheckIn: (appointment: Appointment) => void;

  /** The slot being booked into, or null. Booking needs a facility to write to. */
  readonly bookingSlot: OpenSlot | null;
  readonly facility: FacilityDto | null;
  readonly providers: readonly ScheduleProvider[];
  readonly patients: readonly Patient[];
  readonly bookingPending: boolean;
  readonly bookingError: string | null;
  readonly onCancelBooking: () => void;
  readonly onConfirmBooking: (facility: FacilityDto, details: BookingDetails) => void;

  readonly toast: ToastMessage | null;
  readonly onDismissToast: () => void;
}

/**
 * Everything the schedule renders on top of the day: two dialogs and the toast.
 *
 * Split out of ScheduleScreen because the screen was long enough to be hard to
 * read, and this is the part with no bearing on the day itself. It holds no
 * state: each overlay is present exactly when the screen says it is, so there
 * is one place that decides and one place that draws.
 */
export function ScheduleOverlays({
  confirming,
  confirmingPatient,
  checkInPending,
  checkInError,
  onCancelCheckIn,
  onConfirmCheckIn,
  bookingSlot,
  facility,
  providers,
  patients,
  bookingPending,
  bookingError,
  onCancelBooking,
  onConfirmBooking,
  toast,
  onDismissToast,
}: Readonly<ScheduleOverlaysProps>): ReactElement {
  return (
    <>
      {confirming ? (
        <CheckInDialog
          appointment={confirming}
          patient={confirmingPatient}
          pending={checkInPending}
          error={checkInError}
          onCancel={onCancelCheckIn}
          onConfirm={onConfirmCheckIn}
        />
      ) : null}

      {bookingSlot && facility !== null ? (
        <BookingModal
          slot={bookingSlot}
          providers={providers}
          patients={patients}
          pending={bookingPending}
          error={bookingError}
          onCancel={onCancelBooking}
          onConfirm={(details) => {
            onConfirmBooking(facility, details);
          }}
        />
      ) : null}

      {toast ? (
        <div className="or-fd-toast-host">
          <Toast
            tone="success"
            title={toast.title}
            message={toast.message}
            action={
              toast.href ? (
                <Button variant="ghost" size="sm" href={toast.href}>
                  {toast.hrefLabel}
                </Button>
              ) : null
            }
            onClose={onDismissToast}
          />
        </div>
      ) : null}
    </>
  );
}

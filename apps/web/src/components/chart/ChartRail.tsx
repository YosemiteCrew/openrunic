'use client';

import type { ReactElement, ReactNode } from 'react';

import { AsyncBoundary } from '@/components/state';
import { useAppointments, usePatient } from '@/lib/api';
import type { Appointment } from '@/lib/api';
import { clinicNow, useChartSummary } from '@/lib/api/chart';
import type { ChartClient } from '@/lib/api/chart';
import { formatDate } from '@/lib/format';

import { PatientContextRail } from './PatientContextRail';

/**
 * The rail, wired to the data layer.
 *
 * Both chart screens mount this rather than each fetching a patient of their
 * own, which is what keeps the rail identical between the chart and the note
 * editor: same request, same states, same order of information.
 *
 * The appointment lookup degrades on purpose. If the appointment read fails the
 * rail still renders with "No appointment scheduled" rather than replacing the
 * whole rail with an error: allergies are more important than a booking, and a
 * read failure on one must never hide the other.
 */

export interface ChartRailProps {
  patientId: string;
  onOpenSection?: (tabId: string) => void;
  patientHref?: string;
  /** Injectable for tests. */
  chartClient?: ChartClient;
  children?: ReactNode;
}

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
  const day = formatDate(now, 'iso');
  return appointments.find((appointment) => formatDate(appointment.start, 'iso') === day) ?? null;
}

export function ChartRail({
  patientId,
  onOpenSection,
  patientHref,
  chartClient,
  children,
}: ChartRailProps): ReactElement {
  const now = clinicNow();
  const patient = usePatient(patientId);
  const chart = useChartSummary(patientId, chartClient ? { client: chartClient } : {});
  const appointments = useAppointments({ patientId, sort: 'start' });

  return (
    <AsyncBoundary
      state={patient}
      subject="this patient"
      loadingVariant="text"
      loadingRows={8}
      empty={{
        title: 'No patient loaded',
        message: 'Open a chart from the patient index, or press Cmd-K to search.',
      }}
    >
      {(record) => (
        <AsyncBoundary
          state={chart}
          subject="this chart"
          loadingVariant="text"
          loadingRows={8}
          empty={{ title: 'No chart data', message: 'Nothing has been recorded for this patient.' }}
        >
          {(summary) => (
            <PatientContextRail
              patient={record}
              chart={summary}
              nextAppointment={nextBookedAppointment(appointments.data?.data ?? [], now)}
              now={now}
              onOpenSection={onOpenSection}
              patientHref={patientHref}
            >
              {children}
            </PatientContextRail>
          )}
        </AsyncBoundary>
      )}
    </AsyncBoundary>
  );
}

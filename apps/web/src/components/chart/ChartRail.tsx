'use client';

import type { ReactElement, ReactNode } from 'react';

import { AsyncBoundary } from '@/components/state';
import { useAppointments, usePatient } from '@/lib/api';
import { clinicNow, useChartSummary } from '@/lib/api/chart';
import type { ChartClient } from '@/lib/api/chart';
import { useTranslator } from '@/lib/i18n/messages';

import { nextBookedAppointment } from './appointments';
import { PatientContextRail } from './PatientContextRail';

/**
 * The rail, wired to the data layer.
 *
 * Both chart screens mount this rather than each fetching a patient of their
 * own, which is what keeps the rail identical between the chart and the note
 * editor: same request, same states, same order of information.
 *
 * The appointment lookup degrades on purpose. If the appointment read fails the
 * rail still renders, saying no appointment is scheduled, rather than replacing
 * the whole rail with an error: allergies are more important than a booking,
 * and a read failure on one must never hide the other.
 */

export interface ChartRailProps {
  patientId: string;
  onOpenSection?: (tabId: string) => void;
  patientHref?: string;
  /** Injectable for tests. */
  chartClient?: ChartClient;
  children?: ReactNode;
}

export function ChartRail({
  patientId,
  onOpenSection,
  patientHref,
  chartClient,
  children,
}: Readonly<ChartRailProps>): ReactElement {
  const t = useTranslator();
  const now = clinicNow();
  const patient = usePatient(patientId);
  const chart = useChartSummary(patientId, chartClient ? { client: chartClient } : {});
  const appointments = useAppointments({ patientId, sort: 'start' });

  return (
    <AsyncBoundary
      state={patient}
      subject={t('chart.boundary.patient.subject')}
      loadingVariant="text"
      loadingRows={8}
      empty={{
        title: t('chart.boundary.patient.title'),
        message: t('chart.boundary.patient.message'),
      }}
    >
      {(record) => (
        <AsyncBoundary
          state={chart}
          subject={t('chart.boundary.chart.subject')}
          loadingVariant="text"
          loadingRows={8}
          empty={{
            title: t('chart.boundary.chart.title'),
            message: t('chart.boundary.chart.message'),
          }}
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

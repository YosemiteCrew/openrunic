'use client';

import { useCallback } from 'react';

import { api, queryKey, useApiQuery } from '@/lib/api';
import type { ApiClient, Appointment, AsyncState, Patient } from '@/lib/api';

import { dayBounds } from './clock';

/**
 * One day of the schedule, with the patient names already attached.
 *
 * The grid and the flow board both need appointments *and* the patients they
 * belong to, and rendering the first without the second would put "Unassigned
 * slot" on screen for a frame before the names arrived. So both reads settle
 * together behind one {@link AsyncState}, and the screen gets one loading
 * state, one error state and one retry rather than two of each.
 */

export interface ClinicDayData {
  appointments: Appointment[];
  /** Every patient booked that day, by id. */
  patientsById: Map<string, Patient>;
}

export interface UseClinicDayOptions {
  /** `YYYY-MM-DD` in the clinic's timezone. */
  day: string;
  /** Omit for every provider. */
  providerId?: string;
  /** Injectable for tests and stories. Defaults to the app's `api`. */
  client?: ApiClient;
}

/** Wide enough that a clinic day is one page: the API caps a page at 100. */
const DAY_PAGE_SIZE = 100;

export function useClinicDay(options: UseClinicDayOptions): AsyncState<ClinicDayData> {
  const { day, providerId } = options;
  const client = options.client ?? api;

  const run = useCallback(
    async (signal: AbortSignal): Promise<ClinicDayData> => {
      const bounds = dayBounds(day);
      const [appointments, patients] = await Promise.all([
        client.appointments.list(
          { ...bounds, providerId, pageSize: DAY_PAGE_SIZE, sort: 'start' },
          signal
        ),
        client.patients.list({ pageSize: DAY_PAGE_SIZE }, signal),
      ]);

      return {
        appointments: appointments.data,
        patientsById: new Map(patients.data.map((patient) => [patient.id, patient])),
      };
    },
    [client, day, providerId]
  );

  return useApiQuery(queryKey('schedule.day', { day, providerId }), run);
}

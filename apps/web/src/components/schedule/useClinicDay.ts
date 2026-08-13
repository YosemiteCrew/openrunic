'use client';

import { useCallback } from 'react';

import { api, queryKey, useApiQuery } from '@/lib/api';
import type { ApiClient, Appointment, AsyncState, FacilityDto, Patient } from '@/lib/api';

import { dayBounds } from './clock';
import { toScheduleProvider } from './schedule';
import type { ScheduleProvider } from './ScheduleGrid';

/**
 * One day of the schedule, at one facility, with the people on it named.
 *
 * The grid and the flow board need four things that only make sense together:
 * the facility the day belongs to, the clinicians it is drawn in columns for,
 * the appointments, and the patients those appointments are with. Rendering any
 * of them without the others puts a wrong thing on screen for a frame - a
 * column headed by a UUID, or "Unassigned slot" where a name is about to
 * arrive - so they settle together behind one {@link AsyncState} and the screen
 * gets one loading state, one error state and one retry rather than four.
 *
 * The facility is read rather than assumed. A booking names one, and the API
 * checks that name against the grants on the token before it writes, so the
 * only facility a screen may book into is one it has actually read back. The
 * same id scopes the day it lists, which means what the desk is looking at and
 * what it books into cannot come apart.
 *
 * The directory is re-read when the day changes, which costs two extra requests
 * per page of the day pager. That is the price of one settled state instead of
 * two, and it is worth paying while both lists are one page; a practice large
 * enough for that to hurt wants a cache in the data layer rather than a second
 * loading state in this screen.
 */

export interface ClinicDayData {
  /**
   * The facility this day belongs to, or null when the organisation has none
   * this principal can see. Null is not an error and not an empty day: it means
   * nothing can be booked, and the screen has to say so rather than book into a
   * facility it invented.
   */
  facility: FacilityDto | null;
  /** Every facility that can be picked, so the choice is the user's. */
  facilities: FacilityDto[];
  /** Active clinicians at this organisation: the columns the day is drawn in. */
  providers: ScheduleProvider[];
  appointments: Appointment[];
  /** Every patient booked that day, by id. */
  patientsById: Map<string, Patient>;
}

export interface UseClinicDayOptions {
  /** `YYYY-MM-DD` in the clinic's timezone. */
  day: string;
  /** The facility to show. Defaults to the first one the directory returns. */
  facilityId?: string;
  /** Omit for every provider. */
  providerId?: string;
  /** Injectable for tests and stories. Defaults to the app's `api`. */
  client?: ApiClient;
}

/** Wide enough that a clinic day is one page: the API caps a page at 100. */
const DAY_PAGE_SIZE = 100;

export function useClinicDay(options: UseClinicDayOptions): AsyncState<ClinicDayData> {
  const { day, facilityId, providerId } = options;
  const client = options.client ?? api;

  const run = useCallback(
    async (signal: AbortSignal): Promise<ClinicDayData> => {
      const [facilityPage, providerPage] = await Promise.all([
        client.facilities.list({ active: true, pageSize: DAY_PAGE_SIZE }, signal),
        client.users.list({ isProvider: true, status: 'ACTIVE', pageSize: DAY_PAGE_SIZE }, signal),
      ]);

      const facilities = facilityPage.data;
      const facility = facilities.find((row) => row.id === facilityId) ?? facilities[0] ?? null;
      const providers = providerPage.data.map(toScheduleProvider);

      // No facility means no day: an unscoped appointment list would show
      // visits from wherever, under a heading naming nowhere.
      if (facility === null) {
        return { facility, facilities, providers, appointments: [], patientsById: new Map() };
      }

      const bounds = dayBounds(day);
      const [appointments, patients] = await Promise.all([
        client.appointments.list(
          {
            ...bounds,
            facilityId: facility.id,
            ...(providerId ? { providerId } : {}),
            pageSize: DAY_PAGE_SIZE,
            sort: 'start',
          },
          signal
        ),
        client.patients.list({ pageSize: DAY_PAGE_SIZE }, signal),
      ]);

      return {
        facility,
        facilities,
        providers,
        appointments: appointments.data,
        patientsById: new Map(patients.data.map((patient) => [patient.id, patient])),
      };
    },
    [client, day, facilityId, providerId]
  );

  return useApiQuery(queryKey('schedule.day', { day, facilityId, providerId }), run);
}

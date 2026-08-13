'use client';

import { Badge, Button, Card, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Appointment, AppointmentStatus, Patient } from '@/lib/api';
import { formatAge, formatMrn, formatName, formatTime } from '@/lib/format';

import { givenName, presentStatus } from './schedule';

/**
 * The day's right rail: what the day looks like, and what to do about the one
 * visit you just clicked.
 *
 * It is deliberately two panels and no more. A front desk needs the counts to
 * know whether the morning is holding, and the selected visit to act on it; a
 * rail that also carried filters and a mini calendar would compete with the
 * grid it is meant to serve.
 */

export interface DayRailProps {
  appointments: readonly Appointment[];
  patientsById: ReadonlyMap<string, Patient>;
  selected: Appointment | null;
  /** Ids checked in during this session, so the rail reflects the action taken. */
  checkedIn: ReadonlySet<string>;
  onCheckIn: (appointment: Appointment) => void;
  onWalkIn: () => void;
}

interface Counter {
  label: string;
  statuses: readonly AppointmentStatus[];
}

/* Booked-but-not-arrived first, then the building, then the day's exceptions:
   the order a front desk reads them in. */
const COUNTERS: readonly Counter[] = [
  { label: 'Booked', statuses: ['PROPOSED', 'PENDING', 'BOOKED'] },
  { label: 'In the building', statuses: ['ARRIVED', 'CHECKED_IN', 'ROOMED', 'IN_PROGRESS'] },
  { label: 'Checked out', statuses: ['CHECKED_OUT', 'FULFILLED'] },
  { label: 'No show', statuses: ['NOSHOW'] },
  { label: 'Cancelled', statuses: ['CANCELLED'] },
];

export function DayRail({
  appointments,
  patientsById,
  selected,
  checkedIn,
  onCheckIn,
  onWalkIn,
}: DayRailProps): ReactElement {
  const patient = selected?.patientId ? patientsById.get(selected.patientId) : undefined;
  const status = selected ? presentStatus(selected.status) : null;
  const alreadyIn = selected ? checkedIn.has(selected.id) : false;

  return (
    <div className="or-day-rail">
      <Card overline="Today" title="Day at a glance">
        <dl className="or-day-rail__counts">
          {COUNTERS.map((counter) => (
            <div key={counter.label} className="or-day-rail__count">
              <dt className="or-small">{counter.label}</dt>
              <dd className="or-mono or-day-rail__count-value">
                {appointments.filter((entry) => counter.statuses.includes(entry.status)).length}
              </dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" iconLeft="user-plus" fullWidth onClick={onWalkIn}>
          Add walk-in
        </Button>
      </Card>

      <Card
        overline="Selected visit"
        title={selected ? formatTime(selected.start) : 'No visit selected'}
      >
        {selected && status ? (
          <div className="or-day-rail__visit">
            <p className="or-body-lg or-day-rail__patient">
              {patient ? formatName(patient.name) : 'Unassigned slot'}
            </p>
            {patient ? (
              <p className="or-small or-day-rail__meta">
                <span className="or-mono">{formatMrn(patient.mrn)}</span>
                {' · '}
                {formatAge(patient.birthDate, new Date(selected.start))}
              </p>
            ) : null}

            <p className="or-body">{selected.type.display}</p>
            {selected.reasonText ? <p className="or-small">{selected.reasonText}</p> : null}

            <div className="or-day-rail__chips">
              <Badge tone={alreadyIn ? 'success' : status.tone}>
                {alreadyIn ? 'Checked in' : status.label}
              </Badge>
              {selected.room ? <Tag>{selected.room}</Tag> : <Tag>No room assigned</Tag>}
            </div>

            <div className="or-day-rail__actions">
              <Button iconLeft="log-in" disabled={alreadyIn} onClick={() => onCheckIn(selected)}>
                {patient ? `Check in ${givenName(patient.name)}` : 'Check in'}
              </Button>
              {patient ? (
                <Button variant="secondary" iconLeft="folder-open" href={`/patients/${patient.id}`}>
                  Open chart
                </Button>
              ) : null}
              {patient ? (
                <Button
                  variant="ghost"
                  iconLeft="shield-check"
                  href={`/patients/${patient.id}/insurance`}
                >
                  Insurance and eligibility
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="or-body">
            Select a visit in the grid to check the patient in, open their chart, or verify
            coverage.
          </p>
        )}
      </Card>
    </div>
  );
}

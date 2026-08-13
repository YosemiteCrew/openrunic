'use client';

import { Badge, Button, Card, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Appointment, AppointmentStatus, Patient } from '@/lib/api';
import { formatAge, formatMrn, formatName, formatTime } from '@/lib/format';

import { awaitsCheckIn, givenName, presentStatus } from './schedule';

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

/** MRN and age, the two things staff check before they touch a chart. */
function PatientMeta({
  patient,
  asOf,
}: Readonly<{ patient: Patient; asOf: string }>): ReactElement {
  return (
    <p className="or-small or-day-rail__meta">
      <span className="or-mono">{formatMrn(patient.mrn)}</span>
      {' · '}
      {formatAge(patient.birthDate, new Date(asOf))}
    </p>
  );
}

/**
 * The three things a front desk does with the visit they just clicked. Chart
 * and eligibility need a patient; an unassigned slot can still be checked in.
 */
function VisitActions({
  appointment,
  patient,
  alreadyIn,
  onCheckIn,
}: Readonly<{
  appointment: Appointment;
  patient: Patient | undefined;
  alreadyIn: boolean;
  onCheckIn: (appointment: Appointment) => void;
}>): ReactElement {
  return (
    <div className="or-day-rail__actions">
      {/* Once the visit has moved past arrival the button says so rather than
          staying on the verb: a disabled "Check in" reads as a permission
          problem, and this is the opposite, a job already done. */}
      <Button iconLeft="log-in" disabled={alreadyIn} onClick={() => onCheckIn(appointment)}>
        {checkInLabel(patient, alreadyIn)}
      </Button>
      {patient ? (
        <>
          <Button variant="secondary" iconLeft="folder-open" href={`/patients/${patient.id}`}>
            Open chart
          </Button>
          <Button
            variant="ghost"
            iconLeft="shield-check"
            href={`/patients/${patient.id}/insurance`}
          >
            Insurance and eligibility
          </Button>
        </>
      ) : null}
    </div>
  );
}

function checkInLabel(patient: Patient | undefined, alreadyIn: boolean): string {
  if (alreadyIn) return 'Already checked in';
  return patient ? `Check in ${givenName(patient.name)}` : 'Check in';
}

interface SelectedVisitProps {
  appointment: Appointment;
  patient: Patient | undefined;
  alreadyIn: boolean;
  onCheckIn: (appointment: Appointment) => void;
}

/** Everything known about the clicked visit, and what can be done to it. */
function SelectedVisit({
  appointment,
  patient,
  alreadyIn,
  onCheckIn,
}: Readonly<SelectedVisitProps>): ReactElement {
  const status = presentStatus(appointment.status);

  return (
    <div className="or-day-rail__visit">
      <p className="or-body-lg or-day-rail__patient">
        {patient ? formatName(patient.name) : 'Unassigned slot'}
      </p>
      {patient ? <PatientMeta patient={patient} asOf={appointment.start} /> : null}

      <p className="or-body">{appointment.type.display}</p>
      {appointment.reasonText ? <p className="or-small">{appointment.reasonText}</p> : null}

      <div className="or-day-rail__chips">
        {/* Checking in during this session outranks the status the server last
            sent: the rail has to reflect the action the user just took. */}
        <Badge tone={alreadyIn ? 'success' : status.tone}>
          {alreadyIn ? 'Checked in' : status.label}
        </Badge>
        <Tag>{appointment.room ?? 'No room assigned'}</Tag>
      </div>

      <VisitActions
        appointment={appointment}
        patient={patient}
        alreadyIn={alreadyIn}
        onCheckIn={onCheckIn}
      />
    </div>
  );
}

export function DayRail({
  appointments,
  patientsById,
  selected,
  onCheckIn,
  onWalkIn,
}: Readonly<DayRailProps>): ReactElement {
  const patient = selected?.patientId ? patientsById.get(selected.patientId) : undefined;

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
        {selected ? (
          <SelectedVisit
            appointment={selected}
            patient={patient}
            alreadyIn={!awaitsCheckIn(selected.status)}
            onCheckIn={onCheckIn}
          />
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

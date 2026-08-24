'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Tag } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Appointment, AppointmentStatus, Patient } from '@/lib/api';
import { formatAge, formatMrn, formatName, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { awaitsCheckIn, givenName, presentStatus, STATUS_LABEL_KEY } from './schedule';

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
  /**
   * False when the day has no facility or no clinician to book against. The
   * walk-in verb is then disabled rather than left live and refused; the page
   * carries the reason in an alert, so the rail does not repeat it.
   */
  canBook?: boolean;
  onCheckIn: (appointment: Appointment) => void;
  onWalkIn: () => void;
}

interface Counter {
  /**
   * Catalogue key for the row's word.
   *
   * These are not the status labels, even where the English coincides: "Booked"
   * here spans three states and "In the building" spans four, so a translator
   * naming the group is naming something the status list does not have a word
   * for.
   */
  labelKey: string;
  statuses: readonly AppointmentStatus[];
}

/* Booked-but-not-arrived first, then the building, then the day's exceptions:
   the order a front desk reads them in. */
const COUNTERS: readonly Counter[] = [
  { labelKey: 'schedule.dayRail.counter.booked', statuses: ['PROPOSED', 'PENDING', 'BOOKED'] },
  {
    labelKey: 'schedule.dayRail.counter.inTheBuilding',
    statuses: ['ARRIVED', 'CHECKED_IN', 'ROOMED', 'IN_PROGRESS'],
  },
  {
    labelKey: 'schedule.dayRail.counter.checkedOut',
    statuses: ['CHECKED_OUT', 'FULFILLED'],
  },
  { labelKey: 'schedule.dayRail.counter.noShow', statuses: ['NOSHOW'] },
  { labelKey: 'schedule.dayRail.counter.cancelled', statuses: ['CANCELLED'] },
];

/** MRN and age, the two things staff check before they touch a chart. */
function PatientMeta({
  patient,
  asOf,
  t,
}: Readonly<{ patient: Patient; asOf: string; t: Translator }>): ReactElement {
  return (
    <p className="or-small or-day-rail__meta">
      <span className="or-mono">{formatMrn(patient.mrn)}</span>
      {' · '}
      {formatAge(t, patient.birthDate, new Date(asOf))}
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
  t,
}: Readonly<{
  appointment: Appointment;
  patient: Patient | undefined;
  alreadyIn: boolean;
  onCheckIn: (appointment: Appointment) => void;
  t: Translator;
}>): ReactElement {
  return (
    <div className="or-day-rail__actions">
      {/* Once the visit has moved past arrival the button says so rather than
          staying on the verb: a disabled "Check in" reads as a permission
          problem, and this is the opposite, a job already done. */}
      <Button iconLeft="log-in" disabled={alreadyIn} onClick={() => onCheckIn(appointment)}>
        {checkInLabel(t, patient, alreadyIn)}
      </Button>
      {patient ? (
        <>
          <Button variant="secondary" iconLeft="folder-open" href={`/patients/${patient.id}`}>
            {t('schedule.dayRail.openChart')}
          </Button>
          <Button
            variant="ghost"
            iconLeft="shield-check"
            href={`/patients/${patient.id}/insurance`}
          >
            {t('schedule.dayRail.insurance')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function checkInLabel(t: Translator, patient: Patient | undefined, alreadyIn: boolean): string {
  if (alreadyIn) return t('schedule.checkIn.already');
  return patient
    ? t('schedule.checkIn.named', { name: givenName(patient.name) })
    : t('schedule.checkIn.generic');
}

interface SelectedVisitProps {
  appointment: Appointment;
  patient: Patient | undefined;
  alreadyIn: boolean;
  onCheckIn: (appointment: Appointment) => void;
  t: Translator;
}

/** Everything known about the clicked visit, and what can be done to it. */
function SelectedVisit({
  appointment,
  patient,
  alreadyIn,
  onCheckIn,
  t,
}: Readonly<SelectedVisitProps>): ReactElement {
  const status = presentStatus(appointment.status);

  return (
    <div className="or-day-rail__visit">
      <p className="or-body-lg or-day-rail__patient">
        {patient ? formatName(patient.name) : t('schedule.visit.unassignedSlot')}
      </p>
      {patient ? <PatientMeta patient={patient} asOf={appointment.start} t={t} /> : null}

      <p className="or-body">{appointment.type.display}</p>
      {appointment.reasonText ? <p className="or-small">{appointment.reasonText}</p> : null}

      <div className="or-day-rail__chips">
        {/* Checking in during this session outranks the status the server last
            sent: the rail has to reflect the action the user just took. */}
        <Badge tone={alreadyIn ? 'success' : status.tone}>
          {alreadyIn ? t(STATUS_LABEL_KEY.CHECKED_IN) : t(status.labelKey)}
        </Badge>
        <Tag>{appointment.room ?? t('schedule.dayRail.noRoomAssigned')}</Tag>
      </div>

      <VisitActions
        appointment={appointment}
        patient={patient}
        alreadyIn={alreadyIn}
        onCheckIn={onCheckIn}
        t={t}
      />
    </div>
  );
}

export function DayRail({
  appointments,
  patientsById,
  selected,
  canBook = true,
  onCheckIn,
  onWalkIn,
}: Readonly<DayRailProps>): ReactElement {
  const t = useTranslator();
  const patient = selected?.patientId ? patientsById.get(selected.patientId) : undefined;

  return (
    <div className="or-day-rail">
      <Card overline={t('schedule.dayRail.overline')} title={t('schedule.dayRail.title')}>
        <dl className="or-day-rail__counts">
          {COUNTERS.map((counter) => (
            <div key={counter.labelKey} className="or-day-rail__count">
              <dt className="or-small">{t(counter.labelKey)}</dt>
              <dd className="or-mono or-day-rail__count-value">
                {appointments.filter((entry) => counter.statuses.includes(entry.status)).length}
              </dd>
            </div>
          ))}
        </dl>
        <Button
          variant="secondary"
          iconLeft="user-plus"
          fullWidth
          disabled={!canBook}
          onClick={onWalkIn}
        >
          {t('schedule.action.addWalkIn')}
        </Button>
      </Card>

      <Card
        overline={t('schedule.dayRail.selectedOverline')}
        title={selected ? formatTime(selected.start) : t('schedule.dayRail.noVisitSelected')}
      >
        {selected ? (
          <SelectedVisit
            appointment={selected}
            patient={patient}
            alreadyIn={!awaitsCheckIn(selected.status)}
            onCheckIn={onCheckIn}
            t={t}
          />
        ) : (
          <p className="or-body">{t('schedule.dayRail.selectPrompt')}</p>
        )}
      </Card>
    </div>
  );
}

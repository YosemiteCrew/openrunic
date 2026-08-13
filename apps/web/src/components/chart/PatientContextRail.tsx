'use client';

import { Badge, Card, Tag } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import type { Appointment, Patient } from '@/lib/api';
import type { AllergyRecord, Allergy, ChartSummary, Visit } from '@/lib/api/chart';
import {
  formatAge,
  formatCount,
  formatDate,
  formatDateTime,
  formatEnumLabel,
  formatInitials,
  formatMoney,
  formatMrn,
  formatName,
  NOT_RECORDED,
  pluralise,
} from '@/lib/format';

/**
 * The patient context rail: who this is, and what must never be forgotten
 * about them.
 *
 * It is present on every chart screen without exception, it is read-mostly, and
 * it holds the six things that are dangerous to have to go looking for:
 * identity, allergies, problems, medications, the next appointment, and what
 * the patient owes. Two rules it enforces that the legacy widget dashboard did
 * not: allergies are never hidden behind a count, and "no known allergies" is a
 * different fact from "nobody has asked yet".
 *
 * Everything in it is reachable by keyboard and nothing is revealed by hover
 * alone: section headings that deep-link into the chart are real buttons or
 * links, and the reaction behind each allergy chip is written under it rather
 * than tucked into a tooltip.
 */

export interface PatientContextRailProps {
  patient: Patient;
  chart: ChartSummary;
  /** The next booked appointment, or null when nothing is scheduled. */
  nextAppointment: Appointment | null;
  /** The clinic's "now", for age and appointment wording. */
  now: string;
  /**
   * Deep-links a rail section to the chart tab that owns it. Given on the chart
   * itself; omitted on other chart screens, which link to the chart instead.
   */
  onOpenSection?: (tabId: string) => void;
  /** The chart route, used when `onOpenSection` is absent (the note editor). */
  patientHref?: string;
  /** Rendered under the balance: role-specific slots (eligibility, claim state). */
  children?: ReactNode;
}

const SEVERITY_TONE = {
  SEVERE: 'danger',
  MODERATE: 'neutral',
  MILD: 'neutral',
} as const;

function allergyChip(allergy: Allergy): ReactElement {
  return (
    <li key={allergy.id} className="or-rail__allergy">
      <Badge tone={SEVERITY_TONE[allergy.severity]}>
        {allergy.allergen} - {formatEnumLabel(allergy.severity)}
      </Badge>
      <p className="or-caption or-rail__reaction">
        {formatEnumLabel(allergy.category)}, {allergy.reaction.toLowerCase()}
      </p>
    </li>
  );
}

function AllergyBlock({ record }: Readonly<{ record: AllergyRecord }>): ReactElement {
  if (record.state === 'NOT_RECORDED') {
    return (
      <div className="or-rail__prompt">
        <Badge tone="danger">Allergies not recorded</Badge>
        <p className="or-caption or-rail__prompt-text">
          Nobody has asked yet. Record allergies before prescribing: an empty list is not the same
          as none.
        </p>
      </div>
    );
  }

  if (record.state === 'NO_KNOWN_ALLERGIES') {
    return (
      <div className="or-rail__affirmed">
        <Badge tone="success">No known allergies</Badge>
        <p className="or-caption or-rail__reaction">Affirmed {formatDate(record.affirmedOn)}</p>
      </div>
    );
  }

  return <ul className="or-rail__allergy-list">{record.entries.map(allergyChip)}</ul>;
}

/** The heading of a rail section: a button on the chart, a link everywhere else. */
function SectionHeading({
  label,
  tabId,
  onOpenSection,
  patientHref,
}: Readonly<{
  label: string;
  tabId: string;
  onOpenSection?: (tabId: string) => void;
  patientHref?: string;
}>): ReactElement {
  if (onOpenSection) {
    return (
      <button type="button" className="or-rail__heading" onClick={() => onOpenSection(tabId)}>
        <span className="or-overline">{label}</span>
      </button>
    );
  }
  if (patientHref) {
    return (
      <Link className="or-rail__heading" href={patientHref}>
        <span className="or-overline">{label}</span>
      </Link>
    );
  }
  return <p className="or-overline or-rail__heading-static">{label}</p>;
}

function lastVisit(visits: readonly Visit[], today: string): Visit | null {
  const past = visits
    .filter((visit) => visit.date < today)
    .toSorted((a, b) => b.date.localeCompare(a.date));
  return past[0] ?? null;
}

/**
 * The line under the patient's name: the legal given name when they go by
 * something else, and their pronouns. Omitted entirely when there is neither,
 * rather than left as an empty line.
 */
function IdentityMeta({ patient }: Readonly<{ patient: Patient }>): ReactElement | null {
  const legalName = patient.name.preferred ? `Legal name ${patient.name.given}` : '';
  const pronouns = patient.pronouns ?? '';
  if (!legalName && !pronouns) return null;

  return (
    <p className="or-caption or-rail__meta">{[legalName, pronouns].filter(Boolean).join(', ')}</p>
  );
}

/**
 * Identity. A deceased patient's block is replaced outright: the date of death
 * is the first thing anyone opening this chart has to know.
 */
function IdentityBlock({
  patient,
  now,
}: Readonly<{ patient: Patient; now: string }>): ReactElement {
  const deceased = patient.deceasedAt !== null;

  return (
    <div
      className={deceased ? 'or-rail__identity or-rail__identity--deceased' : 'or-rail__identity'}
    >
      <span className="or-rail__avatar" aria-hidden="true">
        {formatInitials(patient.name)}
      </span>
      <div className="or-rail__identity-text">
        {/* `formatName` puts the preferred name where the given name would be,
            because that is what the patient is called. The legal given name is
            still written out: it is what the insurance card and the wristband
            say, and staff have to be able to match them. */}
        <p className="or-rail__name">{formatName(patient.name)}</p>
        <IdentityMeta patient={patient} />
        <p className="or-caption or-rail__meta">
          {formatAge(patient.birthDate, now)}, born {formatDate(patient.birthDate)},{' '}
          {formatEnumLabel(patient.sexAtBirth).toLowerCase()}
        </p>
        <p className="or-caption or-rail__meta">
          MRN <span className="or-mono">{formatMrn(patient.mrn)}</span>
        </p>
        {deceased ? (
          <p className="or-small or-rail__deceased">
            Deceased {formatDate(patient.deceasedAt)}. This chart is read-only.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The handling flags: interpreter, privacy, portal. Only the ones that apply. */
function FlagList({ patient }: Readonly<{ patient: Patient }>): ReactElement {
  const flags: string[] = [];
  if (patient.languageCode !== 'en-US') {
    flags.push(`Interpreter needed, ${patient.languageCode}`);
  }
  if (patient.sensitivityClass !== 'NORMAL') {
    flags.push(`Privacy: ${formatEnumLabel(patient.sensitivityClass).toLowerCase()}`);
  }
  if (patient.portalEnabled) flags.push('Portal active');

  return (
    <ul className="or-rail__flags">
      {flags.map((flag) => (
        <li key={flag}>
          <Tag>{flag}</Tag>
        </li>
      ))}
    </ul>
  );
}

/** Three problems, then a count of the rest. The rail never becomes the list. */
function ProblemList({
  problems,
}: Readonly<{ problems: readonly ChartSummary['problems'][number][] }>): ReactElement {
  if (problems.length === 0) {
    return <p className="or-small or-rail__line">No problems recorded</p>;
  }

  const overflow = problems.length - 3;
  return (
    <ul className="or-rail__list">
      {problems.slice(0, 3).map((problem) => (
        <li key={problem.id} className="or-small or-rail__line">
          {problem.name}
        </li>
      ))}
      {overflow > 0 ? (
        <li className="or-caption or-rail__meta">{overflow} more on the summary</li>
      ) : null}
    </ul>
  );
}

function MedicationSummary({
  medications,
}: Readonly<{ medications: readonly ChartSummary['medications'][number][] }>): ReactElement {
  return (
    <>
      <p className="or-small or-rail__line">
        {medications.length === 0
          ? 'No current medications'
          : `${formatCount(medications.length, 'active medication')}`}
      </p>
      {medications.length > 0 ? (
        <ul className="or-rail__list">
          {medications.slice(0, 3).map((med) => (
            <li key={med.id} className="or-caption or-rail__meta">
              {med.drug}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** When the patient is next seen, and when they were last seen. */
function AppointmentLines({
  nextAppointment,
  previous,
}: Readonly<{ nextAppointment: Appointment | null; previous: Visit | null }>): ReactElement {
  return (
    <>
      <p className="or-small or-rail__line">
        {nextAppointment
          ? `Next ${formatDateTime(nextAppointment.start, 'dense')}, ${nextAppointment.type.display.toLowerCase()}`
          : 'No appointment scheduled'}
      </p>
      <p className="or-caption or-rail__meta">
        Last visit {previous ? formatDate(previous.date) : NOT_RECORDED}
      </p>
    </>
  );
}

/** What the patient owes, with the state said in words as well as in tint. */
function BalanceLine({ balanceDue }: Readonly<{ balanceDue: number }>): ReactElement {
  const balance = formatMoney(balanceDue);
  const due = balanceDue > 0;

  return (
    <p className={due ? 'or-rail__balance or-rail__balance--due' : 'or-rail__balance'}>
      <span className="or-mono or-rail__amount">{balance.text}</span>
      <span className="or-caption or-rail__meta">
        {due ? 'Patient responsibility, due' : 'Patient responsibility, settled'}
      </span>
      <span className="or-visually-hidden">{balance.srText}</span>
    </p>
  );
}

export function PatientContextRail({
  patient,
  chart,
  nextAppointment,
  now,
  onOpenSection,
  patientHref,
  children,
}: Readonly<PatientContextRailProps>): ReactElement {
  const activeProblems = chart.problems.filter((problem) => problem.status !== 'RESOLVED');
  const activeMeds = chart.medications.filter((med) => med.status === 'ACTIVE');
  const unsigned = chart.visits.filter((visit) => visit.noteState === 'UNSIGNED');
  const previous = lastVisit(chart.visits, formatDate(now, 'iso'));

  const heading = (label: string, tab: string) => (
    <SectionHeading
      label={label}
      tabId={tab}
      onOpenSection={onOpenSection}
      patientHref={patientHref}
    />
  );

  return (
    <Card className="or-rail" aria-label={`Patient context for ${formatName(patient.name)}`}>
      <IdentityBlock patient={patient} now={now} />

      <FlagList patient={patient} />

      <section className="or-rail__section" aria-label="Allergies">
        {heading('Allergies', 'summary')}
        <AllergyBlock record={chart.allergies} />
      </section>

      <section className="or-rail__section" aria-label="Problems">
        {heading('Problems', 'summary')}
        <ProblemList problems={activeProblems} />
      </section>

      <section className="or-rail__section" aria-label="Medications">
        {heading('Medications', 'medications')}
        <MedicationSummary medications={activeMeds} />
      </section>

      {chart.careGaps.length > 0 ? (
        <section className="or-rail__section" aria-label="Care gaps">
          {heading('Care gaps', 'summary')}
          <ul className="or-rail__list">
            {chart.careGaps.map((gap) => (
              <li key={gap.id} className="or-caption or-rail__meta">
                {gap.label}
                {gap.dueOn ? `, due ${formatDate(gap.dueOn, 'dense')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {unsigned.length > 0 ? (
        <section className="or-rail__section" aria-label="Documentation">
          {heading('Documentation', 'visits')}
          <p className="or-small or-rail__line">
            {unsigned.length} unsigned {pluralise(unsigned.length, 'note')}
          </p>
          {unsigned[0]?.encounterId ? (
            <Link className="or-rail__link" href={`/encounters/${unsigned[0].encounterId}`}>
              Open the {formatDate(unsigned[0].date, 'dense')} note
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="or-rail__section" aria-label="Appointments">
        {heading('Appointments', 'visits')}
        <AppointmentLines nextAppointment={nextAppointment} previous={previous} />
      </section>

      <section className="or-rail__section" aria-label="Balance">
        {heading('Balance', 'summary')}
        <BalanceLine balanceDue={chart.balanceDue} />
      </section>

      {children}
    </Card>
  );
}

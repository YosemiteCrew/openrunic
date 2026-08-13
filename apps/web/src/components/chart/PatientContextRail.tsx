'use client';

import { Badge, Card, Tag } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import type { Appointment, Patient } from '@/lib/api';
import type { AllergyRecord, Allergy, ChartSummary, Visit } from '@/lib/api/chart';
import {
  formatAge,
  formatDate,
  formatDateTime,
  formatEnumLabel,
  formatInitials,
  formatMoney,
  formatMrn,
  formatName,
  NOT_RECORDED,
} from '@/lib/format';

/**
 * The patient context rail: who this is, and what must never be forgotten
 * about them.
 *
 * It is present on every chart screen without exception, it is read-mostly, and
 * it holds the six things that are dangerous to have to go looking for:
 * identity, allergies, problems, medications, the next appointment, and what
 * the patient owes. Two rules it enforces that OpenEMR's widget dashboard did
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

function AllergyBlock({ record }: { record: AllergyRecord }): ReactElement {
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
}: {
  label: string;
  tabId: string;
  onOpenSection?: (tabId: string) => void;
  patientHref?: string;
}): ReactElement {
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
    .sort((a, b) => b.date.localeCompare(a.date));
  return past[0] ?? null;
}

export function PatientContextRail({
  patient,
  chart,
  nextAppointment,
  now,
  onOpenSection,
  patientHref,
  children,
}: PatientContextRailProps): ReactElement {
  const activeProblems = chart.problems.filter((problem) => problem.status !== 'RESOLVED');
  const activeMeds = chart.medications.filter((med) => med.status === 'ACTIVE');
  const unsigned = chart.visits.filter((visit) => visit.noteState === 'UNSIGNED');
  const previous = lastVisit(chart.visits, formatDate(now, 'iso'));
  const balance = formatMoney(chart.balanceDue);
  const deceased = patient.deceasedAt !== null;

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
      {/* Identity. A deceased patient's block is replaced outright: the date of
          death is the first thing anyone opening this chart has to know. */}
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
          {patient.name.preferred || patient.pronouns ? (
            <p className="or-caption or-rail__meta">
              {patient.name.preferred ? `Legal name ${patient.name.given}` : ''}
              {patient.name.preferred && patient.pronouns ? ', ' : ''}
              {patient.pronouns ?? ''}
            </p>
          ) : null}
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

      <ul className="or-rail__flags">
        {patient.languageCode !== 'en-US' ? (
          <li>
            <Tag>Interpreter needed, {patient.languageCode}</Tag>
          </li>
        ) : null}
        {patient.sensitivityClass !== 'NORMAL' ? (
          <li>
            <Tag>Privacy: {formatEnumLabel(patient.sensitivityClass).toLowerCase()}</Tag>
          </li>
        ) : null}
        {patient.portalEnabled ? (
          <li>
            <Tag>Portal active</Tag>
          </li>
        ) : null}
      </ul>

      <section className="or-rail__section" aria-label="Allergies">
        {heading('Allergies', 'summary')}
        <AllergyBlock record={chart.allergies} />
      </section>

      <section className="or-rail__section" aria-label="Problems">
        {heading('Problems', 'summary')}
        {activeProblems.length === 0 ? (
          <p className="or-small or-rail__line">No problems recorded</p>
        ) : (
          <ul className="or-rail__list">
            {activeProblems.slice(0, 3).map((problem) => (
              <li key={problem.id} className="or-small or-rail__line">
                {problem.name}
              </li>
            ))}
            {activeProblems.length > 3 ? (
              <li className="or-caption or-rail__meta">
                {activeProblems.length - 3} more on the summary
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <section className="or-rail__section" aria-label="Medications">
        {heading('Medications', 'medications')}
        <p className="or-small or-rail__line">
          {activeMeds.length === 0
            ? 'No current medications'
            : `${activeMeds.length} active ${activeMeds.length === 1 ? 'medication' : 'medications'}`}
        </p>
        {activeMeds.length > 0 ? (
          <ul className="or-rail__list">
            {activeMeds.slice(0, 3).map((med) => (
              <li key={med.id} className="or-caption or-rail__meta">
                {med.drug}
              </li>
            ))}
          </ul>
        ) : null}
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
            {unsigned.length} unsigned {unsigned.length === 1 ? 'note' : 'notes'}
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
        <p className="or-small or-rail__line">
          {nextAppointment
            ? `Next ${formatDateTime(nextAppointment.start, 'dense')}, ${nextAppointment.type.display.toLowerCase()}`
            : 'No appointment scheduled'}
        </p>
        <p className="or-caption or-rail__meta">
          {previous ? `Last visit ${formatDate(previous.date)}` : `Last visit ${NOT_RECORDED}`}
        </p>
      </section>

      <section className="or-rail__section" aria-label="Balance">
        {heading('Balance', 'summary')}
        <p
          className={
            chart.balanceDue > 0 ? 'or-rail__balance or-rail__balance--due' : 'or-rail__balance'
          }
        >
          <span className="or-mono or-rail__amount">{balance.text}</span>
          <span className="or-caption or-rail__meta">
            {chart.balanceDue > 0
              ? 'Patient responsibility, due'
              : 'Patient responsibility, settled'}
          </span>
          <span className="or-visually-hidden">{balance.srText}</span>
        </p>
      </section>

      {children}
    </Card>
  );
}

'use client';

import type { Translator } from '@openrunic/i18n';
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
import { counted } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

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
 *
 * Every word the rail owns comes from the catalogue; every word it shows about
 * a patient does not. An allergen, a problem name, a medication and an
 * appointment type are already named by the record, and naming them a second
 * time here would put a diverging label on a coded value.
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

/**
 * The two catalogue keys a count chooses between, and the choice itself.
 *
 * A flat catalogue has no room for a plural inside one message, so each form
 * English distinguishes is its own key and `Intl.PluralRules` picks between
 * them on the reader's locale rather than on `count === 1`.
 *
 * The properties are named `oneKey` and `otherKey` rather than `one` and
 * `other` because that is the shape the drift test looks for: a direct
 * translator call, or a property whose name ends in `Key`. A catalogue key held
 * under any other property name is a key nothing checks exists. Naming these
 * for the plural category alone read better and left six catalogue entries
 * unguarded.
 */
const MEDICATION_COUNT_KEYS: CountedMessage = {
  oneKey: 'chart.rail.medications.count.one',
  otherKey: 'chart.rail.medications.count.other',
};

const UNSIGNED_NOTE_KEYS: CountedMessage = {
  oneKey: 'chart.rail.documentation.unsigned.one',
  otherKey: 'chart.rail.documentation.unsigned.other',
};

/**
 * The chip for one allergy.
 *
 * Allergen, severity, category and reaction all come from the record. The chip
 * is punctuation around them and nothing else, which is why no message key
 * appears here.
 */
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

function AllergyBlock({
  record,
  t,
}: Readonly<{ record: AllergyRecord; t: Translator }>): ReactElement {
  if (record.state === 'NOT_RECORDED') {
    return (
      <div className="or-rail__prompt">
        <Badge tone="danger">{t('chart.rail.allergies.notRecorded')}</Badge>
        <p className="or-caption or-rail__prompt-text">{t('chart.rail.allergies.prompt')}</p>
      </div>
    );
  }

  if (record.state === 'NO_KNOWN_ALLERGIES') {
    return (
      <div className="or-rail__affirmed">
        <Badge tone="success">{t('chart.rail.allergies.none')}</Badge>
        <p className="or-caption or-rail__reaction">
          {t('chart.rail.allergies.affirmed', { date: formatDate(record.affirmedOn) })}
        </p>
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
function IdentityMeta({
  patient,
  t,
}: Readonly<{ patient: Patient; t: Translator }>): ReactElement | null {
  const legalName = patient.name.preferred
    ? t('chart.rail.identity.legalName', { name: patient.name.given })
    : '';
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
  t,
}: Readonly<{ patient: Patient; now: string; t: Translator }>): ReactElement {
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
        <IdentityMeta patient={patient} t={t} />
        {/* One message rather than three fragments joined here: the order of an
            age, a birth date and a sex is a decision the translator has to be
            able to make, and a sentence assembled at the call site takes it
            away from them. */}
        <p className="or-caption or-rail__meta">
          {t('chart.rail.identity.demographics', {
            age: formatAge(patient.birthDate, now),
            birthDate: formatDate(patient.birthDate),
            sex: formatEnumLabel(patient.sexAtBirth).toLowerCase(),
          })}
        </p>
        <p className="or-caption or-rail__meta">
          {t('chart.rail.identity.mrn')} <span className="or-mono">{formatMrn(patient.mrn)}</span>
        </p>
        {deceased ? (
          <p className="or-small or-rail__deceased">
            {t('chart.rail.identity.deceased', { date: formatDate(patient.deceasedAt) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The handling flags: interpreter, privacy, portal. Only the ones that apply. */
function FlagList({ patient, t }: Readonly<{ patient: Patient; t: Translator }>): ReactElement {
  const flags: string[] = [];
  if (patient.languageCode !== 'en-US') {
    flags.push(t('chart.rail.flags.interpreter', { language: patient.languageCode }));
  }
  if (patient.sensitivityClass !== 'NORMAL') {
    flags.push(
      t('chart.rail.flags.privacy', {
        level: formatEnumLabel(patient.sensitivityClass).toLowerCase(),
      })
    );
  }
  if (patient.portalEnabled) flags.push(t('chart.rail.flags.portal'));

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
  t,
}: Readonly<{
  problems: readonly ChartSummary['problems'][number][];
  t: Translator;
}>): ReactElement {
  if (problems.length === 0) {
    return <p className="or-small or-rail__line">{t('chart.rail.problems.none')}</p>;
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
        <li className="or-caption or-rail__meta">
          {t('chart.rail.problems.more', { count: overflow })}
        </li>
      ) : null}
    </ul>
  );
}

function MedicationSummary({
  medications,
  t,
}: Readonly<{
  medications: readonly ChartSummary['medications'][number][];
  t: Translator;
}>): ReactElement {
  return (
    <>
      <p className="or-small or-rail__line">
        {medications.length === 0
          ? t('chart.rail.medications.none')
          : counted(t, MEDICATION_COUNT_KEYS, medications.length)}
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
  t,
}: Readonly<{
  nextAppointment: Appointment | null;
  previous: Visit | null;
  t: Translator;
}>): ReactElement {
  return (
    <>
      <p className="or-small or-rail__line">
        {nextAppointment
          ? t('chart.rail.appointments.next', {
              when: formatDateTime(nextAppointment.start, 'dense'),
              type: nextAppointment.type.display.toLowerCase(),
            })
          : t('chart.rail.appointments.none')}
      </p>
      <p className="or-caption or-rail__meta">
        {t('chart.rail.appointments.lastVisit', {
          date: previous ? formatDate(previous.date) : NOT_RECORDED,
        })}
      </p>
    </>
  );
}

/** What the patient owes, with the state said in words as well as in tint. */
function BalanceLine({
  balanceDue,
  t,
}: Readonly<{ balanceDue: number; t: Translator }>): ReactElement {
  const balance = formatMoney(balanceDue);
  const due = balanceDue > 0;

  return (
    <p className={due ? 'or-rail__balance or-rail__balance--due' : 'or-rail__balance'}>
      <span className="or-mono or-rail__amount">{balance.text}</span>
      <span className="or-caption or-rail__meta">
        {due ? t('chart.rail.balance.due') : t('chart.rail.balance.settled')}
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
  const t = useTranslator();
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

  /* The heading a reader sees and the accessible name of the section it opens
     are the same words, from the same key: two keys with one wording is two
     chances for a translation to make them disagree. */
  const allergies = t('chart.section.allergies');
  const problems = t('chart.section.problems');
  const medications = t('chart.section.medications');
  const careGaps = t('chart.section.careGaps');
  const documentation = t('chart.section.documentation');
  const appointments = t('chart.section.appointments');
  const balance = t('chart.section.balance');

  return (
    <Card
      className="or-rail"
      aria-label={t('chart.rail.label', { name: formatName(patient.name) })}
    >
      <IdentityBlock patient={patient} now={now} t={t} />

      <FlagList patient={patient} t={t} />

      <section className="or-rail__section" aria-label={allergies}>
        {heading(allergies, 'summary')}
        <AllergyBlock record={chart.allergies} t={t} />
      </section>

      <section className="or-rail__section" aria-label={problems}>
        {heading(problems, 'summary')}
        <ProblemList problems={activeProblems} t={t} />
      </section>

      <section className="or-rail__section" aria-label={medications}>
        {heading(medications, 'medications')}
        <MedicationSummary medications={activeMeds} t={t} />
      </section>

      {chart.careGaps.length > 0 ? (
        <section className="or-rail__section" aria-label={careGaps}>
          {heading(careGaps, 'summary')}
          <ul className="or-rail__list">
            {chart.careGaps.map((gap) => (
              <li key={gap.id} className="or-caption or-rail__meta">
                {/* The gap's own label is record data. When there is a date it
                    goes into one message with it rather than being followed by
                    a translated fragment, because a fragment beginning with a
                    comma cannot be reordered into another language. */}
                {gap.dueOn
                  ? t('chart.rail.careGaps.due', {
                      gap: gap.label,
                      date: formatDate(gap.dueOn, 'dense'),
                    })
                  : gap.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {unsigned.length > 0 ? (
        <section className="or-rail__section" aria-label={documentation}>
          {heading(documentation, 'visits')}
          <p className="or-small or-rail__line">
            {counted(t, UNSIGNED_NOTE_KEYS, unsigned.length)}
          </p>
          {unsigned[0]?.encounterId ? (
            <Link className="or-rail__link" href={`/encounters/${unsigned[0].encounterId}`}>
              {t('chart.rail.documentation.openNote', {
                date: formatDate(unsigned[0].date, 'dense'),
              })}
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="or-rail__section" aria-label={appointments}>
        {heading(appointments, 'visits')}
        <AppointmentLines nextAppointment={nextAppointment} previous={previous} t={t} />
      </section>

      <section className="or-rail__section" aria-label={balance}>
        {heading(balance, 'summary')}
        <BalanceLine balanceDue={chart.balanceDue} t={t} />
      </section>

      {children}
    </Card>
  );
}

'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Card, VitalStat } from '@openrunic/ui';
import type { StatusTone } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement } from 'react';

import type { Appointment } from '@/lib/api';
import type { ChartSummary, ResultObservation } from '@/lib/api/chart';
import { formatDate, formatDateTime, formatTime, formatVital } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { APPOINTMENT_STATUS_LABELS, NOTE_STATE_LABELS, PROBLEM_STATUS_INLINE } from './labels';

/**
 * CH-01, the 30-second pre-visit read.
 *
 * Ranked, not democratic. The legacy chart dashboard gave allergies, problems
 * and a portal widget the same visual weight and let the user toggle boxes on
 * and off; here the rail carries what is dangerous to forget and this panel
 * carries what is being decided today, in one order that never changes. There
 * is nothing to configure and nothing to click before it reads.
 *
 * The headings and the absences are this screen's words and come from the
 * catalogue. The visits, results, problems and medications named under them do
 * not: each already carries the name the record gave it.
 */

export interface SummaryPanelProps {
  chart: ChartSummary;
  /** Today's appointment, whatever its status, or null on a day with none. */
  todayAppointment: Appointment | null;
  now: string;
}

/** Olive for a visit that happened, red for one that did not, hazelnut for in-flight. */
function appointmentTone(status: Appointment['status']): StatusTone {
  if (status === 'NOSHOW' || status === 'ENTERED_IN_ERROR') return 'danger';
  if (status === 'FULFILLED' || status === 'CHECKED_OUT') return 'success';
  return 'neutral';
}

/**
 * The words for one appointment's state, in the reader's language.
 *
 * All twelve come from the catalogue now. The hand-written `NOSHOW` override
 * and the `formatEnumLabel` fallback it sat on are both gone: the enum spelling
 * it as one word and the glossary spelling it as two was a problem only while
 * the English was being derived from the enum name at all.
 */
function statusLabel(t: Translator, status: Appointment['status']): string {
  return t(APPOINTMENT_STATUS_LABELS[status].labelKey);
}

function reading(observation: ResultObservation): ReactElement {
  const vital = formatVital({
    label: observation.analyte,
    value: observation.value,
    unit: observation.unit,
    range: {
      low: observation.referenceLow ?? undefined,
      high: observation.referenceHigh ?? undefined,
    },
  });

  return (
    <VitalStat
      key={observation.id}
      label={vital.label}
      value={vital.value}
      unit={vital.unit}
      state={vital.state}
      stateLabel={vital.stateLabel}
      capturedAt={formatDate(observation.collectedAt, 'prose')}
    />
  );
}

/** The strip at the top: what is happening with this patient today. */
function TodayStrip({
  chart,
  todayAppointment,
  today,
  recentVisits,
  t,
}: Readonly<{
  chart: ChartSummary;
  todayAppointment: Appointment | null;
  today: string;
  recentVisits: readonly ChartSummary['visits'][number][];
  t: Translator;
}>): ReactElement {
  const todayVisit = chart.visits.find((visit) => visit.date === today) ?? null;

  if (!todayAppointment) {
    return (
      <p className="or-body">
        {t('chart.summary.noVisitToday', {
          // "never" is a word rather than a date, so the sentence still reads as
          // a sentence on a chart with nothing in it. Interpolated rather than
          // written as a second message, so a translator sees the whole line.
          date: recentVisits[0] ? formatDate(recentVisits[0].date) : t('chart.summary.never'),
        })}
      </p>
    );
  }

  return (
    <div className="or-chart-strip__row">
      <Badge tone={appointmentTone(todayAppointment.status)}>
        {statusLabel(t, todayAppointment.status)}
      </Badge>
      {/* Time, visit type and reason, all from the appointment. */}
      <p className="or-body">
        {[
          formatTime(todayAppointment.start),
          todayAppointment.type.display.toLowerCase(),
          todayAppointment.reasonText?.toLowerCase(),
        ]
          .filter(Boolean)
          .join(', ')}
      </p>
      {todayVisit?.encounterId ? (
        <Link className="or-chart-strip__link" href={`/encounters/${todayVisit.encounterId}`}>
          {t('chart.summary.openVisitNote')}
        </Link>
      ) : null}
    </div>
  );
}

export function SummaryPanel({
  chart,
  todayAppointment,
  now,
}: Readonly<SummaryPanelProps>): ReactElement {
  const t = useTranslator();
  const today = formatDate(now, 'iso');
  const recentVisits = [...chart.visits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const recentResults = [...chart.results]
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .slice(0, 3);
  const activeProblems = chart.problems.filter((problem) => problem.status !== 'RESOLVED');
  const activeMeds = chart.medications.filter((med) => med.status === 'ACTIVE');

  return (
    <div className="or-chart-summary">
      <Card overline={t('chart.summary.today')} className="or-chart-strip">
        <TodayStrip
          chart={chart}
          todayAppointment={todayAppointment}
          today={today}
          recentVisits={recentVisits}
          t={t}
        />
      </Card>

      <div className="or-chart-grid">
        <div className="or-chart-grid__column">
          <Card title={t('chart.summary.recentVisits')}>
            {recentVisits.length === 0 ? (
              <p className="or-body">{t('chart.summary.noVisits')}</p>
            ) : (
              <ul className="or-chart-list">
                {recentVisits.map((visit) => (
                  <li key={visit.id} className="or-chart-item">
                    {/* Date and visit type, both from the record. */}
                    <p className="or-chart-item__title">
                      {formatDate(visit.date)}, {visit.type.toLowerCase()}
                    </p>
                    <p className="or-caption or-chart-item__meta">
                      {visit.providerName}, {visit.reason.toLowerCase()}
                    </p>
                    <div className="or-chart-item__row">
                      <Badge tone={visit.noteState === 'SIGNED' ? 'success' : 'neutral'}>
                        {visit.noteState === 'NONE'
                          ? t('chart.visits.noNote')
                          : t(NOTE_STATE_LABELS[visit.noteState].labelKey)}
                      </Badge>
                      {visit.encounterId ? (
                        <Link
                          className="or-chart-item__link"
                          href={`/encounters/${visit.encounterId}`}
                        >
                          {t('chart.visits.openNote')}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('chart.summary.recentResults')}>
            {recentResults.length === 0 ? (
              <p className="or-body">{t('chart.summary.noResults')}</p>
            ) : (
              <div className="or-chart-readings">
                {recentResults.map(reading)}
                <p className="or-caption or-chart-item__meta">
                  {t('chart.summary.collected', {
                    when: formatDateTime(recentResults[0]?.collectedAt, 'prose'),
                  })}
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="or-chart-grid__column">
          <Card title={t('chart.summary.activeProblems')}>
            {activeProblems.length === 0 ? (
              <p className="or-body">{t('chart.summary.noProblems')}</p>
            ) : (
              <ul className="or-chart-list">
                {activeProblems.map((problem) => (
                  <li key={problem.id} className="or-chart-item">
                    <p className="or-chart-item__title">{problem.name}</p>
                    {/* The code is rendered mono, so it stays outside the
                        message; everything from the coding system onwards is
                        one sentence a translator can reorder. */}
                    <p className="or-caption or-chart-item__meta">
                      <span className="or-mono">{problem.code}</span>{' '}
                      {t('chart.summary.problemMeta', {
                        system: problem.codeSystem,
                        onset: formatDate(problem.onsetOn),
                        status: t(PROBLEM_STATUS_INLINE[problem.status].labelKey),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('chart.medications.title')}>
            {activeMeds.length === 0 ? (
              <p className="or-body">{t('chart.summary.noMedications')}</p>
            ) : (
              <ul className="or-chart-list">
                {activeMeds.map((med) => (
                  <li key={med.id} className="or-chart-item">
                    <p className="or-chart-item__title">{med.drug}</p>
                    <p className="or-caption or-chart-item__meta">{med.sig}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {chart.careGaps.length > 0 ? (
            <Card title={t('chart.section.careGaps')}>
              <ul className="or-chart-list">
                {chart.careGaps.map((gap) => (
                  <li key={gap.id} className="or-chart-item">
                    <p className="or-chart-item__title">{gap.label}</p>
                    <p className="or-caption or-chart-item__meta">
                      {gap.dueOn
                        ? t('chart.summary.careGapDue', { date: formatDate(gap.dueOn) })
                        : t('chart.summary.careGapNoDate')}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

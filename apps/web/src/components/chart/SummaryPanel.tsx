'use client';

import { Badge, Card, VitalStat } from '@openrunic/ui';
import type { StatusTone } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement } from 'react';

import type { Appointment } from '@/lib/api';
import type { ChartSummary, ResultObservation } from '@/lib/api/chart';
import { formatDate, formatDateTime, formatEnumLabel, formatTime, formatVital } from '@/lib/format';

/**
 * CH-01, the 30-second pre-visit read.
 *
 * Ranked, not democratic. The legacy chart dashboard gave allergies, problems
 * and a portal widget the same visual weight and let the user toggle boxes on
 * and off; here the rail carries what is dangerous to forget and this panel
 * carries what is being decided today, in one order that never changes. There
 * is nothing to configure and nothing to click before it reads.
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
 * `formatEnumLabel` turns `NOSHOW` into "Noshow", because the enum spells it as
 * one word. The glossary spells it as two, so the two statuses whose enum name
 * is not their English name get read out here.
 */
const STATUS_LABEL: Partial<Record<Appointment['status'], string>> = {
  NOSHOW: 'No show',
  ENTERED_IN_ERROR: 'Entered in error',
};

function statusLabel(status: Appointment['status']): string {
  return STATUS_LABEL[status] ?? formatEnumLabel(status);
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

export function SummaryPanel({
  chart,
  todayAppointment,
  now,
}: Readonly<SummaryPanelProps>): ReactElement {
  const today = formatDate(now, 'iso');
  const todayVisit = chart.visits.find((visit) => visit.date === today) ?? null;
  const recentVisits = [...chart.visits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const recentResults = [...chart.results]
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .slice(0, 3);
  const activeProblems = chart.problems.filter((problem) => problem.status !== 'RESOLVED');
  const activeMeds = chart.medications.filter((med) => med.status === 'ACTIVE');

  return (
    <div className="or-chart-summary">
      <Card overline="Today" className="or-chart-strip">
        {todayAppointment ? (
          <div className="or-chart-strip__row">
            <Badge tone={appointmentTone(todayAppointment.status)}>
              {statusLabel(todayAppointment.status)}
            </Badge>
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
                Open the visit note
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="or-body">
            No visit today. The last recorded visit was{' '}
            {recentVisits[0] ? formatDate(recentVisits[0].date) : 'never'}.
          </p>
        )}
      </Card>

      <div className="or-chart-grid">
        <div className="or-chart-grid__column">
          <Card title="Recent visits">
            {recentVisits.length === 0 ? (
              <p className="or-body">No visits recorded.</p>
            ) : (
              <ul className="or-chart-list">
                {recentVisits.map((visit) => (
                  <li key={visit.id} className="or-chart-item">
                    <p className="or-chart-item__title">
                      {formatDate(visit.date)}, {visit.type.toLowerCase()}
                    </p>
                    <p className="or-caption or-chart-item__meta">
                      {visit.providerName}, {visit.reason.toLowerCase()}
                    </p>
                    <div className="or-chart-item__row">
                      <Badge tone={visit.noteState === 'SIGNED' ? 'success' : 'neutral'}>
                        {visit.noteState === 'NONE' ? 'No note' : formatEnumLabel(visit.noteState)}
                      </Badge>
                      {visit.encounterId ? (
                        <Link
                          className="or-chart-item__link"
                          href={`/encounters/${visit.encounterId}`}
                        >
                          Open note
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent results">
            {recentResults.length === 0 ? (
              <p className="or-body">No results recorded.</p>
            ) : (
              <div className="or-chart-readings">
                {recentResults.map(reading)}
                <p className="or-caption or-chart-item__meta">
                  Collected {formatDateTime(recentResults[0]?.collectedAt, 'prose')}
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="or-chart-grid__column">
          <Card title="Active problems">
            {activeProblems.length === 0 ? (
              <p className="or-body">No problems recorded.</p>
            ) : (
              <ul className="or-chart-list">
                {activeProblems.map((problem) => (
                  <li key={problem.id} className="or-chart-item">
                    <p className="or-chart-item__title">{problem.name}</p>
                    <p className="or-caption or-chart-item__meta">
                      <span className="or-mono">{problem.code}</span> {problem.codeSystem}, since{' '}
                      {formatDate(problem.onsetOn)}, {formatEnumLabel(problem.status).toLowerCase()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Current medications">
            {activeMeds.length === 0 ? (
              <p className="or-body">No current medications.</p>
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
            <Card title="Care gaps">
              <ul className="or-chart-list">
                {chart.careGaps.map((gap) => (
                  <li key={gap.id} className="or-chart-item">
                    <p className="or-chart-item__title">{gap.label}</p>
                    <p className="or-caption or-chart-item__meta">
                      {gap.dueOn ? `Due ${formatDate(gap.dueOn)}` : 'No target date'}
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

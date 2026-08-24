'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge } from '@openrunic/ui';
import type { CSSProperties, ReactElement } from 'react';

import type { Appointment, Patient } from '@/lib/api';
import { formatName, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import {
  assignLanes,
  categoryViz,
  dayWindow,
  groupByProvider,
  minutesOfDay,
  presentStatus,
  SLOT_MINUTES,
} from './schedule';

/**
 * The day grid: a time axis, one column per provider, one block per visit.
 *
 * It is the front door of the whole product, so it answers four questions
 * without a click: who is booked, with whom, in what state, and where the day
 * has run into itself. Category colour lives on a 4px left edge only; the block
 * body stays cream, because a wall of saturated blocks is unreadable by 3pm.
 *
 * Layout is one CSS grid. Rows are ten-minute slots, columns are providers, and
 * an appointment is placed by row span rather than absolute pixels, so nothing
 * has to be measured and nothing shifts after first paint.
 */

export interface ScheduleProvider {
  id: string;
  name: string;
  role: string;
}

export interface ScheduleGridProps {
  appointments: readonly Appointment[];
  providers: readonly ScheduleProvider[];
  patientsById: ReadonlyMap<string, Patient>;
  /** The instant the current-time rule is drawn at. */
  now: Date;
  selectedId: string | null;
  onSelect: (appointmentId: string) => void;
}

interface GridStyle extends CSSProperties {
  '--or-sched-cols': number;
  '--or-sched-rows': number;
}

interface BlockStyle extends CSSProperties {
  '--or-block-edge': string;
  '--or-lane': number;
  '--or-lanes': number;
}

interface NowStyle extends CSSProperties {
  '--or-now-offset': number;
}

/** Header row plus the slot rows; every grid row below is offset by it. */
const HEADER_ROWS = 1;

function patientLabel(
  appointment: Appointment,
  patientsById: ReadonlyMap<string, Patient>,
  t: Translator
): string {
  const patient = appointment.patientId ? patientsById.get(appointment.patientId) : undefined;
  return patient ? formatName(patient.name) : t('schedule.visit.unassignedSlot');
}

export function ScheduleGrid({
  appointments,
  providers,
  patientsById,
  now,
  selectedId,
  onSelect,
}: Readonly<ScheduleGridProps>): ReactElement {
  const t = useTranslator();

  /* A cancelled visit frees its slot, so it belongs in the day's counts rather
     than on the grid; a no-show consumed the slot and stays visible. */
  const onGrid = appointments.filter((appointment) => appointment.status !== 'CANCELLED');
  const window = dayWindow(onGrid);
  const columns = groupByProvider(
    onGrid,
    providers.map((provider) => provider.id)
  );

  const hours: number[] = [];
  for (let minutes = window.openMinutes; minutes < window.closeMinutes; minutes += 60) {
    hours.push(minutes);
  }

  const nowMinutes = minutesOfDay(now.toISOString());
  const nowVisible =
    nowMinutes !== null && nowMinutes >= window.openMinutes && nowMinutes < window.closeMinutes;

  const gridStyle: GridStyle = {
    '--or-sched-cols': providers.length,
    '--or-sched-rows': window.rows,
  };

  return (
    <div className="or-sched" style={gridStyle}>
      {/* A named <section> is the region landmark natively, so no explicit role.
          `tabIndex` is deliberate and required: this is a scrollable container
          (see `.or-sched__scroll`), and WCAG 2.1.1 means a keyboard-only user
          must be able to focus it to scroll a day that overflows. The day can be
          empty of appointment buttons and still need scrolling, so the inner
          controls are not a substitute. `:focus-visible` is styled for it. */}
      <section className="or-sched__scroll" tabIndex={0} aria-label={t('schedule.grid.label')}>
        <div className="or-sched__grid">
          <div className="or-sched__corner">
            <span className="or-overline">{t('schedule.grid.timeColumn')}</span>
          </div>

          {providers.map((provider, index) => (
            <div
              key={provider.id}
              className="or-sched__column-head"
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              {/* Level 2: a provider column is a top-level section of the day
                  view, and the page heading above it is the only h1. */}
              <h2 className="or-sched__provider">{provider.name}</h2>
              <p className="or-caption or-sched__provider-role">{provider.role}</p>
            </div>
          ))}

          {hours.map((minutes) => {
            const row = (minutes - window.openMinutes) / SLOT_MINUTES + 1 + HEADER_ROWS;
            const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:00`;
            return (
              <div
                key={`hour-${minutes}`}
                className="or-sched__hour"
                style={{ gridColumn: 1, gridRow: `${row} / span ${60 / SLOT_MINUTES}` }}
              >
                <span className="or-mono or-sched__hour-label">{label}</span>
              </div>
            );
          })}

          {hours.map((minutes) => {
            const row = (minutes - window.openMinutes) / SLOT_MINUTES + 1 + HEADER_ROWS;
            return (
              <div
                key={`rule-${minutes}`}
                className="or-sched__rule"
                aria-hidden="true"
                style={{
                  gridColumn: `2 / span ${Math.max(1, providers.length)}`,
                  gridRow: `${row} / span ${60 / SLOT_MINUTES}`,
                }}
              />
            );
          })}

          {providers.map((provider, index) => {
            const placed = assignLanes(columns.get(provider.id) ?? [], window);
            return placed.map((entry) => {
              const { appointment, lane, lanes, rowStart, rowEnd } = entry;
              const status = presentStatus(appointment.status);
              const name = patientLabel(appointment, patientsById, t);
              const start = formatTime(appointment.start);
              const end = formatTime(appointment.end);
              const doubleBooked = lanes > 1;
              const statusLabel = t(status.labelKey);
              const doubleBookedLabel = t('schedule.grid.doubleBooked');

              const blockStyle: BlockStyle = {
                '--or-block-edge': `var(--viz-${categoryViz(appointment.type.code)})`,
                '--or-lane': lane,
                '--or-lanes': lanes,
                gridColumn: index + 2,
                gridRow: `${rowStart + HEADER_ROWS} / ${rowEnd + HEADER_ROWS}`,
              };

              return (
                <button
                  key={appointment.id}
                  type="button"
                  className="or-sched__block"
                  style={blockStyle}
                  data-selected={appointment.id === selectedId || undefined}
                  data-done={status.done || undefined}
                  data-double-booked={doubleBooked || undefined}
                  aria-pressed={appointment.id === selectedId}
                  aria-label={[
                    t('schedule.grid.timeRange', { start, end }),
                    name,
                    appointment.type.display,
                    provider.name,
                    statusLabel,
                    doubleBooked ? doubleBookedLabel : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  onClick={() => onSelect(appointment.id)}
                >
                  <span className="or-sched__block-edge" aria-hidden="true" />
                  <span className="or-sched__block-body">
                    <span className="or-mono or-sched__block-time">{start}</span>
                    <span className="or-sched__block-name">{name}</span>
                    <span className="or-caption or-sched__block-type">
                      {appointment.type.display}
                    </span>
                    <span className="or-sched__block-status">
                      <Badge tone={status.tone}>{statusLabel}</Badge>
                      {doubleBooked ? <Badge tone="danger">{doubleBookedLabel}</Badge> : null}
                    </span>
                  </span>
                </button>
              );
            });
          })}

          {nowVisible ? (
            <div
              className="or-sched__now"
              style={
                {
                  '--or-now-offset':
                    ((nowMinutes - window.openMinutes) % SLOT_MINUTES) / SLOT_MINUTES,
                  gridColumn: `1 / span ${providers.length + 1}`,
                  gridRow:
                    Math.floor((nowMinutes - window.openMinutes) / SLOT_MINUTES) + 1 + HEADER_ROWS,
                } as NowStyle
              }
            >
              <span className="or-mono or-sched__now-label">
                {t('schedule.grid.now', { time: formatTime(now.toISOString()) })}
              </span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

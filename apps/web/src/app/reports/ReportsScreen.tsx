'use client';

import { Badge, Button, Card, Input, Select, Table, Toast } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { Translator } from '@openrunic/i18n';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { FilterBar } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { BarMeter, StatTile } from '@/components/reports';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import {
  MOCK_PROVIDERS,
  useAdminClientOption,
  usePracticeDashboard,
  useVisitReport,
} from '@/lib/api';
import type { AdminClient, VisitReportRow } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/csv';
import type { CsvColumn } from '@/lib/csv';
import { formatDate, formatDateTime, formatEnumLabel, formatMoney } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * RP-01 practice dashboard, with RP-02's report shell underneath it.
 *
 * A healthy practice's dashboard should look almost boring, so the tint appears
 * only on the tiles whose threshold is breached and everything else stays
 * neutral. Every number is a link to the workbench that owns it: the owner
 * answers "are we okay" in ten seconds and reaches the trouble in one click.
 *
 * Below the tiles is the report canon: title, one describing sentence, a filter
 * bar with the date range first, a compact table with a pinned totals row, and
 * a CSV export. Every other report in the product is a new configuration of
 * this shell, not a new page.
 *
 * ## What is translated here and what is not
 *
 * The furniture is: headings, filter labels, column headers, empty states, the
 * export toast. The numbers' own names are not. A tile label, a funnel stage
 * name, an ageing bucket name and an appointment status all arrive from the API
 * already worded, and putting a second name on them here is how a dashboard
 * ends up disagreeing with the workbench it links to.
 */

export interface ReportsScreenProps {
  client?: AdminClient;
}

/**
 * The visits table's columns, and the export's.
 *
 * One key per column, shared by both, because a column called one thing on
 * screen and another in the spreadsheet is the same defect as a mistranslation
 * with a longer feedback loop. They are built from the translator rather than
 * declared at module scope for the obvious reason: a module constant is
 * evaluated once, before anybody has a language.
 */
function reportColumns(t: Translator): TableColumn[] {
  return [
    { key: 'date', header: t('reports.column.date') },
    { key: 'patient', header: t('reports.column.patient') },
    { key: 'provider', header: t('reports.column.provider') },
    { key: 'visitType', header: t('reports.column.visitType') },
    { key: 'status', header: t('reports.column.status') },
    { key: 'duration', header: t('reports.column.minutes'), numeric: true },
    { key: 'charge', header: t('reports.column.charges'), numeric: true },
    { key: 'claim', header: t('reports.column.claim') },
  ];
}

function csvColumns(t: Translator): Array<CsvColumn<VisitReportRow>> {
  return [
    { header: t('reports.column.date'), value: (row) => row.date },
    { header: t('reports.column.time'), value: (row) => row.time },
    { header: t('reports.column.patient'), value: (row) => row.patientName },
    { header: t('reports.column.mrn'), value: (row) => row.patientMrn },
    { header: t('reports.column.provider'), value: (row) => row.providerName },
    { header: t('reports.column.facility'), value: (row) => row.facilityName },
    { header: t('reports.column.visitType'), value: (row) => row.visitType },
    { header: t('reports.column.status'), value: (row) => formatEnumLabel(row.status) },
    { header: t('reports.column.minutes'), value: (row) => row.durationMinutes },
    { header: t('reports.column.charges'), value: (row) => row.chargeAmount.toFixed(2) },
    { header: t('reports.column.claimState'), value: (row) => row.claimState },
  ];
}

/**
 * The appointment statuses the filter offers.
 *
 * The labels are deliberately NOT catalogue keys. They are the wording of a
 * server enum, and the table beside this filter renders the same enum through
 * `formatEnumLabel`, which has no catalogue either. Translating one side and
 * not the other would put two different names on one coded value in a single
 * viewport, which is exactly the hazard the catalogue's own header warns about.
 * Both sides want doing together, from the API's own display strings.
 */
const STATUS_VALUES = [
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'CHECKED_OUT', label: 'Checked out' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ROOMED', label: 'Roomed' },
  { value: 'CHECKED_IN', label: 'Checked in' },
  { value: 'NOSHOW', label: 'No-show' },
];

export function ReportsScreen({ client }: Readonly<ReportsScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);
  const dashboard = usePracticeDashboard(options);

  const [from, setFrom] = useState('2026-08-10');
  const [to, setTo] = useState('2026-08-12');
  const [providerId, setProviderId] = useState('');
  const [status, setStatus] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const report = useVisitReport(
    {
      from: from || undefined,
      to: to || undefined,
      providerId: providerId || undefined,
      status: status || undefined,
    },
    options
  );

  /* Memoised: the export command closes over it. */
  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);

  const providerOptions = useMemo(
    () => [
      { value: '', label: t('reports.filter.allProviders') },
      ...MOCK_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name })),
    ],
    [t]
  );

  const statusOptions = useMemo(
    () => [{ value: '', label: t('reports.filter.allStatuses') }, ...STATUS_VALUES],
    [t]
  );

  const exportReport = useCallback(() => {
    const wrote = downloadCsv(`visits-${from}-to-${to}.csv`, toCsv(csvColumns(t), rows));
    setToast(
      wrote
        ? t('reports.export.done', {
            count: rows.length,
            from: formatDate(from),
            to: formatDate(to),
          })
        : t('reports.export.unsupported')
    );
  }, [rows, from, to, t]);

  const thisWeek = useCallback(() => {
    setFrom('2026-08-10');
    setTo('2026-08-12');
    setProviderId('');
    setStatus('');
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'reports.visits.export',
        group: 'actions',
        label: t('reports.action.export'),
        keywords: t('reports.command.export.keywords')
          .split(',')
          .map((word) => word.trim())
          .filter((word) => word !== ''),
        icon: 'download',
        perform: exportReport,
      },
      {
        id: 'reports.visits.week',
        group: 'actions',
        label: t('reports.command.week.label'),
        keywords: t('reports.command.week.keywords')
          .split(',')
          .map((word) => word.trim())
          .filter((word) => word !== ''),
        icon: 'calendar-range',
        perform: thisWeek,
      },
    ],
    [exportReport, thisWeek, t]
  );

  return (
    <AppShell
      title={t('reports.title')}
      description={t('reports.description')}
      breadcrumb={[{ label: t('reports.title') }]}
      actions={
        <Button variant="secondary" iconLeft="download" onClick={exportReport}>
          {t('reports.action.export')}
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      {/* ---- RP-01 dashboard ------------------------------------------- */}
      <AsyncBoundary
        state={dashboard}
        subject={t('reports.subject.dashboard')}
        isEmpty={(data) => data.tiles.length === 0}
        loadingVariant="cards"
        loadingRows={5}
        empty={{
          title: t('reports.dashboard.empty.title'),
          message: t('reports.dashboard.empty.message'),
          icon: 'chart-column',
          action: (
            <Button variant="primary" href="/schedule">
              {t('reports.dashboard.empty.action')}
            </Button>
          ),
        }}
      >
        {(data) => (
          <>
            <p className="or-small or-report__asof">
              {t('reports.dashboard.asOf', { when: formatDateTime(data.asOf, 'prose') })}
            </p>

            <ul className="or-tiles">
              {data.tiles.map((tile) => (
                <li key={tile.id}>
                  <StatTile tile={tile} />
                </li>
              ))}
            </ul>

            <div className="or-report__pair">
              <Card title={t('reports.funnel.title')}>
                <p className="or-small">{t('reports.funnel.lede')}</p>
                <BarMeter
                  label={t('reports.funnel.meterLabel')}
                  rows={data.funnel.map((stage) => ({
                    id: stage.id,
                    label: stage.label,
                    value: stage.count,
                    valueText: t('reports.funnel.claimCount', { count: stage.count }),
                    attention: stage.id === 'denied' && stage.count > 0,
                    detail:
                      stage.id === 'denied' && stage.count > 0
                        ? t('reports.funnel.needsBiller')
                        : undefined,
                  }))}
                />
                <Link className="or-link" href="/billing">
                  {t('reports.funnel.link')}
                </Link>
              </Card>

              <Card title={t('reports.aging.title')}>
                <p className="or-small">{t('reports.aging.lede')}</p>
                <BarMeter
                  label={t('reports.aging.meterLabel')}
                  rows={data.aging.map((bucket) => ({
                    id: bucket.id,
                    label: bucket.label,
                    value: bucket.payerAmount + bucket.patientAmount,
                    valueText: formatMoney(bucket.payerAmount + bucket.patientAmount).text,
                    detail: t('reports.aging.split', {
                      payer: formatMoney(bucket.payerAmount).text,
                      patient: formatMoney(bucket.patientAmount).text,
                    }),
                    attention: bucket.id === '90-plus',
                  }))}
                />
                <Link className="or-link" href="/billing">
                  {t('reports.aging.link')}
                </Link>
              </Card>
            </div>

            <Card title={t('reports.unsigned.title')}>
              <Table
                caption={t('reports.unsigned.caption')}
                columns={[
                  { key: 'provider', header: t('reports.column.provider') },
                  { key: 'unsigned', header: t('reports.column.unsigned'), numeric: true },
                  { key: 'oldest', header: t('reports.column.oldest') },
                  { key: 'state', header: t('reports.column.state') },
                ]}
                rows={data.unsignedByProvider.map((entry) => ({
                  id: entry.providerId,
                  provider: entry.providerName,
                  unsigned: String(entry.unsigned),
                  oldest: t('reports.unsigned.days', { days: entry.oldestDays }),
                  state:
                    entry.oldestDays > 2 ? (
                      <Badge tone="danger">{t('reports.unsigned.late')}</Badge>
                    ) : (
                      <Badge tone="success">{t('reports.unsigned.onTarget')}</Badge>
                    ),
                }))}
              />
            </Card>
          </>
        )}
      </AsyncBoundary>

      {/* ---- RP-02 report shell ---------------------------------------- */}
      <section className="or-report" aria-labelledby="visits-report">
        <h2 id="visits-report" className="or-h3">
          {t('reports.visits.title')}
        </h2>
        <p className="or-body or-report__description">{t('reports.visits.description')}</p>

        <FilterBar
          label={t('reports.filter.label')}
          summary={
            report.data
              ? t('reports.filter.summary', {
                  visits: report.data.totals.visits,
                  minutes: report.data.totals.minutes,
                  charges: formatMoney(report.data.totals.charges).text,
                })
              : null
          }
          actions={
            <Button variant="ghost" size="sm" iconLeft="download" onClick={exportReport}>
              {t('reports.action.exportCsv')}
            </Button>
          }
        >
          <Input
            label={t('reports.filter.from')}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label={t('reports.filter.to')}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <Select
            label={t('reports.filter.provider')}
            options={providerOptions}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          />
          <Select
            label={t('reports.filter.status')}
            options={statusOptions}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          />
        </FilterBar>

        <AsyncBoundary
          state={report}
          subject={t('reports.subject.visits')}
          isEmpty={(data) => data.rows.length === 0}
          loadingRows={8}
          empty={{
            title: t('reports.visits.empty.title'),
            message: t('reports.visits.empty.message'),
            icon: 'calendar-days',
            action: (
              <Button variant="secondary" onClick={thisWeek}>
                {t('reports.visits.empty.action')}
              </Button>
            ),
          }}
        >
          {(data) => (
            <>
              <Table
                caption={t('reports.visits.caption', {
                  from: formatDate(from),
                  to: formatDate(to),
                })}
                columns={reportColumns(t)}
                rows={data.rows.map((row) => ({
                  id: row.id,
                  date: (
                    <span className="or-cell-stack">
                      <span className="or-small">{formatDate(row.date, 'dense')}</span>
                      <span className="or-caption or-mono">{row.time}</span>
                    </span>
                  ),
                  patient: (
                    <span className="or-cell-stack">
                      <span className="or-small">{row.patientName}</span>
                      <span className="or-caption or-mono">{row.patientMrn}</span>
                    </span>
                  ),
                  provider: <span className="or-small">{row.providerName}</span>,
                  visitType: <span className="or-small">{row.visitType}</span>,
                  status: <span className="or-small">{formatEnumLabel(row.status)}</span>,
                  duration: String(row.durationMinutes),
                  charge: formatMoney(row.chargeAmount).text,
                  claim: <span className="or-small">{row.claimState}</span>,
                }))}
              />

              {/* The totals row is pinned below the table rather than inside it,
                  so it stays readable when the table scrolls horizontally. */}
              <dl className="or-report__totals" data-testid="visits-totals">
                <div>
                  <dt className="or-small">{t('reports.totals.visits')}</dt>
                  <dd className="or-mono">{data.totals.visits}</dd>
                </div>
                <div>
                  <dt className="or-small">{t('reports.totals.minutes')}</dt>
                  <dd className="or-mono">{data.totals.minutes}</dd>
                </div>
                <div>
                  <dt className="or-small">{t('reports.totals.charges')}</dt>
                  <dd className="or-mono">{formatMoney(data.totals.charges).text}</dd>
                </div>
              </dl>
            </>
          )}
        </AsyncBoundary>
      </section>

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="info" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}

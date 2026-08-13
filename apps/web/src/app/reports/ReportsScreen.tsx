'use client';

import { Badge, Button, Card, Input, Select, Table, Toast } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
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
 */

export interface ReportsScreenProps {
  client?: AdminClient;
}

const REPORT_COLUMNS: TableColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'patient', header: 'Patient' },
  { key: 'provider', header: 'Provider' },
  { key: 'visitType', header: 'Visit type' },
  { key: 'status', header: 'Status' },
  { key: 'duration', header: 'Minutes', numeric: true },
  { key: 'charge', header: 'Charges', numeric: true },
  { key: 'claim', header: 'Claim' },
];

const CSV_COLUMNS: Array<CsvColumn<VisitReportRow>> = [
  { header: 'Date', value: (row) => row.date },
  { header: 'Time', value: (row) => row.time },
  { header: 'Patient', value: (row) => row.patientName },
  { header: 'MRN', value: (row) => row.patientMrn },
  { header: 'Provider', value: (row) => row.providerName },
  { header: 'Facility', value: (row) => row.facilityName },
  { header: 'Visit type', value: (row) => row.visitType },
  { header: 'Status', value: (row) => formatEnumLabel(row.status) },
  { header: 'Minutes', value: (row) => row.durationMinutes },
  { header: 'Charges', value: (row) => row.chargeAmount.toFixed(2) },
  { header: 'Claim state', value: (row) => row.claimState },
];

const PROVIDER_OPTIONS = [
  { value: '', label: 'All providers' },
  ...MOCK_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name })),
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'CHECKED_OUT', label: 'Checked out' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ROOMED', label: 'Roomed' },
  { value: 'CHECKED_IN', label: 'Checked in' },
  { value: 'NOSHOW', label: 'No-show' },
];

export function ReportsScreen({ client }: ReportsScreenProps = {}): ReactElement {
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

  const exportReport = useCallback(() => {
    const wrote = downloadCsv(`visits-${from}-to-${to}.csv`, toCsv(CSV_COLUMNS, rows));
    setToast(
      wrote
        ? `Exported ${rows.length} visits for ${formatDate(from)} to ${formatDate(to)}.`
        : 'This browser cannot download files. Copy the table instead.'
    );
  }, [rows, from, to]);

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
        label: 'Export the visits report',
        keywords: ['csv', 'download', 'visits'],
        icon: 'download',
        perform: exportReport,
      },
      {
        id: 'reports.visits.week',
        group: 'actions',
        label: 'Report on this week',
        keywords: ['date range', 'reset filters'],
        icon: 'calendar-range',
        perform: thisWeek,
      },
    ],
    [exportReport, thisWeek]
  );

  return (
    <AppShell
      title="Reports"
      description="Is the practice healthy today, and the numbers behind the answer."
      breadcrumb={[{ label: 'Reports' }]}
      actions={
        <Button variant="secondary" iconLeft="download" onClick={exportReport}>
          Export the visits report
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      {/* ---- RP-01 dashboard ------------------------------------------- */}
      <AsyncBoundary
        state={dashboard}
        subject="the practice dashboard"
        isEmpty={(data) => data.tiles.length === 0}
        loadingVariant="cards"
        loadingRows={5}
        empty={{
          title: 'Nothing to report yet',
          message:
            'The dashboard fills in as the practice works: visits booked, notes signed, claims submitted. Book the first appointment and it starts here.',
          icon: 'chart-column',
          action: (
            <Button variant="primary" href="/schedule">
              Go to the schedule
            </Button>
          ),
        }}
      >
        {(data) => (
          <>
            <p className="or-small or-report__asof">
              As of {formatDateTime(data.asOf, 'prose')}. Every number opens the workbench that owns
              it.
            </p>

            <ul className="or-tiles">
              {data.tiles.map((tile) => (
                <li key={tile.id}>
                  <StatTile tile={tile} />
                </li>
              ))}
            </ul>

            <div className="or-report__pair">
              <Card title="Claims, captured to paid">
                <p className="or-small">
                  Counts this month. The gap between two stages is where money waits.
                </p>
                <BarMeter
                  label="Claim funnel by stage"
                  rows={data.funnel.map((stage) => ({
                    id: stage.id,
                    label: stage.label,
                    value: stage.count,
                    valueText: `${stage.count} claims`,
                    attention: stage.id === 'denied' && stage.count > 0,
                    detail: stage.id === 'denied' && stage.count > 0 ? 'Needs a biller' : undefined,
                  }))}
                />
                <Link className="or-link" href="/billing">
                  Open the claim workbench
                </Link>
              </Card>

              <Card title="Accounts receivable by age">
                <p className="or-small">
                  Payer and patient responsibility, split. Over 90 days is the number to watch.
                </p>
                <BarMeter
                  label="Accounts receivable by age"
                  rows={data.aging.map((bucket) => ({
                    id: bucket.id,
                    label: bucket.label,
                    value: bucket.payerAmount + bucket.patientAmount,
                    valueText: formatMoney(bucket.payerAmount + bucket.patientAmount).text,
                    detail: `Payer ${formatMoney(bucket.payerAmount).text}, patient ${formatMoney(bucket.patientAmount).text}`,
                    attention: bucket.id === '90-plus',
                  }))}
                />
                <Link className="or-link" href="/billing">
                  Open collections
                </Link>
              </Card>
            </div>

            <Card title="Unsigned notes by provider">
              <Table
                caption="Unsigned notes by provider"
                columns={[
                  { key: 'provider', header: 'Provider' },
                  { key: 'unsigned', header: 'Unsigned', numeric: true },
                  { key: 'oldest', header: 'Oldest' },
                  { key: 'state', header: 'State' },
                ]}
                rows={data.unsignedByProvider.map((entry) => ({
                  id: entry.providerId,
                  provider: entry.providerName,
                  unsigned: String(entry.unsigned),
                  oldest: `${entry.oldestDays} days`,
                  state:
                    entry.oldestDays > 2 ? (
                      <Badge tone="danger">Past the 48 hour target</Badge>
                    ) : (
                      <Badge tone="success">Within target</Badge>
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
          Visits
        </h2>
        <p className="or-body or-report__description">
          Every visit in the range with its duration, charges and claim state. The same shell
          carries every other report in openrunic; only the filters and columns change.
        </p>

        <FilterBar
          label="Filter the visits report"
          summary={
            report.data
              ? `${report.data.totals.visits} visits, ${report.data.totals.minutes} minutes, ${formatMoney(report.data.totals.charges).text}`
              : null
          }
          actions={
            <Button variant="ghost" size="sm" iconLeft="download" onClick={exportReport}>
              Export CSV
            </Button>
          }
        >
          <Input
            label="From"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <Select
            label="Provider"
            options={PROVIDER_OPTIONS}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          />
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          />
        </FilterBar>

        <AsyncBoundary
          state={report}
          subject="the visits report"
          isEmpty={(data) => data.rows.length === 0}
          loadingRows={8}
          empty={{
            title: 'No visits match these filters',
            message:
              'Nothing happened in this range for the chosen provider and status. Widen the dates, or clear the provider to see the whole practice.',
            icon: 'calendar-days',
            action: (
              <Button variant="secondary" onClick={thisWeek}>
                Reset to this week
              </Button>
            ),
          }}
        >
          {(data) => (
            <>
              <Table
                caption={`Visits from ${formatDate(from)} to ${formatDate(to)}`}
                columns={REPORT_COLUMNS}
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
                  <dt className="or-small">Visits</dt>
                  <dd className="or-mono">{data.totals.visits}</dd>
                </div>
                <div>
                  <dt className="or-small">Minutes</dt>
                  <dd className="or-mono">{data.totals.minutes}</dd>
                </div>
                <div>
                  <dt className="or-small">Charges</dt>
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

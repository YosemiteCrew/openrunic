'use client';

import type { Translator } from '@openrunic/i18n';
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
import { counted, searchWords } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
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
 * ## What is translated here, and what is not
 *
 * Every word this screen writes is a catalogue key. What arrives from the API
 * is not: a tile's label and its state word, a funnel stage's name, an ageing
 * bucket's name, a provider's name, a visit's type and its claim state are all
 * served already named, and giving them a second name in the interface is how
 * one number ends up with two words for it on the same screen.
 *
 * The status filter is the one place that looks like the second and is the
 * first. Its six options are this application's own wording for the appointment
 * states this codebase defines, so they are copy in exactly the way an order's
 * status label is. The status *column* is the other side of that line: it
 * renders `formatEnumLabel` over whatever the row carried, and is left alone
 * rather than given a reports-local translation the schedule would not share.
 */

export interface ReportsScreenProps {
  client?: AdminClient;
}

/**
 * The six appointment states this filter offers, as catalogue keys.
 *
 * A literal map rather than a key built from the enum member, because
 * `catalogue-drift.test.ts` reads `somethingKey:` out of the source and a key
 * assembled at runtime is invisible to it - which means it is also invisible to
 * whoever has to find it when the option renders as its own key.
 */
const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: 'FULFILLED', labelKey: 'reports.status.fulfilled' },
  { value: 'CHECKED_OUT', labelKey: 'reports.status.checkedOut' },
  { value: 'IN_PROGRESS', labelKey: 'reports.status.inProgress' },
  { value: 'ROOMED', labelKey: 'reports.status.roomed' },
  { value: 'CHECKED_IN', labelKey: 'reports.status.checkedIn' },
  { value: 'NOSHOW', labelKey: 'reports.status.noShow' },
];

/**
 * The three counted sentences on this screen, as their pairs of forms.
 *
 * A pair rather than one message with a number in it, because `count === 1`
 * is an English rule: `counted` asks the reader's own locale which form to
 * use, so a fork translating into a language with four of them gets a
 * sentence that agrees rather than one that reads as broken only to somebody
 * who speaks it.
 */
const EXPORTED: CountedMessage = {
  oneKey: 'reports.exported.one',
  otherKey: 'reports.exported.other',
};
const FUNNEL_CLAIMS: CountedMessage = {
  oneKey: 'reports.funnel.claims.one',
  otherKey: 'reports.funnel.claims.other',
};
const OLDEST_DAYS: CountedMessage = {
  oneKey: 'reports.unsigned.days.one',
  otherKey: 'reports.unsigned.days.other',
};

/** The report table's columns. Keys as data; the words come from the reader's catalogue. */
const REPORT_COLUMN_KEYS: ReadonlyArray<{ key: string; headerKey: string; numeric?: boolean }> = [
  { key: 'date', headerKey: 'reports.visits.column.date' },
  { key: 'patient', headerKey: 'reports.visits.column.patient' },
  { key: 'provider', headerKey: 'reports.visits.column.provider' },
  { key: 'visitType', headerKey: 'reports.visits.column.visitType' },
  { key: 'status', headerKey: 'reports.visits.column.status' },
  { key: 'duration', headerKey: 'reports.visits.column.duration', numeric: true },
  { key: 'charge', headerKey: 'reports.visits.column.charge', numeric: true },
  { key: 'claim', headerKey: 'reports.visits.column.claim' },
];

/**
 * The exported file's header row, as keys.
 *
 * A person opens this in a spreadsheet and reads the top row, so it is copy and
 * follows the reader's language. The cells under it do not: they are the record
 * as the API sent it, and a translated value would be a second name for a
 * visit's type or its claim state.
 */
const CSV_COLUMN_KEYS: ReadonlyArray<{
  headerKey: string;
  value: CsvColumn<VisitReportRow>['value'];
}> = [
  { headerKey: 'reports.csv.date', value: (row) => row.date },
  { headerKey: 'reports.csv.time', value: (row) => row.time },
  { headerKey: 'reports.csv.patient', value: (row) => row.patientName },
  { headerKey: 'reports.csv.mrn', value: (row) => row.patientMrn },
  { headerKey: 'reports.csv.provider', value: (row) => row.providerName },
  { headerKey: 'reports.csv.facility', value: (row) => row.facilityName },
  { headerKey: 'reports.csv.visitType', value: (row) => row.visitType },
  { headerKey: 'reports.csv.status', value: (row) => formatEnumLabel(row.status) },
  { headerKey: 'reports.csv.minutes', value: (row) => row.durationMinutes },
  { headerKey: 'reports.csv.charges', value: (row) => row.chargeAmount.toFixed(2) },
  { headerKey: 'reports.csv.claimState', value: (row) => row.claimState },
];

function csvColumns(t: Translator): Array<CsvColumn<VisitReportRow>> {
  return CSV_COLUMN_KEYS.map((column) => ({
    header: t(column.headerKey),
    value: column.value,
  }));
}

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

  /* A provider's name is theirs; only the "everyone" row is this screen's word. */
  const providerOptions = useMemo(
    () => [
      { value: '', label: t('reports.filter.allProviders') },
      ...MOCK_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name })),
    ],
    [t]
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('reports.filter.allStatuses') },
      ...STATUS_FILTER_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    ],
    [t]
  );

  const reportColumns = useMemo<TableColumn[]>(
    () =>
      REPORT_COLUMN_KEYS.map((column) => ({
        key: column.key,
        header: t(column.headerKey),
        numeric: column.numeric,
      })),
    [t]
  );

  /* Memoised: the export command closes over it. */
  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);

  const exportReport = useCallback(() => {
    const wrote = downloadCsv(`visits-${from}-to-${to}.csv`, toCsv(csvColumns(t), rows));
    setToast(
      wrote
        ? counted(t, EXPORTED, rows.length, { from: formatDate(from), to: formatDate(to) })
        : t('reports.exportUnsupported')
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
        label: t('reports.export'),
        keywords: searchWords(t('reports.export.keywords')),
        icon: 'download',
        perform: exportReport,
      },
      {
        id: 'reports.visits.week',
        group: 'actions',
        label: t('reports.thisWeek'),
        keywords: searchWords(t('reports.thisWeek.keywords')),
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
          {t('reports.export')}
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      {/* ---- RP-01 dashboard ------------------------------------------- */}
      <AsyncBoundary
        state={dashboard}
        subject={t('reports.dashboardSubject')}
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
              {t('reports.asOf', { when: formatDateTime(data.asOf, 'prose') })}
            </p>

            <ul className="or-tiles">
              {data.tiles.map((tile) => (
                <li key={tile.id}>
                  <StatTile tile={tile} />
                </li>
              ))}
            </ul>

            <div className="or-report__pair">
              <Card title={t('reports.claims.title')}>
                <p className="or-small">{t('reports.claims.lead')}</p>
                <BarMeter
                  label={t('reports.funnel.label')}
                  rows={data.funnel.map((stage) => ({
                    id: stage.id,
                    label: stage.label,
                    value: stage.count,
                    valueText: counted(t, FUNNEL_CLAIMS, stage.count),
                    attention: stage.id === 'denied' && stage.count > 0,
                    detail:
                      stage.id === 'denied' && stage.count > 0
                        ? t('reports.funnel.needsBiller')
                        : undefined,
                  }))}
                />
                <Link className="or-link" href="/billing">
                  {t('reports.claims.link')}
                </Link>
              </Card>

              <Card title={t('reports.aging.title')}>
                <p className="or-small">{t('reports.aging.lead')}</p>
                <BarMeter
                  label={t('reports.aging.title')}
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
                caption={t('reports.unsigned.title')}
                columns={[
                  { key: 'provider', header: t('reports.unsigned.column.provider') },
                  { key: 'unsigned', header: t('reports.unsigned.column.unsigned'), numeric: true },
                  { key: 'oldest', header: t('reports.unsigned.column.oldest') },
                  { key: 'state', header: t('reports.unsigned.column.state') },
                ]}
                rows={data.unsignedByProvider.map((entry) => ({
                  id: entry.providerId,
                  provider: entry.providerName,
                  unsigned: String(entry.unsigned),
                  oldest: counted(t, OLDEST_DAYS, entry.oldestDays),
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
          label={t('reports.visits.filterLabel')}
          summary={
            report.data
              ? t('reports.visits.summary', {
                  visits: report.data.totals.visits,
                  minutes: report.data.totals.minutes,
                  charges: formatMoney(report.data.totals.charges).text,
                })
              : null
          }
          actions={
            <Button variant="ghost" size="sm" iconLeft="download" onClick={exportReport}>
              {t('reports.exportCsv')}
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
          subject={t('reports.visitsSubject')}
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
                columns={reportColumns}
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

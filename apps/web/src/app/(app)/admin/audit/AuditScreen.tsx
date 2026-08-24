'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Table, Tag, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  adminArea,
  adminBreadcrumb,
  AUDIT_ACTION_LABELS,
  PURPOSE_OF_USE_LABELS,
  STAFF_ROLE_KEYS,
  DetailList,
  Drawer,
  FilterBar,
  pluralKey,
  translateColumns,
} from '@/components/admin';
import type { AdminColumn } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import {
  AUDIT_ACTIONS,
  MOCK_STAFF_USERS,
  PURPOSES_OF_USE,
  useAdminClientOption,
  useAuditEvents,
} from '@/lib/api';
import type { AdminClient, AuditAction, AuditEvent, PurposeOfUse } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/csv';
import type { CsvColumn } from '@/lib/csv';
import { formatDateTime } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * AD-06 Audit viewer.
 *
 * The screen has one unusual design requirement: it must be unmistakably
 * read-only. There is no edit control anywhere on it, the append-only nature is
 * stated in the first thing you read, and the hash chain is rendered in the
 * detail drawer so an auditor can see that the record is tamper-evident rather
 * than being told so.
 *
 * The legacy failure this answers: audit existed, its defaults wrecked performance, and
 * exporting meant SQL. Here the filters are the query, the export is a button,
 * and "who viewed this patient in July" is one filtered question.
 */

export interface AuditScreenProps {
  client?: AdminClient;
}

/** What a translator does, for the helpers below that are not components. */
type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

const COLUMNS: readonly AdminColumn[] = [
  { key: 'when', headerKey: 'admin.audit.column.when' },
  { key: 'actor', headerKey: 'admin.audit.column.actor' },
  { key: 'action', headerKey: 'admin.audit.column.action' },
  { key: 'target', headerKey: 'admin.audit.column.target' },
  { key: 'patient', headerKey: 'admin.audit.column.patient' },
  { key: 'purpose', headerKey: 'admin.audit.column.purpose' },
  { key: 'open', headerKey: 'admin.audit.column.detail', align: 'right' },
];

/**
 * The export's header row, in the reader's language.
 *
 * A function rather than a constant because the words depend on who is reading,
 * and because `lib/csv` asks for the same wording as the on-screen column: a
 * row that reads one way on screen has to read the same way in a spreadsheet,
 * including when the screen is not in English.
 */
function csvColumns(t: Translate): Array<CsvColumn<AuditEvent>> {
  return [
    { header: t('admin.audit.csv.sequence'), value: (event) => event.sequence },
    {
      header: t('admin.audit.csv.when'),
      value: (event) => formatDateTime(event.occurredAt, 'iso'),
    },
    { header: t('admin.audit.csv.actor'), value: (event) => event.actorName },
    {
      header: t('admin.audit.csv.role'),
      value: (event) => t(STAFF_ROLE_KEYS[event.actorRole].labelKey),
    },
    {
      header: t('admin.audit.csv.action'),
      value: (event) => t(AUDIT_ACTION_LABELS[event.action].labelKey),
    },
    {
      header: t('admin.audit.csv.target'),
      value: (event) => `${event.targetType}: ${event.targetLabel}`,
    },
    { header: t('admin.audit.csv.patientMrn'), value: (event) => event.patientMrn ?? '' },
    {
      header: t('admin.audit.csv.purpose'),
      value: (event) => t(PURPOSE_OF_USE_LABELS[event.purposeOfUse].labelKey),
    },
    {
      header: t('admin.audit.csv.breakglass'),
      value: (event) => (event.breakglass ? t('admin.audit.csv.yes') : t('admin.audit.csv.no')),
    },
    {
      header: t('admin.audit.csv.breakglassReason'),
      value: (event) => event.breakglassReason ?? '',
    },
    { header: t('admin.audit.csv.sourceAddress'), value: (event) => event.sourceIp },
    { header: t('admin.audit.csv.hash'), value: (event) => event.hash },
  ];
}

const EVENT_COUNT = {
  oneKey: 'admin.audit.summary.one',
  otherKey: 'admin.audit.summary.other',
};

const EVENT_COUNT_BREAKGLASS = {
  oneKey: 'admin.audit.summaryBreakglass.one',
  otherKey: 'admin.audit.summaryBreakglass.other',
};

/**
 * The line under the filter bar: "42 events, 3 breakglass".
 *
 * Breakglass is only named when there is some, so the ordinary case reads as
 * one plain count rather than a count plus a reassuring zero. Two whole
 * messages rather than one with a clause appended, because the clause is not
 * appendable in every language.
 */
function filterSummary(t: Translate, locale: string, total: number, breakglassCount: number) {
  if (breakglassCount === 0) {
    return t(pluralKey(EVENT_COUNT, total, locale), { count: total });
  }
  return t(pluralKey(EVENT_COUNT_BREAKGLASS, total, locale), {
    count: total,
    breakglass: breakglassCount,
  });
}

/** The patient cell: an audit event does not always have a chart context. */
function patientCell(t: Translate, event: AuditEvent): ReactElement {
  if (!event.patientMrn) {
    return <span className="or-caption">{t('admin.audit.noChartContext')}</span>;
  }
  return (
    <span className="or-cell-stack">
      <span className="or-small">{event.patientName}</span>
      <span className="or-caption or-mono">{event.patientMrn}</span>
    </span>
  );
}

/** Breakglass outranks the purpose of use: it is the thing an auditor scans for. */
function purposeCell(t: Translate, event: AuditEvent): ReactElement {
  if (event.breakglass) {
    return <Badge tone="danger">{t('admin.audit.breakglass')}</Badge>;
  }
  return <Tag>{t(PURPOSE_OF_USE_LABELS[event.purposeOfUse].labelKey)}</Tag>;
}

function auditRow(
  t: Translate,
  event: AuditEvent,
  onOpen: (id: string) => void
): Record<string, ReactNode> {
  return {
    id: event.id,
    when: (
      <span className="or-cell-stack">
        <span className="or-small">{formatDateTime(event.occurredAt, 'dense')}</span>
        <span className="or-caption or-mono">#{event.sequence}</span>
      </span>
    ),
    actor: (
      <span className="or-cell-stack">
        <span className="or-body">{event.actorName}</span>
        <span className="or-caption">{t(STAFF_ROLE_KEYS[event.actorRole].labelKey)}</span>
      </span>
    ),
    action: <span className="or-small">{t(AUDIT_ACTION_LABELS[event.action].labelKey)}</span>,
    target: (
      <span className="or-cell-stack">
        <span className="or-small">{event.targetLabel}</span>
        <span className="or-caption">{event.targetType}</span>
      </span>
    ),
    patient: patientCell(t, event),
    purpose: purposeCell(t, event),
    open: (
      <Button size="sm" variant="ghost" onClick={() => onOpen(event.id)}>
        {t('admin.audit.openEvent', { sequence: event.sequence })}
      </Button>
    ),
  };
}

/**
 * The drawer body: the full event, plus the hash chain that makes it trustworthy.
 *
 * Cards here pass `headingLevel={3}`. The drawer renders its own title as the h2,
 * so a card inside it is a level below; leaving the Card default would put an h2
 * inside an h2 and flatten the outline a screen reader moves through.
 */
function AuditEventDetail({ event }: Readonly<{ event: AuditEvent }>): ReactElement {
  const t = useTranslator();

  return (
    <div className="or-stack">
      {event.breakglass ? (
        <Card className="or-notice" data-tone="critical">
          <p className="or-body">
            <strong>{t('admin.audit.detail.breakglassTitle')}</strong>{' '}
            {t('admin.audit.detail.breakglassReason', { reason: event.breakglassReason ?? '' })}
          </p>
        </Card>
      ) : null}

      <DetailList
        columns={2}
        items={[
          { label: t('admin.audit.detail.actor'), value: event.actorName },
          {
            label: t('admin.audit.detail.role'),
            value: t(STAFF_ROLE_KEYS[event.actorRole].labelKey),
          },
          {
            label: t('admin.audit.detail.target'),
            value: `${event.targetType}: ${event.targetLabel}`,
          },
          {
            label: t('admin.audit.detail.purpose'),
            value: t(PURPOSE_OF_USE_LABELS[event.purposeOfUse].labelKey),
          },
          {
            label: t('admin.audit.detail.patient'),
            value: event.patientName ?? t('admin.audit.noChartContext'),
          },
          {
            label: t('admin.audit.detail.mrn'),
            value: event.patientMrn ?? t('admin.audit.noChartContext'),
            mono: true,
          },
          { label: t('admin.audit.detail.sourceAddress'), value: event.sourceIp, mono: true },
          { label: t('admin.audit.detail.requestId'), value: event.requestId, mono: true },
          ...event.detail.map((entry) => ({ label: entry.label, value: entry.value })),
        ]}
      />

      <Card tone="bone" headingLevel={3} title={t('admin.audit.hash.title')}>
        <p className="or-small">{t('admin.audit.hash.explanation')}</p>
        <DetailList
          items={[
            { label: t('admin.audit.hash.position'), value: `#${event.sequence}`, mono: true },
            { label: t('admin.audit.hash.previous'), value: event.previousHash, mono: true },
            { label: t('admin.audit.hash.current'), value: event.hash, mono: true },
            {
              label: t('admin.audit.hash.integrity'),
              value: event.chainVerified
                ? t('admin.audit.hash.verified')
                : t('admin.audit.hash.unverified'),
            },
          ]}
        />
      </Card>
    </div>
  );
}

export function AuditScreen({ client }: Readonly<AuditScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);

  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [purposeOfUse, setPurposeOfUse] = useState<PurposeOfUse | ''>('');
  const [patientMrn, setPatientMrn] = useState('');
  const [from, setFrom] = useState('2026-08-01');
  const [to, setTo] = useState('2026-08-31');
  const [breakglassOnly, setBreakglassOnly] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const events = useAuditEvents(
    {
      actorId: actorId || undefined,
      action: action || undefined,
      purposeOfUse: purposeOfUse || undefined,
      patientMrn: patientMrn || undefined,
      breakglassOnly: breakglassOnly || undefined,
      from: from || undefined,
      to: to || undefined,
    },
    options
  );

  /* Memoised because the export callback depends on it: a new array identity
     every render would rebuild the command list every render too. */
  const rows = useMemo(() => events.data?.data ?? [], [events.data]);

  const exportRows = useCallback(() => {
    const csv = toCsv(csvColumns(t), rows);
    const wrote = downloadCsv(`audit-${from}-to-${to}.csv`, csv);
    setToast(
      wrote
        ? t('admin.audit.exportedToast', { count: rows.length })
        : t('admin.audit.exportUnavailableToast')
    );
  }, [rows, from, to, t]);

  const showBreakglass = useCallback(() => {
    setBreakglassOnly(true);
    setActorId('');
    setAction('');
    setPurposeOfUse('');
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.audit.export',
        group: 'actions',
        label: t('admin.audit.command.export'),
        keywords: searchWords(t('admin.audit.command.export.keywords')),
        icon: 'download',
        perform: exportRows,
      },
      {
        id: 'admin.audit.breakglass',
        group: 'actions',
        label: t('admin.audit.command.breakglass'),
        keywords: searchWords(t('admin.audit.command.breakglass.keywords')),
        icon: 'shield-alert',
        perform: showBreakglass,
      },
    ],
    [exportRows, showBreakglass, t]
  );

  const actorOptions = [
    { value: '', label: t('admin.audit.filter.anyone') },
    ...MOCK_STAFF_USERS.map((user) => ({ value: user.id, label: user.name })),
  ];
  const actionOptions = [
    { value: '', label: t('admin.audit.filter.anyAction') },
    ...AUDIT_ACTIONS.map((entry) => ({
      value: entry,
      label: t(AUDIT_ACTION_LABELS[entry].labelKey),
    })),
  ];
  const purposeOptions = [
    { value: '', label: t('admin.audit.filter.anyPurpose') },
    ...PURPOSES_OF_USE.map((purpose) => ({
      value: purpose,
      label: t(PURPOSE_OF_USE_LABELS[purpose].labelKey),
    })),
  ];

  const selected = rows.find((event) => event.id === openId) ?? null;
  const breakglassCount = rows.filter((event) => event.breakglass).length;

  return (
    <AppShell
      title={t(adminArea('audit').labelKey)}
      description={t('admin.audit.description')}
      breadcrumb={adminBreadcrumb(t, 'audit')}
      actions={
        <Button variant="secondary" iconLeft="download" onClick={exportRows}>
          {t('admin.audit.export')}
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Card className="or-notice" data-tone="read-only">
        <p className="or-body">
          <strong>{t('admin.audit.readOnly.title')}</strong> {t('admin.audit.readOnly.body')}
        </p>
        <div className="or-cell-chips">
          <Badge tone="success">{t('admin.audit.chip.hashVerified')}</Badge>
          <Tag>{t('admin.audit.chip.readOnly')}</Tag>
          <Tag>{t('admin.audit.chip.retention')}</Tag>
        </div>
      </Card>

      <FilterBar
        label={t('admin.audit.filter.label')}
        summary={events.data ? filterSummary(t, t.locale, rows.length, breakglassCount) : null}
        actions={
          <Button variant="ghost" size="sm" iconLeft="download" onClick={exportRows}>
            {t('admin.audit.exportCsv')}
          </Button>
        }
      >
        <Input
          label={t('admin.audit.filter.from')}
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          label={t('admin.audit.filter.to')}
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <Select
          label={t('admin.audit.filter.actor')}
          options={actorOptions}
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
        />
        <Select
          label={t('admin.audit.filter.action')}
          options={actionOptions}
          value={action}
          onChange={(event) => setAction(event.target.value as AuditAction | '')}
        />
        <Select
          label={t('admin.audit.filter.purpose')}
          options={purposeOptions}
          value={purposeOfUse}
          onChange={(event) => setPurposeOfUse(event.target.value as PurposeOfUse | '')}
        />
        <Input
          label={t('admin.audit.filter.mrn')}
          mono
          /* An MRN pattern rather than words: it shows the shape of the
             identifier, and translating it would be translating a format. */
          placeholder="OR-100482"
          value={patientMrn}
          onChange={(event) => setPatientMrn(event.target.value)}
        />
        <Checkbox
          label={t('admin.audit.filter.breakglassOnly')}
          checked={breakglassOnly}
          onChange={() => setBreakglassOnly((value) => !value)}
        />
      </FilterBar>

      <AsyncBoundary
        state={events}
        subject={t('admin.audit.subject')}
        isEmpty={isEmptyList}
        loadingRows={10}
        empty={{
          title: t('admin.audit.empty.title'),
          message: t('admin.audit.empty.message'),
          icon: 'scroll-text',
          action: (
            <Button
              variant="secondary"
              onClick={() => {
                setActorId('');
                setAction('');
                setPurposeOfUse('');
                setPatientMrn('');
                setBreakglassOnly(false);
              }}
            >
              {t('admin.audit.empty.action')}
            </Button>
          ),
        }}
      >
        {() => (
          <Table
            caption={t('admin.audit.tableCaption')}
            columns={translateColumns(t, COLUMNS)}
            rows={rows.map((event) => auditRow(t, event, setOpenId))}
          />
        )}
      </AsyncBoundary>

      <Drawer
        open={selected !== null}
        title={selected ? t(AUDIT_ACTION_LABELS[selected.action].labelKey) : ''}
        description={selected ? formatDateTime(selected.occurredAt, 'prose') : undefined}
        width={720}
        onClose={() => setOpenId(null)}
        meta={
          selected ? (
            <span className="or-cell-chips">
              <Tag mono>#{selected.sequence}</Tag>
              {selected.breakglass ? (
                <Badge tone="danger">{t('admin.audit.breakglass')}</Badge>
              ) : null}
              <Badge tone="success">{t('admin.audit.chip.readOnly')}</Badge>
            </span>
          ) : null
        }
        footer={
          <Button variant="ghost" onClick={() => setOpenId(null)}>
            {t('admin.action.close')}
          </Button>
        }
      >
        {selected ? <AuditEventDetail event={selected} /> : null}
      </Drawer>

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="info" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}

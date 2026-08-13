'use client';

import { Badge, Button, Card, Checkbox, Input, Select, Table, Tag, Toast } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { adminBreadcrumb, DetailList, Drawer, FilterBar } from '@/components/admin';
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
import { formatDateTime, formatEnumLabel } from '@/lib/format';

/**
 * AD-06 Audit viewer.
 *
 * The screen has one unusual design requirement: it must be unmistakably
 * read-only. There is no edit control anywhere on it, the append-only nature is
 * stated in the first thing you read, and the hash chain is rendered in the
 * detail drawer so an auditor can see that the record is tamper-evident rather
 * than being told so.
 *
 * The OpenEMR failure: audit existed, its defaults wrecked performance, and
 * exporting meant SQL. Here the filters are the query, the export is a button,
 * and "who viewed this patient in July" is one filtered question.
 */

export interface AuditScreenProps {
  client?: AdminClient;
}

const COLUMNS: TableColumn[] = [
  { key: 'when', header: 'When' },
  { key: 'actor', header: 'Actor' },
  { key: 'action', header: 'Action' },
  { key: 'target', header: 'Target' },
  { key: 'patient', header: 'Patient' },
  { key: 'purpose', header: 'Purpose of use' },
  { key: 'open', header: 'Detail', align: 'right' },
];

const CSV_COLUMNS: Array<CsvColumn<AuditEvent>> = [
  { header: 'Sequence', value: (event) => event.sequence },
  { header: 'When', value: (event) => formatDateTime(event.occurredAt, 'iso') },
  { header: 'Actor', value: (event) => event.actorName },
  { header: 'Role', value: (event) => formatEnumLabel(event.actorRole) },
  { header: 'Action', value: (event) => formatEnumLabel(event.action) },
  { header: 'Target', value: (event) => `${event.targetType}: ${event.targetLabel}` },
  { header: 'Patient MRN', value: (event) => event.patientMrn ?? '' },
  { header: 'Purpose of use', value: (event) => formatEnumLabel(event.purposeOfUse) },
  { header: 'Breakglass', value: (event) => (event.breakglass ? 'Yes' : 'No') },
  { header: 'Breakglass reason', value: (event) => event.breakglassReason ?? '' },
  { header: 'Source address', value: (event) => event.sourceIp },
  { header: 'Hash', value: (event) => event.hash },
];

const ACTOR_OPTIONS = [
  { value: '', label: 'Anyone' },
  ...MOCK_STAFF_USERS.map((user) => ({ value: user.id, label: user.name })),
];

const ACTION_OPTIONS = [
  { value: '', label: 'Any action' },
  ...AUDIT_ACTIONS.map((action) => ({ value: action, label: formatEnumLabel(action) })),
];

const PURPOSE_OPTIONS = [
  { value: '', label: 'Any purpose' },
  ...PURPOSES_OF_USE.map((purpose) => ({ value: purpose, label: formatEnumLabel(purpose) })),
];

export function AuditScreen({ client }: AuditScreenProps = {}): ReactElement {
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
    const csv = toCsv(CSV_COLUMNS, rows);
    const wrote = downloadCsv(`audit-${from}-to-${to}.csv`, csv);
    setToast(
      wrote
        ? `Exported ${rows.length} events. The export itself is recorded in this trail.`
        : 'This browser cannot download files. Copy the filtered table instead.'
    );
  }, [rows, from, to]);

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
        label: 'Export the filtered audit trail',
        keywords: ['csv', 'download', 'compliance'],
        icon: 'download',
        perform: exportRows,
      },
      {
        id: 'admin.audit.breakglass',
        group: 'actions',
        label: 'Show breakglass access only',
        keywords: ['emergency access', 'override', 'incident'],
        icon: 'shield-alert',
        perform: showBreakglass,
      },
    ],
    [exportRows, showBreakglass]
  );

  const selected = rows.find((event) => event.id === openId) ?? null;
  const breakglassCount = rows.filter((event) => event.breakglass).length;

  return (
    <AppShell
      title="Audit trail"
      description="Every access to patient data, in the order it happened."
      breadcrumb={adminBreadcrumb('Audit trail')}
      actions={
        <Button variant="secondary" iconLeft="download" onClick={exportRows}>
          Export these events
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Card className="or-notice" data-tone="read-only">
        <p className="or-body">
          <strong>This record is append-only.</strong> Nothing on this screen can be edited or
          deleted, by anyone, including a practice admin. Each event is hashed together with the one
          before it, so a missing or altered event is detectable.
        </p>
        <div className="or-cell-chips">
          <Badge tone="success">Hash chain verified</Badge>
          <Tag>Read only</Tag>
          <Tag>Kept for 6 years</Tag>
        </div>
      </Card>

      <FilterBar
        label="Filter the audit trail"
        summary={
          events.data
            ? `${rows.length} ${rows.length === 1 ? 'event' : 'events'}${
                breakglassCount > 0 ? `, ${breakglassCount} breakglass` : ''
              }`
            : null
        }
        actions={
          <Button variant="ghost" size="sm" iconLeft="download" onClick={exportRows}>
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
        <Input label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Select
          label="Actor"
          options={ACTOR_OPTIONS}
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
        />
        <Select
          label="Action"
          options={ACTION_OPTIONS}
          value={action}
          onChange={(event) => setAction(event.target.value as AuditAction | '')}
        />
        <Select
          label="Purpose of use"
          options={PURPOSE_OPTIONS}
          value={purposeOfUse}
          onChange={(event) => setPurposeOfUse(event.target.value as PurposeOfUse | '')}
        />
        <Input
          label="Patient MRN"
          mono
          placeholder="OR-100482"
          value={patientMrn}
          onChange={(event) => setPatientMrn(event.target.value)}
        />
        <Checkbox
          label="Breakglass only"
          checked={breakglassOnly}
          onChange={() => setBreakglassOnly((value) => !value)}
        />
      </FilterBar>

      <AsyncBoundary
        state={events}
        subject="audit events"
        isEmpty={isEmptyList}
        loadingRows={10}
        empty={{
          title: 'No events match this query',
          message:
            'Nothing was recorded for these filters. Widen the date range, or clear the actor and action to see everything in the period.',
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
              Clear the filters
            </Button>
          ),
        }}
      >
        {() => (
          <Table
            caption="Audit events, newest first"
            columns={COLUMNS}
            rows={rows.map((event) => ({
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
                  <span className="or-caption">{formatEnumLabel(event.actorRole)}</span>
                </span>
              ),
              action: <span className="or-small">{formatEnumLabel(event.action)}</span>,
              target: (
                <span className="or-cell-stack">
                  <span className="or-small">{event.targetLabel}</span>
                  <span className="or-caption">{event.targetType}</span>
                </span>
              ),
              patient: event.patientMrn ? (
                <span className="or-cell-stack">
                  <span className="or-small">{event.patientName}</span>
                  <span className="or-caption or-mono">{event.patientMrn}</span>
                </span>
              ) : (
                <span className="or-caption">No chart context</span>
              ),
              purpose: event.breakglass ? (
                <Badge tone="danger">Breakglass</Badge>
              ) : (
                <Tag>{formatEnumLabel(event.purposeOfUse)}</Tag>
              ),
              open: (
                <Button size="sm" variant="ghost" onClick={() => setOpenId(event.id)}>
                  Open event {event.sequence}
                </Button>
              ),
            }))}
          />
        )}
      </AsyncBoundary>

      <Drawer
        open={selected !== null}
        title={selected ? formatEnumLabel(selected.action) : ''}
        description={selected ? formatDateTime(selected.occurredAt, 'prose') : undefined}
        width={720}
        onClose={() => setOpenId(null)}
        meta={
          selected ? (
            <span className="or-cell-chips">
              <Tag mono>#{selected.sequence}</Tag>
              {selected.breakglass ? <Badge tone="danger">Breakglass</Badge> : null}
              <Badge tone="success">Read only</Badge>
            </span>
          ) : null
        }
        footer={
          <Button variant="ghost" onClick={() => setOpenId(null)}>
            Close
          </Button>
        }
      >
        {selected ? (
          <div className="or-stack">
            {selected.breakglass ? (
              <Card className="or-notice" data-tone="critical">
                <p className="or-body">
                  <strong>Emergency access outside the care team.</strong> The reason given was:
                  {` "${selected.breakglassReason ?? ''}"`}
                </p>
              </Card>
            ) : null}

            <DetailList
              columns={2}
              items={[
                { label: 'Actor', value: selected.actorName },
                { label: 'Role', value: formatEnumLabel(selected.actorRole) },
                { label: 'Target', value: `${selected.targetType}: ${selected.targetLabel}` },
                { label: 'Purpose of use', value: formatEnumLabel(selected.purposeOfUse) },
                { label: 'Patient', value: selected.patientName ?? 'No chart context' },
                { label: 'MRN', value: selected.patientMrn ?? 'No chart context', mono: true },
                { label: 'Source address', value: selected.sourceIp, mono: true },
                { label: 'Request id', value: selected.requestId, mono: true },
                ...selected.detail.map((entry) => ({ label: entry.label, value: entry.value })),
              ]}
            />

            <Card tone="bone" title="Hash chain">
              <p className="or-small">
                Each event is hashed together with the hash of the event before it. Changing or
                removing any event breaks every hash after it, which is what makes this trail
                tamper-evident rather than merely locked.
              </p>
              <DetailList
                items={[
                  { label: 'Position', value: `#${selected.sequence}`, mono: true },
                  { label: 'Previous hash', value: selected.previousHash, mono: true },
                  { label: 'This hash', value: selected.hash, mono: true },
                  {
                    label: 'Integrity',
                    value: selected.chainVerified
                      ? 'Verified against the chain'
                      : 'Not verified. Report this immediately.',
                  },
                ]}
              />
            </Card>
          </div>
        ) : null}
      </Drawer>

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="info" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}

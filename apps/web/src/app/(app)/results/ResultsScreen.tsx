'use client';

import { formatCount, plural } from '@openrunic/i18n';
import type { Interpolations, Translator } from '@openrunic/i18n';
import { Button, Card, Modal, Select, Toast } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { ResultList, ResultReading, SignNoteModal } from '@/components/results';
import type { SignedNote } from '@/components/results';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { isBulkSignable, MOCK_NOW, mockPatientById, useResults } from '@/lib/api';
import type { Assignment, ResultFlag, ResultReport, WorklistClient } from '@/lib/api';
import { formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * OR-04 Results inbox: the sign-off queue, abnormal first.
 *
 * The queue is designed to shrink. Every row carries the value that earned its
 * flag and the sign-off action, the reading pane shows each value against its
 * reference range in words, and a batch action clears the unremarkable ones.
 * Critical values are never in that batch: someone reads them.
 *
 * Legacy "pending review" screens flagged abnormal results and then offered nothing to
 * do about them, which is why results piled up there. Here signing, signing
 * with a note, and ordering a follow-up all happen without leaving the screen.
 *
 * A panel name, a performer and an analyte are the laboratory's words and are
 * rendered as they arrived. Every sentence built around them is a catalogue
 * key, including the ones that name a count, which carry a form per count
 * rather than an English `s`.
 */

/** Abnormal first: this is a triage queue, not a chronological log. */
const FLAG_ORDER: Record<ResultFlag, number> = { CRITICAL: 0, ABNORMAL: 1, NORMAL: 2 };

/**
 * Who owns the queue being read, as catalogue keys. `''` is the absence of a
 * filter rather than a third assignment, which is why it is not in `ASSIGNMENTS`.
 */
const ASSIGNMENT_FILTERS: readonly { value: Assignment | ''; labelKey: string }[] = [
  { value: 'ME', labelKey: 'results.list.assignment.mine' },
  { value: 'TEAM', labelKey: 'results.list.assignment.team' },
  { value: '', labelKey: 'results.list.assignment.everyone' },
];

/**
 * A message that has a form per count, as the pair of keys that hold them.
 *
 * Both forms are looked up and `plural` picks between them with the reader's
 * own rules rather than `count === 1`: English has two forms, and a fork
 * translating into a language with four would otherwise get a sentence that
 * reads as broken only to somebody who speaks it.
 */
interface CountedMessage {
  readonly oneKey: string;
  readonly otherKey: string;
}

const BATCH_ACTION: CountedMessage = {
  oneKey: 'results.bulk.actionOne',
  otherKey: 'results.bulk.actionOther',
};

const BATCH_BODY: CountedMessage = {
  oneKey: 'results.bulk.descriptionOne',
  otherKey: 'results.bulk.descriptionOther',
};

const BATCH_CONFIRM: CountedMessage = {
  oneKey: 'results.bulk.confirmOne',
  otherKey: 'results.bulk.confirmOther',
};

const BATCH_SIGNED: CountedMessage = {
  oneKey: 'results.bulk.signedOne',
  otherKey: 'results.bulk.signedOther',
};

/** The form the reader's language picks for this count. */
function counted(
  t: Translator,
  message: CountedMessage,
  count: number,
  values: Interpolations = {}
): string {
  const filled = { ...values, count: formatCount(count, t.locale) };
  return plural(
    { one: t(message.oneKey, filled), other: t(message.otherKey, filled) },
    count,
    t.locale
  );
}

/**
 * The synonyms a tired person types instead of the label: one comma-separated
 * message per command, the way the navigation table carries its own. The lookup
 * stays at the call site so the key is a literal the drift test can find.
 */
function searchWords(words: string): string[] {
  return words
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

interface Signing {
  report: ResultReport;
  withNote: boolean;
}

export interface ResultsScreenProps {
  /** Injectable for tests. Defaults to the app's worklist client. */
  client?: WorklistClient;
  /** Fixed "now", so a signature timestamp is deterministic. */
  now?: string;
}

export function ResultsScreen({
  client,
  now = MOCK_NOW,
}: Readonly<ResultsScreenProps>): ReactElement {
  const t = useTranslator();
  const [assignment, setAssignment] = useState<Assignment | ''>('ME');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signed, setSigned] = useState<Record<string, SignedNote>>({});
  const [signing, setSigning] = useState<Signing | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  const results = useResults(assignment ? { assignedTo: assignment } : {}, { client });

  const assignmentFilters = useMemo<SelectOption[]>(
    () => ASSIGNMENT_FILTERS.map((filter) => ({ value: filter.value, label: t(filter.labelKey) })),
    [t]
  );

  const reports = useMemo(() => {
    const rows = results.data?.data ?? [];
    return [...rows].sort(
      (a, b) => FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] || b.reportedAt.localeCompare(a.reportedAt)
    );
  }, [results.data]);

  const openCount = reports.filter(
    (report) => report.status === 'UNREVIEWED' && !signed[report.id]
  ).length;
  const bulkCandidates = reports.filter((report) => isBulkSignable(report) && !signed[report.id]);

  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  const signOne = useCallback(
    (report: ResultReport, note: string | null) => {
      setSigned((previous) => ({ ...previous, [report.id]: { at: now, note } }));
      setSigning(null);
      setToast({
        title: t('results.signed.title', { panel: report.panel }),
        message: note ? t('results.signed.messageWithNote') : t('results.signed.message'),
      });
    },
    [t, now]
  );

  const signBulk = useCallback(() => {
    const stamped: Record<string, SignedNote> = {};
    for (const report of bulkCandidates) stamped[report.id] = { at: now, note: null };
    setSigned((previous) => ({ ...previous, ...stamped }));
    setBulkOpen(false);
    setToast({
      title: counted(t, BATCH_SIGNED, bulkCandidates.length),
      message: t('results.bulk.message'),
    });
  }, [t, bulkCandidates, now]);

  const requestSign = useCallback((report: ResultReport | null, withNote: boolean) => {
    if (!report) return;
    setSelectedId(report.id);
    setSigning({ report, withNote });
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'results.sign',
        group: 'actions',
        label: t('results.command.sign'),
        keywords: searchWords(t('results.command.signKeywords')),
        icon: 'pen-line',
        perform: () => requestSign(selected, false),
      },
      {
        id: 'results.sign-note',
        group: 'actions',
        label: t('results.command.signNote'),
        keywords: searchWords(t('results.command.signNoteKeywords')),
        icon: 'message-square',
        perform: () => requestSign(selected, true),
      },
      {
        id: 'results.bulk-sign',
        group: 'actions',
        label: t('results.command.bulkSign'),
        keywords: searchWords(t('results.command.bulkSignKeywords')),
        icon: 'check-check',
        perform: () => setBulkOpen(bulkCandidates.length > 0),
      },
      {
        id: 'results.mine',
        group: 'actions',
        label: t('results.command.mine'),
        keywords: searchWords(t('results.command.mineKeywords')),
        icon: 'user-round',
        perform: () => setAssignment('ME'),
      },
      {
        id: 'results.team',
        group: 'actions',
        label: t('results.command.team'),
        keywords: searchWords(t('results.command.teamKeywords')),
        icon: 'users',
        perform: () => setAssignment('TEAM'),
      },
    ],
    [t, selected, bulkCandidates.length, requestSign]
  );

  const selectedPatient = selected ? mockPatientById(selected.patientId) : undefined;
  const selectedPatientName = selectedPatient
    ? formatName(selectedPatient.name, 'full')
    : t('results.thisPatient');

  return (
    <AppShell
      title={t('results.list.title')}
      description={t('results.list.description')}
      actions={
        <Button
          variant="secondary"
          iconLeft="check-check"
          onClick={() => setBulkOpen(bulkCandidates.length > 0)}
        >
          {bulkCandidates.length > 0
            ? counted(t, BATCH_ACTION, bulkCandidates.length)
            : t('results.bulk.actionNone')}
        </Button>
      }
      topBarActions={
        <Select
          label={t('results.list.assignment')}
          options={assignmentFilters}
          value={assignment}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setAssignment(event.target.value as Assignment | '')
          }
        />
      }
      rightRail={
        <Card
          tone="cream"
          overline={t('results.queue.overline')}
          title={t('results.queue.waiting', { count: formatCount(openCount, t.locale) })}
        >
          <p className="or-small">{t('results.queue.note')}</p>
          <p className="or-small or-muted">{t('results.queue.release')}</p>
        </Card>
      }
    >
      <ScreenCommands commands={commands} />
      <AsyncBoundary
        state={results}
        subject={t('results.list.subject')}
        isEmpty={isEmptyList}
        loadingRows={5}
        empty={{
          title: t('results.list.empty.title'),
          message: t('results.list.empty.message'),
          icon: 'flask-conical',
          action: (
            <Button href="/inbox" iconLeft="inbox">
              {t('results.list.empty.action')}
            </Button>
          ),
        }}
      >
        {() => (
          <div className="or-results">
            <Card
              tone="cream"
              overline={t('results.queue.overline')}
              title={t('results.queue.title')}
              className="or-results__queue"
            >
              <ResultList
                reports={reports}
                selectedId={selected?.id ?? null}
                signedIds={Object.keys(signed)}
                onSelect={setSelectedId}
                onSign={(id) => {
                  const report = reports.find((candidate) => candidate.id === id) ?? null;
                  requestSign(report, false);
                }}
              />
            </Card>

            {selected ? (
              <ResultReading
                report={selected}
                signed={signed[selected.id] ?? null}
                now={now}
                onSign={() => requestSign(selected, false)}
                onSignWithNote={() => requestSign(selected, true)}
              />
            ) : null}
          </div>
        )}
      </AsyncBoundary>

      <Modal
        open={signing !== null && !signing.withNote}
        title={t('results.sign.title')}
        description={
          signing
            ? t('results.sign.description', {
                panel: signing.report.panel,
                patient: selectedPatientName,
              })
            : ''
        }
        onClose={() => setSigning(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSigning(null)}>
              {t('results.sign.cancel')}
            </Button>
            <Button
              iconLeft="pen-line"
              onClick={() => (signing ? signOne(signing.report, null) : undefined)}
            >
              {t('results.sign.confirm')}
            </Button>
          </>
        }
      />

      <SignNoteModal
        open={signing?.withNote === true}
        subject={signing?.report.panel ?? ''}
        patientName={selectedPatientName}
        onCancel={() => setSigning(null)}
        onConfirm={(note) => (signing ? signOne(signing.report, note || null) : undefined)}
      />

      <Modal
        open={bulkOpen}
        title={t('results.bulk.title')}
        description={counted(t, BATCH_BODY, bulkCandidates.length)}
        onClose={() => setBulkOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              {t('results.sign.cancel')}
            </Button>
            <Button iconLeft="check-check" onClick={signBulk}>
              {counted(t, BATCH_CONFIRM, bulkCandidates.length)}
            </Button>
          </>
        }
      >
        <ul className="or-plainlist or-small">
          {bulkCandidates.map((report) => (
            <li key={report.id}>{report.panel}</li>
          ))}
        </ul>
      </Modal>

      {toast ? (
        <div className="or-toast-dock">
          <Toast
            tone="success"
            title={toast.title}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

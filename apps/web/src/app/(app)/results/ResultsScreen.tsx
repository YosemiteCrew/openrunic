'use client';

import { Button, Card, Modal, Select } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { ResultList, ResultReading, SignNoteModal } from '@/components/results';
import type { SignedNote } from '@/components/results';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, Toast, isEmptyList } from '@/components/state';
import {
  isBulkSignable,
  useMutation,
  usePatientNames,
  useProviderNames,
  useResultAnalytes,
  useResults,
  worklist,
} from '@/lib/api';
import type { Assignment, ResultFlag, ResultPage, ResultReport, WorklistClient } from '@/lib/api';
import { clinicNow } from '@/lib/api/chart';
import { formatName } from '@/lib/format';
import { formatCount } from '@openrunic/i18n';

import { counted, searchWords } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
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
 * The rows on this page, when the queue matched more than one page of them.
 *
 * The same statement the orders ledger makes and for the same reason: this
 * screen has no pager, so a total above a full list is a number about the
 * clinic rather than about the list, and 60 over 25 rows reads exactly like 60
 * over 22 (#539).
 */
const RESULT_WINDOW: CountedMessage = {
  oneKey: 'results.list.windowOne',
  otherKey: 'results.list.windowOther',
};

const RESULT_COUNT: CountedMessage = {
  oneKey: 'results.list.countOne',
  otherKey: 'results.list.countOther',
};

/** The rows the queue refused, because `SERVICE_REQUEST_CATEGORIES` is wider than OR-01's three. */
const NOT_SHOWN: CountedMessage = {
  oneKey: 'results.list.notShownOne',
  otherKey: 'results.list.notShownOther',
};

/**
 * The window this screen asks for, clamped by the route to `MAX_PAGE_SIZE`.
 *
 * The same size the orders ledger asks for, and for the same reason: a queue
 * under a couple of hundred rows is one a clinician finishes, and re-fetching
 * while they scan it flashes a skeleton over rows they were already reading.
 */
const PAGE_SIZE = 100;

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

/** The part of a batch that was not recorded, and so is still in the queue. */
const BATCH_UNSIGNED: CountedMessage = {
  oneKey: 'results.bulk.unsignedOne',
  otherKey: 'results.bulk.unsignedOther',
};

interface Notice {
  tone: 'success' | 'danger';
  title: string;
  message: string;
}

interface Signing {
  report: ResultReport;
  withNote: boolean;
}

/**
 * What the rows on screen are a count of, and what is absent from them.
 *
 * Two separate facts, deliberately not one sentence. A row absent because it is
 * on a page this screen cannot reach and a row absent because the queue has no
 * word for its category have different remedies, and a reader who cannot tell
 * them apart cannot act on either.
 */
function QueueStatement({ page }: Readonly<{ page: ResultPage }>): ReactElement {
  const t = useTranslator();
  /* The rows the route put on this page, the refused ones included, so the two
     sum to the window without reading `pageSize` - the route's clamp, not
     necessarily what it applied. */
  const windowed = page.data.length + page.refused;

  return (
    <>
      <p className="or-caption">
        {windowed < page.page.total
          ? counted(t, RESULT_WINDOW, windowed, {
              total: formatCount(page.page.total, t.locale),
            })
          : counted(t, RESULT_COUNT, page.page.total)}
      </p>
      {page.refused > 0 ? (
        <p className="or-caption">
          <strong>{counted(t, NOT_SHOWN, page.refused)}</strong>
        </p>
      ) : null}
    </>
  );
}

export interface ResultsScreenProps {
  /** Injectable for tests. Defaults to the app's worklist client. */
  client?: WorklistClient;
  /**
   * Fixed "now", so a signature timestamp is deterministic. Defaults to the
   * clinic's clock: the fixtures' instant in the demo build, the wall clock
   * against the API.
   */
  now?: string;
}

/**
 * The verbs this screen offers the command palette.
 *
 * A hook rather than a block inside the screen, because it is the one part of
 * `ResultsScreen` with no markup in it.
 */
function useResultCommands({
  selected,
  bulkCandidates,
  notes,
  requestSign,
  setAssignment,
  setBulkOpen,
}: Readonly<{
  selected: ResultReport | null;
  bulkCandidates: readonly ResultReport[];
  /** Whether a sign-off can carry a note; the palette offers no command the pane does not. */
  notes: boolean;
  requestSign: (report: ResultReport | null, withNote: boolean) => void;
  setAssignment: (assignment: Assignment) => void;
  setBulkOpen: (open: boolean) => void;
}>): Command[] {
  const t = useTranslator();
  return useMemo<Command[]>(
    () => {
      const all: Command[] = [
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
      ];
      return notes ? all : all.filter((command) => command.id !== 'results.sign-note');
    },
    /* The two setters are `useState`'s own and stable, but they arrive here as
       parameters rather than from a `useState` call this hook can see, so they
       are named rather than assumed. */
    [t, selected, bulkCandidates.length, notes, requestSign, setAssignment, setBulkOpen]
  );
}

/**
 * The sign-offs made on this screen, and what the clinician is told about each.
 *
 * Nothing is marked signed until the client says it was recorded: a refused
 * sign-off leaves the report in the queue and the notice says so. Each report
 * in a batch is its own sign-off, so a batch can half succeed; what was
 * recorded is marked, what was not is counted, and the requests are settled
 * rather than awaited as one so a single refusal cannot hide the rest.
 */
function useSignOff(writer: WorklistClient, now: string) {
  const t = useTranslator();
  const [signed, setSigned] = useState<Record<string, SignedNote>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [batching, setBatching] = useState(false);
  const signOff = useMutation((report: ResultReport, note: string | null) =>
    writer.results.sign(report, note, now)
  );

  const signOne = useCallback(
    async (report: ResultReport, note: string | null) => {
      const outcome = await signOff.run(report, note);
      if (!outcome.ok) {
        setNotice({
          tone: 'danger',
          title: t('results.signFailed.title', { panel: report.panel }),
          message: t('results.signFailed.message'),
        });
        return;
      }
      setSigned((previous) => ({ ...previous, [report.id]: outcome.value }));
      setNotice({
        tone: 'success',
        title: t('results.signed.title', { panel: report.panel }),
        message: outcome.value.note
          ? t('results.signed.messageWithNote')
          : t('results.signed.message'),
      });
    },
    [t, signOff]
  );

  const signBatch = useCallback(
    async (reports: readonly ResultReport[]) => {
      setBatching(true);
      const settled = await Promise.allSettled(
        reports.map(
          async (report) => [report.id, await writer.results.sign(report, null, now)] as const
        )
      );
      setBatching(false);
      const stamped: Record<string, SignedNote> = Object.fromEntries(
        settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
      );
      const recorded = Object.keys(stamped).length;
      const unsigned = reports.length - recorded;
      setSigned((previous) => ({ ...previous, ...stamped }));
      setNotice({
        tone: unsigned === 0 ? 'success' : 'danger',
        title: counted(t, BATCH_SIGNED, recorded),
        message: unsigned === 0 ? t('results.bulk.message') : counted(t, BATCH_UNSIGNED, unsigned),
      });
    },
    [t, writer, now]
  );

  const dismiss = useCallback(() => setNotice(null), []);

  return useMemo(
    () => ({ signed, notice, dismiss, signOne, signBatch, busy: signOff.pending || batching }),
    [signed, notice, dismiss, signOne, signBatch, signOff.pending, batching]
  );
}

export function ResultsScreen({
  client,
  now: fixedNow,
}: Readonly<ResultsScreenProps>): ReactElement {
  const t = useTranslator();
  const [now] = useState(() => fixedNow ?? clinicNow());
  /* Writes go through the client the reads came from. In live mode that is the
     module-level one: a sign-off names its signer from the credential, so it
     does not wait for `/bff/v0/me` the way the ME filter does. */
  const writer = client ?? worklist;
  /* The clinician's own sign-off queue is what this screen is for, and every
     client can now answer it: over fixtures from the row, and over the API from
     the `RESULT` task that carries the assignment (#535). */
  const [assignment, setAssignment] = useState<Assignment | ''>('ME');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signing, setSigning] = useState<Signing | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const signOffs = useSignOff(writer, now);
  const { signed, busy } = signOffs;

  const results = useResults(
    { pageSize: PAGE_SIZE, ...(assignment ? { assignedTo: assignment } : {}) },
    { client }
  );

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

  /* The queue and the reading pane name the same people, so both read one
     directory rather than one each. Keyed on the page the route answered, not
     on the selection: opening a row is not a new set of patients. */
  const patientNamed = usePatientNames(reports.map((report) => report.patientId));
  const providerNamed = useProviderNames();

  /* The analytes of the one report being read. Fetched here rather than with
     the list, because one call per row is N+1 on a queue built to be scanned
     and the values of a report nobody opened are never looked at. */
  const analytes = useResultAnalytes(selected?.id ?? null, { client });
  /* Sign-off waits until the values are on screen. The list does not carry
     them, so while they load - or after they fail to - the pane would show a
     report with nothing in it and still offer to sign it. */
  const readable = analytes.status === 'success';
  const reading =
    selected && analytes.data ? { ...selected, analytes: analytes.data.data } : selected;
  /* What the laboratory reported and this page of the report does not hold. The
     route paginates these too, so the pane states its own residual the way the
     queue states the rows it refused. */
  const unshownAnalytes = analytes.data
    ? Math.max(analytes.data.page.total - analytes.data.data.length, 0)
    : 0;

  const signOne = useCallback(
    async (report: ResultReport, note: string | null) => {
      await signOffs.signOne(report, note);
      setSigning(null);
    },
    [signOffs]
  );
  const signBulk = useCallback(async () => {
    await signOffs.signBatch(bulkCandidates);
    setBulkOpen(false);
  }, [signOffs, bulkCandidates]);

  const requestSign = useCallback((report: ResultReport | null, withNote: boolean) => {
    if (!report) return;
    setSelectedId(report.id);
    setSigning({ report, withNote });
  }, []);

  const commands = useResultCommands({
    selected,
    bulkCandidates,
    notes: writer.results.notes,
    requestSign,
    setAssignment,
    setBulkOpen,
  });

  const selectedPatient = selected ? patientNamed(selected.patientId) : undefined;
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
        {(page: ResultPage) => (
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
                patientNamed={patientNamed}
              />
              <QueueStatement page={page} />
            </Card>

            {reading ? (
              <ResultReading
                report={reading}
                signed={signed[reading.id] ?? null}
                now={now}
                onSign={() => requestSign(reading, false)}
                onSignWithNote={() => requestSign(reading, true)}
                notes={writer.results.notes}
                values={analytes.status}
                onRetryValues={analytes.refetch}
                unshownAnalytes={unshownAnalytes}
                patientNamed={patientNamed}
                providerNamed={providerNamed}
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
              disabled={busy || !readable}
              onClick={() => (signing ? void signOne(signing.report, null) : undefined)}
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
        onConfirm={(note) => (signing ? void signOne(signing.report, note || null) : undefined)}
        disabled={busy || !readable}
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
            <Button iconLeft="check-check" disabled={busy} onClick={() => void signBulk()}>
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

      {signOffs.notice ? (
        <div className="or-toast-dock">
          <Toast
            tone={signOffs.notice.tone}
            title={signOffs.notice.title}
            message={signOffs.notice.message}
            onClose={signOffs.dismiss}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

'use client';

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

/**
 * OR-04 Results inbox: the sign-off queue, abnormal first.
 *
 * The queue is designed to shrink. Every row carries the value that earned its
 * flag and the sign-off action, the reading pane shows each value against its
 * reference range in words, and a batch action clears the unremarkable ones.
 * Critical values are never in that batch: someone reads them.
 *
 * OpenEMR's Pending Review flagged abnormal results and then offered nothing to
 * do about them, which is why results piled up there. Here signing, signing
 * with a note, and ordering a follow-up all happen without leaving the screen.
 */

/** Abnormal first: this is a triage queue, not a chronological log. */
const FLAG_ORDER: Record<ResultFlag, number> = { CRITICAL: 0, ABNORMAL: 1, NORMAL: 2 };

const ASSIGNMENT_FILTERS: SelectOption[] = [
  { value: 'ME', label: 'Mine' },
  { value: 'TEAM', label: 'Team pool' },
  { value: '', label: 'Everyone' },
];

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

export function ResultsScreen({ client, now = MOCK_NOW }: ResultsScreenProps): ReactElement {
  const [assignment, setAssignment] = useState<Assignment | ''>('ME');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signed, setSigned] = useState<Record<string, SignedNote>>({});
  const [signing, setSigning] = useState<Signing | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  const results = useResults(assignment ? { assignedTo: assignment } : {}, { client });

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
        title: `${report.panel} signed`,
        message: note
          ? 'The note is attached and the result is released to the patient.'
          : 'The result is released to the patient and has left the queue.',
      });
    },
    [now]
  );

  const signBulk = useCallback(() => {
    const stamped: Record<string, SignedNote> = {};
    for (const report of bulkCandidates) stamped[report.id] = { at: now, note: null };
    setSigned((previous) => ({ ...previous, ...stamped }));
    setBulkOpen(false);
    setToast({
      title: `${bulkCandidates.length} in-range results signed`,
      message: 'Critical and out-of-range results stay in the queue for a person to read.',
    });
  }, [bulkCandidates, now]);

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
        label: 'Sign the open result',
        keywords: ['sign off', 'review result'],
        icon: 'pen-line',
        perform: () => requestSign(selected, false),
      },
      {
        id: 'results.sign-note',
        group: 'actions',
        label: 'Sign the open result with a note',
        keywords: ['addendum', 'tell the patient'],
        icon: 'message-square',
        perform: () => requestSign(selected, true),
      },
      {
        id: 'results.bulk-sign',
        group: 'actions',
        label: 'Sign every in-range result',
        keywords: ['bulk sign', 'normal results', 'clear the queue'],
        icon: 'check-check',
        perform: () => setBulkOpen(bulkCandidates.length > 0),
      },
      {
        id: 'results.mine',
        group: 'actions',
        label: 'Show my results',
        keywords: ['assigned to me'],
        icon: 'user-round',
        perform: () => setAssignment('ME'),
      },
      {
        id: 'results.team',
        group: 'actions',
        label: 'Show the team pool',
        keywords: ['unassigned', 'shared queue'],
        icon: 'users',
        perform: () => setAssignment('TEAM'),
      },
    ],
    [selected, bulkCandidates.length, requestSign]
  );

  const selectedPatient = selected ? mockPatientById(selected.patientId) : undefined;
  const selectedPatientName = selectedPatient
    ? formatName(selectedPatient.name, 'full')
    : 'this patient';

  return (
    <AppShell
      title="Results"
      description="The sign-off queue, abnormal first."
      actions={
        <Button
          variant="secondary"
          iconLeft="check-check"
          onClick={() => setBulkOpen(bulkCandidates.length > 0)}
        >
          {bulkCandidates.length > 0
            ? `Sign ${bulkCandidates.length} in-range results`
            : 'No in-range results to batch'}
        </Button>
      }
      topBarActions={
        <Select
          label="Assignment"
          options={ASSIGNMENT_FILTERS}
          value={assignment}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setAssignment(event.target.value as Assignment | '')
          }
        />
      }
      rightRail={
        <Card tone="cream" overline="Queue" title={`${openCount} waiting`}>
          <p className="or-small">
            Critical values cannot be signed in a batch. Everything else in range can, and the rest
            is read one at a time.
          </p>
          <p className="or-small or-muted">
            Signing releases the result to the patient portal and closes the loop the practice
            promised.
          </p>
        </Card>
      }
    >
      <ScreenCommands commands={commands} />
      <AsyncBoundary
        state={results}
        subject="the results queue"
        isEmpty={isEmptyList}
        loadingRows={5}
        empty={{
          title: 'All results reviewed',
          message:
            'Nothing is waiting in this queue. New reports arrive here as the labs send them back.',
          icon: 'flask-conical',
          action: (
            <Button href="/inbox" iconLeft="inbox">
              Go to the inbox
            </Button>
          ),
        }}
      >
        {() => (
          <div className="or-results">
            <Card
              tone="cream"
              overline="Queue"
              title="Results to review"
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
        title="Sign this result"
        description={
          signing
            ? `Signing ${signing.report.panel} for ${selectedPatientName} moves it out of the queue and releases it to the portal. An addendum stays possible.`
            : ''
        }
        onClose={() => setSigning(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSigning(null)}>
              Cancel
            </Button>
            <Button
              iconLeft="pen-line"
              onClick={() => (signing ? signOne(signing.report, null) : undefined)}
            >
              Sign result
            </Button>
          </>
        }
      />

      <SignNoteModal
        open={signing !== null && signing.withNote}
        subject={signing?.report.panel ?? ''}
        patientName={selectedPatientName}
        onCancel={() => setSigning(null)}
        onConfirm={(note) => (signing ? signOne(signing.report, note || null) : undefined)}
      />

      <Modal
        open={bulkOpen}
        title="Sign every in-range result"
        description={`This signs ${bulkCandidates.length} results whose values are all in range, and releases them to their patients. Critical and out-of-range results are not included.`}
        onClose={() => setBulkOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button iconLeft="check-check" onClick={signBulk}>
              {`Sign ${bulkCandidates.length} results`}
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

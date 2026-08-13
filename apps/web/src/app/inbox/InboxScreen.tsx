'use client';

import { Button, Card, Select, Toast } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { InboxList, InboxStreamFilter, slaLabel } from '@/components/inbox';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { INBOX_STREAMS, MOCK_NOW, slaState, useInbox } from '@/lib/api';
import type { Assignment, InboxItem, InboxStream, WorklistClient } from '@/lib/api';
import { formatEnumLabel } from '@/lib/format';

/**
 * The typed inbox (guidelines C13 plus section 3.3).
 *
 * Five streams, one row per work item, and the common disposition finishing in
 * the row: a refill is approved, a cosign is signed, a task is closed. Nothing
 * here forces a detail navigation for a one-click decision, and every item
 * carries an SLA, because work nobody owns is work that ages quietly.
 *
 * The badge counts in the rail belong to this screen and nothing else nags.
 */

const ASSIGNMENT_FILTERS: SelectOption[] = [
  { value: '', label: 'Everything' },
  { value: 'ME', label: 'Mine' },
  { value: 'TEAM', label: 'Team pool' },
];

interface Completion {
  item: InboxItem;
  label: string;
}

export interface InboxScreenProps {
  /** Injectable for tests. Defaults to the app's worklist client. */
  client?: WorklistClient;
  /** Fixed "now", so SLA labels are deterministic. */
  now?: string;
}

export function InboxScreen({ client, now = MOCK_NOW }: InboxScreenProps): ReactElement {
  const [stream, setStream] = useState<InboxStream | null>(null);
  const [assignment, setAssignment] = useState<Assignment | ''>('');
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<Completion | null>(null);

  const inbox = useInbox(assignment ? { assignedTo: assignment } : {}, { client });

  const loaded = useMemo(() => inbox.data?.data ?? [], [inbox.data]);
  const done = new Set(doneIds);

  /* Overdue first, then due soonest: the queue orders itself by what will hurt.
     Completed rows leave the list, and the toast holds the undo. */
  const visible = useMemo(() => {
    const rank = { OVERDUE: 0, DUE_SOON: 1, ON_TIME: 2 } as const;
    const completed = new Set(doneIds);
    return loaded
      .filter((item) => !completed.has(item.id))
      .filter((item) => (stream ? item.stream === stream : true))
      .sort(
        (a, b) =>
          rank[slaState(a.dueAt, now)] - rank[slaState(b.dueAt, now)] ||
          a.dueAt.localeCompare(b.dueAt)
      );
  }, [loaded, doneIds, stream, now]);

  const complete = useCallback((item: InboxItem) => {
    setDoneIds((previous) => [...previous, item.id]);
    setCompletion({ item, label: item.doneLabel });
  }, []);

  /* One undo for both dispositions: whichever list the row landed in, this puts
     it back exactly where it was. Reversible acts get an undo, not a dialog. */
  const undo = useCallback(() => {
    setCompletion((current) => {
      if (current) {
        const { id } = current.item;
        setDoneIds((previous) => previous.filter((candidate) => candidate !== id));
        setClaimedIds((previous) => previous.filter((candidate) => candidate !== id));
      }
      return null;
    });
  }, []);

  const claim = useCallback((item: InboxItem) => {
    setClaimedIds((previous) => [...previous, item.id]);
    setCompletion({ item, label: 'Assigned to you' });
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      ...INBOX_STREAMS.map((candidate) => ({
        id: `inbox.stream.${candidate.toLowerCase()}`,
        group: 'actions' as const,
        label: `Show ${formatEnumLabel(candidate).toLowerCase()} in the inbox`,
        keywords: ['filter inbox', candidate.toLowerCase()],
        icon: 'filter',
        perform: () => setStream(candidate),
      })),
      {
        id: 'inbox.stream.all',
        group: 'actions',
        label: 'Show every inbox stream',
        keywords: ['clear filter'],
        icon: 'inbox',
        perform: () => setStream(null),
      },
      {
        id: 'inbox.mine',
        group: 'actions',
        label: 'Show only my inbox items',
        keywords: ['assigned to me'],
        icon: 'user-round',
        perform: () => setAssignment('ME'),
      },
      {
        id: 'inbox.team',
        group: 'actions',
        label: 'Show the team pool',
        keywords: ['shared queue', 'unassigned'],
        icon: 'users',
        perform: () => setAssignment('TEAM'),
      },
    ],
    []
  );

  const overdue = visible.filter((item) => slaState(item.dueAt, now) === 'OVERDUE');
  const oldestOverdue = overdue[0];

  return (
    <AppShell
      title="Inbox"
      description="Results, messages, refills and cosigns, in one typed queue."
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
        <Card tone="cream" overline="Today" title={`${visible.length} open items`}>
          <p className="or-small">
            {oldestOverdue
              ? `${overdue.length} past their due time. The oldest is ${slaLabel(oldestOverdue.dueAt, now).toLowerCase()}.`
              : 'Nothing is overdue. The oldest item is still inside its promise.'}
          </p>
          <p className="or-small or-muted">
            Every disposition here is audited, and an approval can be undone from the toast while it
            is still on screen.
          </p>
        </Card>
      }
    >
      <ScreenCommands commands={commands} />
      <InboxStreamFilter
        items={loaded.filter((item) => !done.has(item.id))}
        active={stream}
        onChange={setStream}
      />

      <Card tone="cream" title={stream ? `${formatEnumLabel(stream)} stream` : 'Everything'}>
        <AsyncBoundary
          state={inbox}
          subject="the inbox"
          isEmpty={() => visible.length === 0}
          loadingRows={6}
          empty={{
            title: stream
              ? `No ${formatEnumLabel(stream).toLowerCase()} waiting`
              : 'Inbox zero, for now',
            message: stream
              ? 'Nothing in this stream needs you. Clear the filter to see the rest of the queue.'
              : 'New results, messages, refills and cosigns land here as they arrive.',
            icon: 'inbox',
            action: (
              <Button href="/schedule" iconLeft="calendar-days">
                Go to the schedule
              </Button>
            ),
          }}
        >
          {() => (
            <InboxList
              items={visible}
              now={now}
              onComplete={complete}
              onClaim={claim}
              claimedIds={claimedIds}
            />
          )}
        </AsyncBoundary>
      </Card>

      {completion ? (
        <div className="or-toast-dock">
          <Toast
            tone="success"
            title={completion.label}
            message={completion.item.summary}
            action={
              <Button variant="ghost" size="sm" onClick={undo}>
                Undo
              </Button>
            }
            onClose={() => setCompletion(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

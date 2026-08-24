'use client';

import { Button, Card, Select, Toast } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import {
  INBOX_STREAM_INLINE_KEYS,
  INBOX_STREAM_LABEL_KEYS,
  InboxList,
  InboxStreamFilter,
  slaLabel,
} from '@/components/inbox';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { INBOX_STREAMS, MOCK_NOW, slaState, useInbox } from '@/lib/api';
import type { Assignment, InboxItem, InboxStream, WorklistClient } from '@/lib/api';
import { useTranslator } from '@/lib/i18n/messages';

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

/**
 * The assignment filter, as data with keys rather than words.
 *
 * The options are built at render from this, because a module constant is
 * evaluated once for the whole process and the reader's language is not known
 * then. `value` is what the API filters on and stays a code.
 */
const ASSIGNMENT_FILTERS: readonly { value: Assignment | ''; labelKey: string }[] = [
  { value: '', labelKey: 'inbox.filter.everything' },
  { value: 'ME', labelKey: 'inbox.filter.mine' },
  { value: 'TEAM', labelKey: 'inbox.filter.teamPool' },
];

/** Palette synonyms from one comma-separated message, in the reader's language. */
function synonyms(list: string): string[] {
  return list
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

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

export function InboxScreen({ client, now = MOCK_NOW }: Readonly<InboxScreenProps>): ReactElement {
  const t = useTranslator();
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
    const open = loaded.filter(
      (item) => !completed.has(item.id) && (!stream || item.stream === stream)
    );
    return open.sort(
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
    if (!completion) return;
    // Read from state rather than from inside a setter: React may replay an
    // updater, and an updater that queues two more updates would replay those
    // too. Nothing here needs the freshest value; the toast holding the undo is
    // the same render's completion.
    const { id } = completion.item;
    setDoneIds((previous) => previous.filter((candidate) => candidate !== id));
    setClaimedIds((previous) => previous.filter((candidate) => candidate !== id));
    setCompletion(null);
  }, [completion]);

  const claim = useCallback(
    (item: InboxItem) => {
      setClaimedIds((previous) => [...previous, item.id]);
      setCompletion({ item, label: t('inbox.list.assigned') });
    },
    [t]
  );

  const commands = useMemo<Command[]>(
    () => [
      ...INBOX_STREAMS.map((candidate) => ({
        id: `inbox.stream.${candidate.toLowerCase()}`,
        group: 'actions' as const,
        label: t('inbox.command.showStream', {
          stream: t(INBOX_STREAM_INLINE_KEYS[candidate]),
        }),
        /* The enum member itself joins the reader's own search words: somebody
           who knows the stream by its API name should still find the command,
           and that name is a code rather than a word to translate. */
        keywords: [...synonyms(t('inbox.command.showStream.keywords')), candidate.toLowerCase()],
        icon: 'filter',
        perform: () => setStream(candidate),
      })),
      {
        id: 'inbox.stream.all',
        group: 'actions',
        label: t('inbox.command.showAll'),
        keywords: synonyms(t('inbox.command.showAll.keywords')),
        icon: 'inbox',
        perform: () => setStream(null),
      },
      {
        id: 'inbox.mine',
        group: 'actions',
        label: t('inbox.command.mine'),
        keywords: synonyms(t('inbox.command.mine.keywords')),
        icon: 'user-round',
        perform: () => setAssignment('ME'),
      },
      {
        id: 'inbox.team',
        group: 'actions',
        label: t('inbox.command.team'),
        keywords: synonyms(t('inbox.command.team.keywords')),
        icon: 'users',
        perform: () => setAssignment('TEAM'),
      },
    ],
    [t]
  );

  const overdue = visible.filter((item) => slaState(item.dueAt, now) === 'OVERDUE');
  const oldestOverdue = overdue[0];

  return (
    <AppShell
      title={t('inbox.title')}
      description={t('inbox.description')}
      topBarActions={
        <Select
          label={t('inbox.filter.assignment')}
          options={ASSIGNMENT_FILTERS.map((filter): SelectOption => ({
            value: filter.value,
            label: t(filter.labelKey),
          }))}
          value={assignment}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setAssignment(event.target.value as Assignment | '')
          }
        />
      }
      rightRail={
        <Card
          tone="cream"
          overline={t('inbox.rail.overline')}
          title={t('inbox.rail.openItems', { count: visible.length })}
        >
          <p className="or-small">
            {oldestOverdue
              ? t('inbox.rail.overdueSummary', {
                  count: overdue.length,
                  oldest: slaLabel(t, oldestOverdue.dueAt, now, 'inline'),
                })
              : t('inbox.rail.nothingOverdue')}
          </p>
          <p className="or-small or-muted">{t('inbox.rail.auditNote')}</p>
        </Card>
      }
    >
      <ScreenCommands commands={commands} />
      <InboxStreamFilter
        items={loaded.filter((item) => !done.has(item.id))}
        active={stream}
        onChange={setStream}
      />

      <Card
        tone="cream"
        title={
          stream
            ? t('inbox.streamTitle', { stream: t(INBOX_STREAM_LABEL_KEYS[stream]) })
            : t('inbox.filter.everything')
        }
      >
        <AsyncBoundary
          state={inbox}
          subject={t('inbox.subject')}
          isEmpty={() => visible.length === 0}
          loadingRows={6}
          empty={{
            title: stream
              ? t('inbox.empty.streamTitle', { stream: t(INBOX_STREAM_INLINE_KEYS[stream]) })
              : t('inbox.empty.allTitle'),
            message: stream ? t('inbox.empty.streamMessage') : t('inbox.empty.allMessage'),
            icon: 'inbox',
            action: (
              <Button href="/schedule" iconLeft="calendar-days">
                {t('inbox.empty.goToSchedule')}
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
                {t('inbox.list.undo')}
              </Button>
            }
            onClose={() => setCompletion(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

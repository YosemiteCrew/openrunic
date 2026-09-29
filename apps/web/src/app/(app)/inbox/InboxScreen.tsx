'use client';

import { formatCount } from '@openrunic/i18n';
import { Button, Card, Modal, Select, Textarea } from '@openrunic/ui';
import type { SelectOption } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import {
  INBOX_STREAM_DONE_KEYS,
  INBOX_STREAM_INLINE_KEYS,
  INBOX_STREAM_LABEL_KEYS,
  InboxList,
  InboxStreamFilter,
  slaLabel,
} from '@/components/inbox';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, Toast } from '@/components/state';
import {
  INBOX_STREAMS,
  slaState,
  useInbox,
  useMutation,
  usePatientNames,
  worklist,
} from '@/lib/api';
import type { Assignment, InboxItem, InboxStream, WorklistClient } from '@/lib/api';
import { clinicNow } from '@/lib/api/chart';

import { counted } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
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

interface ReplyState {
  item: InboxItem;
  body: string;
}

interface ReplyModalProps {
  state: ReplyState;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  sendLabel: string;
  cancelLabel: string;
  pending: boolean;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSend: () => void;
}

function ReplyModal({
  state,
  title,
  description,
  label,
  placeholder,
  sendLabel,
  cancelLabel,
  pending,
  onBodyChange,
  onCancel,
  onSend,
}: Readonly<ReplyModalProps>): ReactElement {
  return (
    <Modal
      open
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            disabled={state.body.trim().length === 0 || pending}
            onClick={onSend}
          >
            {sendLabel}
          </Button>
        </>
      }
    >
      <Textarea
        label={label}
        value={state.body}
        onChange={(event) => onBodyChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        autoFocus
      />
    </Modal>
  );
}

interface CompletionToastProps {
  completion: Completion;
  busy: boolean;
  undoLabel: string;
  onUndo?: () => void;
  onClose: () => void;
}

function CompletionToast({
  completion,
  busy,
  undoLabel,
  onUndo,
  onClose,
}: Readonly<CompletionToastProps>): ReactElement {
  return (
    <div className="or-toast-dock">
      <Toast
        tone="success"
        title={completion.label}
        message={completion.item.summary}
        action={
          onUndo ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onUndo}>
              {undoLabel}
            </Button>
          ) : undefined
        }
        onClose={onClose}
      />
    </div>
  );
}

interface InboxRailProps {
  t: ReturnType<typeof useTranslator>;
  visibleCount: number;
  oldestOverdueAt: string | null;
  overdueCount: number;
  windowed: number | null;
  total: number | null;
  refused: number;
  now: string;
}

function InboxRail({
  t,
  visibleCount,
  oldestOverdueAt,
  overdueCount,
  windowed,
  total,
  refused,
  now,
}: Readonly<InboxRailProps>): ReactElement {
  return (
    <Card
      tone="cream"
      overline={t('inbox.rail.overline')}
      title={counted(t, OPEN_ITEMS, visibleCount)}
    >
      <p className="or-small">
        {oldestOverdueAt !== null
          ? counted(t, OVERDUE_SUMMARY, overdueCount, {
              oldest: slaLabel(t, oldestOverdueAt, now, 'inline'),
            })
          : t('inbox.rail.nothingOverdue')}
      </p>
      {windowed !== null && total !== null && windowed < total ? (
        <p className="or-caption">
          {counted(t, INBOX_WINDOW, windowed, { total: formatCount(total, t.locale) })}
        </p>
      ) : null}
      {refused > 0 ? (
        <p className="or-caption">
          <strong>{counted(t, NOT_SHOWN, refused)}</strong>
        </p>
      ) : null}
      <p className="or-small or-muted">{t('inbox.rail.auditNote')}</p>
    </Card>
  );
}

export interface InboxScreenProps {
  /** Injectable for tests. Defaults to the app's worklist client. */
  client?: WorklistClient;
  /**
   * Fixed "now", so SLA labels are deterministic. Defaults to the clinic's
   * clock: the fixtures' instant in the demo build, the wall clock against the
   * API, where a due date is measured against today rather than the demo's day.
   */
  now?: string;
}

/**
 * The two counted sentences on the rail.
 *
 * A pair per sentence rather than one message with the number dropped into it.
 * The plural message alone rendered "1 open items" in English and
 * "1 elementos abiertos" in Spanish, which is the failure a catalogue is
 * supposed to remove rather than one it should introduce.
 */
const OPEN_ITEMS: CountedMessage = {
  oneKey: 'inbox.rail.openItemsOne',
  otherKey: 'inbox.rail.openItemsOther',
};

/**
 * The rows the route put on this page, when it matched more than one page of
 * them.
 *
 * The same statement the orders ledger and the sign-off queue make, for the
 * same reason: this screen has no pager, and the chip counts above the list are
 * a count of ONE page. A total above a full list is a number about the practice
 * rather than about the queue (#539).
 */
const INBOX_WINDOW: CountedMessage = {
  oneKey: 'inbox.rail.windowOne',
  otherKey: 'inbox.rail.windowOther',
};

/** The rows the five typed streams refused, because `TASK_TYPES` is wider than C13's five. */
const NOT_SHOWN: CountedMessage = {
  oneKey: 'inbox.rail.notShownOne',
  otherKey: 'inbox.rail.notShownOther',
};

const OVERDUE_SUMMARY: CountedMessage = {
  oneKey: 'inbox.rail.overdueSummaryOne',
  otherKey: 'inbox.rail.overdueSummaryOther',
};

/**
 * The verbs this screen offers the command palette: a stream, every stream, and
 * the two assignment filters. A hook rather than a block inside the screen,
 * because it is the one part of `InboxScreen` with no markup in it.
 */
function useInboxCommands(
  setStream: (stream: InboxStream | null) => void,
  setAssignment: (assignment: Assignment | '') => void
): Command[] {
  const t = useTranslator();
  return useMemo<Command[]>(
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
    /* The setters are `useState`'s own and stable, but they arrive here as
       parameters, so they are named rather than assumed. */
    [t, setStream, setAssignment]
  );
}

export function InboxScreen({ client, now: fixedNow }: Readonly<InboxScreenProps>): ReactElement {
  const t = useTranslator();
  const [now] = useState(() => fixedNow ?? clinicNow());
  /* Writes go through the client the reads came from; in live mode the
     module-level one, since a disposition names its actor from the credential
     and does not wait for `/bff/v0/me`. */
  const writer = client ?? worklist;
  const { claim: recordClaim, reopen: recordReopen, reply: recordReply } = writer.inbox;
  /* A row whose disposition was refused, so the toast can say it is still open. */
  const [refusal, setRefusal] = useState<InboxItem | null>(null);
  const [stream, setStream] = useState<InboxStream | null>(null);
  const [assignment, setAssignment] = useState<Assignment | ''>('');
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [reply, setReply] = useState<ReplyState | null>(null);

  const inbox = useInbox(assignment ? { assignedTo: assignment } : {}, { client });

  const loaded = useMemo(() => inbox.data?.data ?? [], [inbox.data]);
  const done = new Set(doneIds);

  /* Off the PAGE rather than off `visible`: the stream chips and the completed
     rows narrow what is rendered, not what was read, and keying the name read
     on the filtered set would refetch the same patients every time somebody
     picked a stream. */
  const patientNamed = usePatientNames(loaded.map((item) => item.patientId));

  /* Overdue first, then due soonest: the queue orders itself by what will hurt.
     Completed rows leave the list, and the toast holds the undo. */
  const visible = useMemo(() => {
    const rank = { OVERDUE: 0, DUE_SOON: 1, ON_TIME: 2 } as const;
    const completed = new Set(doneIds);
    const open = loaded.filter(
      (item) => !completed.has(item.id) && (!stream || item.stream === stream)
    );
    /* A task with no due date is not the most urgent one, so it sorts last -
       the same decision the route's own comparator makes, so the two orderings
       do not disagree about the top of the queue. */
    return open.sort(
      (a, b) =>
        rank[slaState(a.dueAt, now)] - rank[slaState(b.dueAt, now)] ||
        (a.dueAt ?? '\uffff').localeCompare(b.dueAt ?? '\uffff')
    );
  }, [loaded, doneIds, stream, now]);

  /* A row leaves the list once the client says its disposition was recorded,
     and not before: a row that vanished over a refusal would read as done. */
  const completing = useMutation((item: InboxItem) => writer.inbox.complete(item));
  const complete = useCallback(
    async (item: InboxItem) => {
      if (item.stream === 'MESSAGES' && recordReply !== null) {
        setReply({ item, body: '' });
        return;
      }
      const outcome = await completing.run(item);
      if (!outcome.ok) {
        setCompletion(null);
        setRefusal(item);
        return;
      }
      setRefusal(null);
      setDoneIds((previous) => [...previous, item.id]);
      setCompletion({ item, label: t(INBOX_STREAM_DONE_KEYS[item.stream]) });
    },
    [t, completing, recordReply]
  );

  const replying = useMutation(({ item, body }: ReplyState) => {
    if (recordReply === null) return Promise.reject(new Error('Message replies are unavailable.'));
    return recordReply(item, body);
  });
  const sendReply = useCallback(async () => {
    if (reply === null) return;
    const outcome = await replying.run(reply);
    if (!outcome.ok) {
      setReply(null);
      setCompletion(null);
      setRefusal(reply.item);
      return;
    }
    setDoneIds((previous) => [...previous, reply.item.id]);
    setCompletion({ item: reply.item, label: t(INBOX_STREAM_DONE_KEYS.MESSAGES) });
    setReply(null);
    setRefusal(null);
  }, [reply, replying, t]);

  /* One undo for both dispositions: whichever list the row landed in, this puts
     it back exactly where it was. Reversible acts get an undo, not a dialog -
     where the client can reverse them. Where it cannot, no undo is offered. */
  const reopening = useMutation((record: (item: InboxItem) => Promise<void>, item: InboxItem) =>
    record(item)
  );
  const undo = useCallback(
    async (record: (item: InboxItem) => Promise<void>) => {
      if (!completion) return;
      // Read from state rather than from inside a setter: React may replay an
      // updater, and an updater that queues two more updates would replay those
      // too. Nothing here needs the freshest value; the toast holding the undo is
      // the same render's completion.
      const { item } = completion;
      const outcome = await reopening.run(record, item);
      if (!outcome.ok) {
        setCompletion(null);
        setRefusal(item);
        return;
      }
      setDoneIds((previous) => previous.filter((candidate) => candidate !== item.id));
      setClaimedIds((previous) => previous.filter((candidate) => candidate !== item.id));
      setCompletion(null);
    },
    [completion, reopening]
  );

  /* Handed the client's claim rather than reading it here: the row only offers
     Assign to me where the client has one, so there is no absent claim to
     answer for. */
  const claiming = useMutation((record: (item: InboxItem) => Promise<void>, item: InboxItem) =>
    record(item)
  );
  const claim = useCallback(
    async (record: (item: InboxItem) => Promise<void>, item: InboxItem) => {
      const outcome = await claiming.run(record, item);
      if (!outcome.ok) {
        setCompletion(null);
        setRefusal(item);
        return;
      }
      setRefusal(null);
      setClaimedIds((previous) => [...previous, item.id]);
      setCompletion({ item, label: t('inbox.list.assigned') });
    },
    [t, claiming]
  );

  const busy = completing.pending || claiming.pending || reopening.pending || replying.pending;

  const commands = useInboxCommands(setStream, setAssignment);

  /* Read off the page rather than off `visible`, which the stream chips and the
     completed rows have already narrowed: the two absences below are facts
     about what the ROUTE answered, and folding them into the filtered count
     would make them disappear the moment somebody picked a stream. */
  const page = inbox.data?.page ?? null;
  const refused = inbox.data?.refused ?? 0;
  const windowed = inbox.data ? inbox.data.data.length + refused : null;

  /* The streams are filtered in the browser from one page, so a stream with
     nothing on a page that is not the whole inbox has nothing HERE, which is
     not the same as nothing waiting. */
  const truncated = windowed !== null && page !== null && windowed < page.total;
  const streamEmptyTitle = (chosen: InboxStream): string =>
    t(truncated ? 'inbox.empty.streamPageTitle' : 'inbox.empty.streamTitle', {
      stream: t(INBOX_STREAM_INLINE_KEYS[chosen]),
    });
  const streamEmptyMessage = t(
    truncated ? 'inbox.empty.streamPageMessage' : 'inbox.empty.streamMessage'
  );

  const overdue = visible.filter((item) => slaState(item.dueAt, now) === 'OVERDUE');
  /* The instant rather than the item: an item with no due date is never
     OVERDUE, and reading the field out here is what says so to the compiler
     without asserting it. */
  const oldestOverdueAt = overdue[0]?.dueAt ?? null;

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
        <InboxRail
          t={t}
          visibleCount={visible.length}
          oldestOverdueAt={oldestOverdueAt}
          overdueCount={overdue.length}
          windowed={windowed}
          total={page?.total ?? null}
          refused={refused}
          now={now}
        />
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
            title: stream ? streamEmptyTitle(stream) : t('inbox.empty.allTitle'),
            message: stream ? streamEmptyMessage : t('inbox.empty.allMessage'),
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
              completes={writer.inbox.completes}
              onComplete={(item) => void complete(item)}
              onClaim={recordClaim === null ? undefined : (item) => void claim(recordClaim, item)}
              busy={busy}
              claimedIds={claimedIds}
              patientNamed={patientNamed}
            />
          )}
        </AsyncBoundary>
      </Card>

      {completion ? (
        <CompletionToast
          completion={completion}
          busy={busy}
          undoLabel={t('inbox.list.undo')}
          onUndo={recordReopen === null ? undefined : () => void undo(recordReopen)}
          onClose={() => setCompletion(null)}
        />
      ) : null}

      {reply ? (
        <ReplyModal
          state={reply}
          title={t('inbox.reply.title', { patient: reply.item.summary })}
          description={t('inbox.reply.description')}
          label={t('inbox.reply.label')}
          placeholder={t('inbox.reply.placeholder')}
          sendLabel={t('inbox.reply.send')}
          cancelLabel={t('inbox.reply.cancel')}
          pending={replying.pending}
          onBodyChange={(body) => setReply({ ...reply, body })}
          onCancel={() => setReply(null)}
          onSend={() => void sendReply()}
        />
      ) : null}

      {refusal ? (
        <div className="or-toast-dock">
          <Toast
            tone="danger"
            title={t('inbox.list.notRecorded')}
            message={refusal.summary}
            onClose={() => setRefusal(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

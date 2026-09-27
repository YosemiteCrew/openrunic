import { describe, expect, it, vi } from 'vitest';

import { liveInbox, toInboxItem, toInboxPage, toTaskQuery } from '@/lib/api';
import type { ApiClient, ListResponse, TaskDto, TaskKind } from '@/lib/api';
import { filterTasks } from '@/lib/api/mock/client';
import { MOCK_TASKS } from '@/lib/api/mock/records';

/**
 * The seam between `GET /bff/v0/tasks` and the typed inbox's view type.
 *
 * Three failure directions. A field read off the wrong key is a plausible wrong
 * value rather than a blank; a task type the five streams have no word for must
 * be refused rather than folded, because the four that are refused are the
 * administrative ones the typed inbox exists to keep out; and the row's
 * assignment is a word computed from TWO columns against the caller's own id,
 * so a mapper reading either one alone labels somebody else's work as yours.
 */

const ME = 'user-me';
const SOMEBODY_ELSE = 'user-other';

const DTO: TaskDto = {
  id: 'task-1',
  type: 'REFILL',
  status: 'OPEN',
  priority: 'HIGH',
  patientId: 'patient-1',
  encounterId: 'encounter-1',
  subjectType: 'MedicationRequest',
  subjectId: 'rx-1',
  title: 'Approve the lisinopril refill',
  description: 'Last dispensed ninety days ago.',
  assigneeType: 'USER',
  assigneeUserId: ME,
  assigneeTeamKey: null,
  dueAt: '2026-02-01T17:00:00.000Z',
  slaState: 'AGING',
  expiresAt: '2026-03-01T00:00:00.000Z',
  sourceEventId: 'event-1',
  completedAt: null,
  completedById: null,
  outcome: null,
  createdAt: '2026-02-01T09:00:00.000Z',
  updatedAt: '2026-02-01T11:00:00.000Z',
};

function dto(overrides: Partial<TaskDto> = {}): TaskDto {
  return { ...DTO, ...overrides };
}

function page(rows: readonly TaskDto[], total = rows.length): ListResponse<TaskDto> {
  return { data: [...rows], page: { page: 1, pageSize: 25, total, totalPages: 1 } };
}

describe('toInboxItem', () => {
  it('carries every rendered field from the field the API sends', () => {
    expect(toInboxItem(DTO, ME)).toEqual({
      id: 'task-1',
      stream: 'REFILLS',
      patientId: 'patient-1',
      summary: 'Approve the lisinopril refill',
      detail: 'Last dispensed ninety days ago.',
      receivedAt: '2026-02-01T09:00:00.000Z',
      dueAt: '2026-02-01T17:00:00.000Z',
      assignedTo: 'ME',
      unread: null,
      href: null,
    });
  });

  /* The four instants on the DTO are distinct above, so a mapper reading
     `updatedAt` where it should read `createdAt`, or `expiresAt` where it
     should read `dueAt`, fails rather than agreeing with itself. The queue
     sorts on the due instant and the row states the received one. */
  it('reads the received and due instants from different fields', () => {
    const item = toInboxItem(dto({ dueAt: '2026-04-01T00:00:00.000Z' }), ME);

    expect(item?.receivedAt).toBe('2026-02-01T09:00:00.000Z');
    expect(item?.dueAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it.each([
    ['RESULT', 'RESULTS'],
    ['MESSAGE', 'MESSAGES'],
    ['REFILL', 'REFILLS'],
    ['COSIGN', 'COSIGN'],
    ['GENERAL', 'TASKS'],
  ] as const)('reads a %s task as the %s stream', (type, stream) => {
    expect(toInboxItem(dto({ type }), ME)?.stream).toBe(stream);
  });

  /* The whole point of a TYPED inbox: a claim exception is a practice
     administrator's work (#475), and folding it into TASKS would put it in
     front of a clinician. Refused rather than renamed. */
  it.each(['DOCUMENT', 'FAX', 'PRIOR_AUTH', 'CLAIM_EXCEPTION'] as const)(
    'refuses a %s task rather than folding it into a clinical stream',
    (type) => {
      expect(toInboxItem(dto({ type }), ME)).toBeNull();
    }
  );

  it("reads another clinician's task as somebody else's, not as mine", () => {
    expect(toInboxItem(dto({ assigneeUserId: SOMEBODY_ELSE }), ME)?.assignedTo).toBe('TEAM');
  });

  /* `assigneeType` is what decides, not the id column: a task moved to the
     pool keeps whatever `assigneeUserId` it had, and reading that column alone
     would put a released task back in the releaser's own queue. */
  it('reads a pooled task as the pool even when it still names a person', () => {
    const pooled = dto({ assigneeType: 'TEAM', assigneeUserId: ME, assigneeTeamKey: 'lab' });

    expect(toInboxItem(pooled, ME)?.assignedTo).toBe('TEAM');
  });

  it('leaves an absent description and an absent due date absent', () => {
    const bare = toInboxItem(dto({ description: null, dueAt: null }), ME);

    expect(bare?.detail).toBeNull();
    expect(bare?.dueAt).toBeNull();
  });

  /* A link to nowhere is worse than no link: results is the one screen this
     application has for a task's subject. */
  it('offers the report screen for a result and nothing for any other subject', () => {
    expect(toInboxItem(dto({ subjectType: 'DiagnosticReport' }), ME)?.href).toBe('/results');
    expect(toInboxItem(dto({ subjectType: 'MessageThread' }), ME)?.href).toBeNull();
    expect(toInboxItem(dto({ subjectType: null }), ME)?.href).toBeNull();
  });
});

describe('toInboxPage', () => {
  it('counts the rows it refused rather than dropping them out of the total', () => {
    const result = toInboxPage(page([dto(), dto({ id: 'task-2', type: 'FAX' })]), ME);

    expect(result.data).toHaveLength(1);
    expect(result.refused).toBe(1);
  });

  /* The envelope is carried, never recomputed: `total` counts what the API
     matched across every page, and rebuilding it from the rows this page could
     render would silently restate the queue as one page long. */
  it('carries the page the API sent rather than rebuilding it from the rows', () => {
    const result = toInboxPage(page([dto()], 94), ME);

    expect(result.page).toEqual({ page: 1, pageSize: 25, total: 94, totalPages: 1 });
  });
});

describe('toTaskQuery', () => {
  it('asks for one page of open work belonging to this caller', () => {
    expect(toTaskQuery({}, ME)).toEqual({
      inboxFor: ME,
      open: true,
      pageSize: 100,
      sort: 'dueAt',
      order: 'asc',
    });
  });

  it.each([
    ['ME', 'USER'],
    ['TEAM', 'TEAM'],
  ] as const)('narrows a %s filter to the %s half of the inbox', (assignedTo, assigneeType) => {
    expect(toTaskQuery({ assignedTo }, ME).assigneeType).toBe(assigneeType);
  });

  /* The screen counts all five streams off one page, so narrowing at the route
     would empty the other four counts. Asserted as an absence because the route
     HAS that filter and translating `stream` into it is the tempting wrong
     move. */
  it('does not narrow by stream, because the chips count what one page holds', () => {
    expect(toTaskQuery({ stream: 'REFILLS' }, ME)).not.toHaveProperty('type');
    expect(toTaskQuery({}, ME)).not.toHaveProperty('assigneeType');
  });
});

describe('liveInbox', () => {
  it('sends the query the route answers and maps what comes back', async () => {
    const list = vi.fn().mockResolvedValue(page([dto()]));
    const client = { tasks: { list } } as unknown as ApiClient;

    const result = await liveInbox(client, ME).list({ assignedTo: 'TEAM' });

    /* The request is asserted, not only the answer: a receipt says the route
       accepted something, not that it accepted the right thing. */
    expect(list).toHaveBeenCalledWith({
      inboxFor: ME,
      open: true,
      pageSize: 100,
      sort: 'dueAt',
      order: 'asc',
      assigneeType: 'TEAM',
    });
    expect(result.data[0]?.summary).toBe('Approve the lisinopril refill');
    expect(result.refused).toBe(0);
  });
});

/**
 * The mock side of the same route.
 *
 * The demo build answers this query too, and a filter it accepts and drops is
 * a screen that narrows in one mode and not the other - the defect the
 * medication-statement filter above it carries a note about.
 */
describe('filterTasks', () => {
  const rows: readonly TaskDto[] = [
    dto({ id: 'mine', assigneeType: 'USER', assigneeUserId: ME }),
    dto({ id: 'pool', assigneeType: 'TEAM', assigneeUserId: null, assigneeTeamKey: 'lab' }),
    dto({ id: 'theirs', assigneeType: 'USER', assigneeUserId: SOMEBODY_ELSE }),
    dto({ id: 'closed', assigneeType: 'USER', assigneeUserId: ME, status: 'DONE' }),
  ];
  const ids = (query: Parameters<typeof filterTasks>[1]): string[] =>
    filterTasks(rows, query).map((row) => row.id);

  it("answers an inbox as the caller's own work and the pool, and nobody else's", () => {
    // The unfiltered answer is the baseline: it says every row is reachable, so
    // an absence below is the filter refusing it rather than the fixture.
    expect(ids({})).toEqual(['mine', 'pool', 'theirs', 'closed']);
    expect(ids({ inboxFor: ME })).toEqual(['mine', 'pool', 'closed']);
    expect(ids({ inboxFor: ME, assigneeType: 'TEAM' })).toEqual(['pool']);
  });

  it('separates the work still in flight from the work that is finished', () => {
    expect(ids({ open: true })).toEqual(['mine', 'pool', 'theirs']);
    expect(ids({ open: false })).toEqual(['closed']);
  });

  it('sorts a task with no due date last ascending and first descending', () => {
    const undated = [dto({ id: 'undated', dueAt: null }), dto({ id: 'dated' })];

    expect(filterTasks(undated, {}).map((row) => row.id)).toEqual(['dated', 'undated']);
    expect(filterTasks(undated, { order: 'desc' }).map((row) => row.id)).toEqual([
      'undated',
      'dated',
    ]);
  });

  it('narrows the fixture tasks by every equality the route advertises', () => {
    const first = MOCK_TASKS[0];
    if (!first) throw new Error('MOCK_TASKS is empty');

    expect(filterTasks(MOCK_TASKS, { type: first.type }).length).toBeGreaterThan(0);
    expect(filterTasks(MOCK_TASKS, { type: 'FAX' satisfies TaskKind })).toEqual(
      MOCK_TASKS.filter((row) => row.type === 'FAX')
    );
  });
});

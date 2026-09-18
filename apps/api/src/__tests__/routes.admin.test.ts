import { describe, expect, it } from 'vitest';

import { compareEntries } from '../routes/admin.js';
import type { TaskRow } from '../repositories/specs/orders.js';
import type { ScopedRow } from '../repositories/rows.js';
import type { WorklistEntry, WorklistResponse } from '../schemas/admin.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  FIXED_NOW,
  makePatientRow,
  seed,
  seedCareRelationship,
  storageColumns,
  SUBJECTS,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * THE ADMINISTRATIVE WORKLIST.
 *
 * One route that reads two open-work doors at once. What these assert is the
 * half that goes wrong: that a caller holding the task door but not the order
 * door sees the task half with the referral source withheld rather than shown
 * empty, that the overdue marker is computed against the clock handed to the
 * route and not a stored snapshot, and that a chart the caller has no care
 * relationship to refuses the whole worklist the way the addressed read would.
 */

const PATIENT = testId(1);
const SECOND_PATIENT = testId(2);
/** The subject `TOKENS.adminA` resolves to (the `admin` fixture). */
const ADMIN = testId(951);

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    ...storageColumns(testId(500)),
    type: 'GENERAL',
    status: 'OPEN',
    priority: 'NORMAL',
    patientId: PATIENT,
    encounterId: null,
    subjectType: null,
    subjectId: null,
    title: 'Review the CBC panel',
    description: null,
    assigneeType: 'USER',
    assigneeUserId: SUBJECTS.clinicianA,
    assigneeTeamKey: null,
    // Delegated by someone else, so the assigned-task source authorises the
    // assignee; the worklist itself is read by an administrator.
    assignedById: ADMIN,
    dueAt: new Date('2026-08-20T09:00:00.000Z'),
    slaState: 'OK',
    expiresAt: null,
    sourceEventId: null,
    completedAt: null,
    completedById: null,
    outcome: null,
    ...overrides,
  };
}

function makeReferralRow(
  id: string,
  overrides: Partial<ScopedRow<'Referral'>> = {}
): ScopedRow<'Referral'> {
  return {
    id,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT,
    encounterId: null,
    referredById: SUBJECTS.clinicianA,
    status: 'SENT',
    priority: 'ROUTINE',
    specialtyCode: '394579002',
    specialtyDisplay: 'Cardiology',
    receivingPractice: 'Example Cardiology Associates',
    receivingNpi: null,
    receivingPhone: null,
    reasonCodes: ['I25.10'],
    reasonText: null,
    note: null,
    authorisationNumber: null,
    sentAt: FIXED_NOW,
    scheduledFor: null,
    seenAt: null,
    reportReceivedAt: null,
    reportDocumentId: null,
    declinedReason: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  /*
   * The admin reads the worklist, and every source row names a chart, so the
   * care-relationship gate (`assertCareRelationship` through `gateCharts`) has
   * to answer for each one. An appointment at the admin's own facility is the
   * cheapest source that satisfies it: `facility-activity` authorises anyone
   * who can see a site where there has been activity, and `seedCareRelationship`
   * offers exactly that row.
   */
  seedCareRelationship(created.dataset, {
    patientId: PATIENT,
    providerId: SUBJECTS.clinicianA,
    facilityId: DEMO_FACILITY_A,
    as: 'appointment',
  });
  return created;
}

async function worklist(
  app: ReturnType<typeof createTestApp>['app'],
  token: string = TOKENS.adminA,
  query = ''
): Promise<Response> {
  return app.request(`/bff/v0/admin/worklist${query}`, { headers: bearer(token) });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const entryIds = (body: WorklistResponse): string[] => body.data.map((entry) => entry.id);

function entry(overrides: Partial<WorklistEntry> = {}): WorklistEntry {
  return {
    source: 'task',
    id: testId(900),
    patientId: PATIENT,
    title: 'Review the CBC panel',
    status: 'OPEN',
    owner: { userId: SUBJECTS.clinicianA, teamKey: null },
    dueAt: '2026-08-20T09:00:00.000Z',
    overdue: false,
    blockedBy: null,
    href: `/bff/v0/tasks/${testId(900)}`,
    ...overrides,
  };
}

describe('the worklist comparator, directly', () => {
  it('orders a dated entry before an undated one in both directions', () => {
    const dated = entry();
    const undated = entry({ id: testId(901), dueAt: null });
    expect(compareEntries(dated, undated)).toBeLessThan(0);
    expect(compareEntries(undated, dated)).toBeGreaterThan(0);
  });

  it('orders a named owner before an unnamed one in both directions', () => {
    const named = entry();
    const unnamed = entry({ id: testId(901), owner: { userId: null, teamKey: null } });
    expect(compareEntries(named, unnamed)).toBeLessThan(0);
    expect(compareEntries(unnamed, named)).toBeGreaterThan(0);

    // Two entries with no owner at all fall through the owner comparisons
    // untouched and reach the team-key and, in the end, the id.
    const alsoUnnamed = entry({ id: testId(902), owner: { userId: null, teamKey: null } });
    expect(compareEntries(unnamed, alsoUnnamed)).toBeLessThan(0);
  });

  it('compares owners on the user id and breaks a user tie on the team key', () => {
    const earlierUser = entry({ owner: { userId: SUBJECTS.clinicianA, teamKey: null } });
    const laterUser = entry({
      id: testId(901),
      owner: { userId: SUBJECTS.billerA, teamKey: null },
    });
    expect(compareEntries(earlierUser, laterUser)).toBeLessThan(0);

    const earlierTeam = entry({ owner: { userId: SUBJECTS.clinicianA, teamKey: 'billing' } });
    const laterTeam = entry({
      id: testId(901),
      owner: { userId: SUBJECTS.clinicianA, teamKey: 'front-desk' },
    });
    expect(compareEntries(earlierTeam, laterTeam)).toBeLessThan(0);

    // A named team sorts before a null one once the user ties.
    const nullTeam = entry({
      id: testId(902),
      owner: { userId: SUBJECTS.clinicianA, teamKey: null },
    });
    expect(compareEntries(earlierTeam, nullTeam)).toBeLessThan(0);
    expect(compareEntries(nullTeam, earlierTeam)).toBeGreaterThan(0);
  });

  it('falls back to the entry id when due date and owner tie', () => {
    const first = entry();
    const second = entry({ id: testId(901) });
    expect(compareEntries(first, second)).toBeLessThan(0);
    expect(compareEntries(second, first)).toBeGreaterThan(0);

    // A user and team that tie still fall through to the id.
    const tiedTeam = entry({
      id: testId(902),
      owner: { userId: SUBJECTS.clinicianA, teamKey: 'billing' },
    });
    const tiedTeamSecond = entry({
      id: testId(903),
      owner: { userId: SUBJECTS.clinicianA, teamKey: 'billing' },
    });
    expect(compareEntries(tiedTeam, tiedTeamSecond)).toBeLessThan(0);
  });

  it('uses locale-independent code-unit order for the promised tie breakers', () => {
    const entries = ['entry.Write', 'entry.audit', 'entry.write'].map((id) => entry({ id }));

    expect(entries.sort(compareEntries).map(({ id }) => id)).toEqual([
      'entry.Write',
      'entry.audit',
      'entry.write',
    ]);
  });
});

describe('the administrative worklist', () => {
  it('lists open tasks and outstanding referrals, ordered by due date then owner', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      makeTaskRow({
        id: testId(501),
        title: 'A follow-up',
        dueAt: new Date('2026-08-22T09:00:00Z'),
      }),
      makeTaskRow({
        id: testId(502),
        title: 'Already late',
        // Even past the route clock, still an open task.
        dueAt: new Date('2026-08-10T09:00:00Z'),
      })
    );
    seed(dataset, 'Referral', makeReferralRow(testId(503), { specialtyDisplay: 'Dermatology' }));

    const body = await json<WorklistResponse>(await worklist(app));
    expect(body.page).toMatchObject({ page: 1, pageSize: 25, total: 3, totalPages: 1 });

    // Dated tasks first (overdue before not), the referral with its null due
    // date last.
    expect(entryIds(body)).toStrictEqual([testId(502), testId(501), testId(503)]);

    const task = body.data.find((entry) => entry.id === testId(501));
    expect(task).toMatchObject({
      source: 'task',
      id: testId(501),
      patientId: PATIENT,
      title: 'A follow-up',
      status: 'OPEN',
      owner: { userId: SUBJECTS.clinicianA, teamKey: null },
      dueAt: '2026-08-22T09:00:00.000Z',
      overdue: false,
      blockedBy: null,
      href: `/bff/v0/tasks/${testId(501)}`,
    });

    const referral = body.data.find((entry) => entry.source === 'referral');
    expect(referral).toMatchObject({
      source: 'referral',
      id: testId(503),
      patientId: PATIENT,
      title: 'Dermatology',
      status: 'SENT',
      owner: { userId: SUBJECTS.clinicianA, teamKey: null },
      dueAt: null,
      overdue: false,
      blockedBy: 'an appointment',
      href: `/bff/v0/referrals/${testId(503)}`,
    });

    // An admin holds both doors, so nothing is withheld.
    expect(body.withheld).toStrictEqual({ sources: [] });
  });

  it('calls an open task overdue when its due date is before the route clock', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      makeTaskRow({ id: testId(501), dueAt: new Date('2026-08-10T09:00:00Z') }),
      makeTaskRow({ id: testId(502), dueAt: null })
    );

    const body = await json<WorklistResponse>(await worklist(app));
    const overdue = body.data.find((entry) => entry.id === testId(501));
    if (overdue === undefined) throw new Error('missing overdue task');
    expect(overdue.overdue).toBe(true);
    const undated = body.data.find((entry) => entry.id === testId(502));
    // A null due date is never overdue, whatever the clock says.
    if (undated === undefined) throw new Error('missing undated task');
    expect(undated.overdue).toBe(false);
  });

  it('breaks due-date ties by owner, then falls back to the id', async () => {
    const { app, dataset } = harness();
    const DUE = new Date('2026-08-20T09:00:00.000Z');
    seed(
      dataset,
      'Task',
      // Same due, same user, null team: the two closest ties sort by id.
      makeTaskRow({ id: testId(511), dueAt: DUE }),
      makeTaskRow({ id: testId(512), dueAt: DUE }),
      // Same due, different user: sorts before the same-user pair.
      makeTaskRow({ id: testId(513), dueAt: DUE, assigneeUserId: SUBJECTS.billerA })
    );
    // Same due, same user but a named team: a non-null team sorts before a
    // null one once the user ties.
    seed(
      dataset,
      'Task',
      makeTaskRow({
        id: testId(514),
        dueAt: DUE,
        assigneeType: 'TEAM',
        assigneeUserId: null,
        assigneeTeamKey: 'front-desk',
      })
    );

    const body = await json<WorklistResponse>(await worklist(app));
    expect(entryIds(body)).toStrictEqual([testId(511), testId(512), testId(513), testId(514)]);
    expect(body.withheld).toStrictEqual({ sources: [] });
  });

  it('sorts entries without a due date after every dated one', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      makeTaskRow({ id: testId(521), dueAt: new Date('2026-08-20T09:00:00.000Z') })
    );
    seed(dataset, 'Referral', makeReferralRow(testId(522)));
    // An undated task sorts with the referrals, after every dated task, no
    // matter where the rows arrived in the two source lists.
    seed(dataset, 'Task', makeTaskRow({ id: testId(523), dueAt: null }));

    const body = await json<WorklistResponse>(await worklist(app));
    expect(entryIds(body)).toStrictEqual([testId(521), testId(522), testId(523)]);
  });

  it('leaves closed tasks and closed referrals off the worklist', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      makeTaskRow({ id: testId(501), status: 'DONE' }),
      makeTaskRow({ id: testId(502), status: 'CANCELLED' }),
      makeTaskRow({ id: testId(503), status: 'EXPIRED' })
    );
    seed(
      dataset,
      'Referral',
      makeReferralRow(testId(504), { status: 'DRAFT' }),
      makeReferralRow(testId(505), { status: 'COMPLETED' })
    );

    const body = await json<WorklistResponse>(await worklist(app));
    expect(body.data).toHaveLength(0);
    expect(body.page.total).toBe(0);
    // A zero-result worklist still has a pager to render.
    expect(body.page.totalPages).toBe(1);
  });

  it('keeps IN_PROGRESS and ON_HOLD tasks on the worklist', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      makeTaskRow({ id: testId(501), status: 'IN_PROGRESS' }),
      makeTaskRow({ id: testId(502), status: 'ON_HOLD' })
    );

    const body = await json<WorklistResponse>(await worklist(app));
    expect(body.data).toHaveLength(2);
  });

  it('narrows tasks by due date window and leaves the referral half whole', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      makeTaskRow({ id: testId(501), dueAt: new Date('2026-08-10T09:00:00Z') }),
      makeTaskRow({ id: testId(502), dueAt: new Date('2026-08-22T09:00:00Z') })
    );
    seed(dataset, 'Referral', makeReferralRow(testId(503)));

    const body = await json<WorklistResponse>(
      await worklist(app, TOKENS.adminA, '?from=2026-08-15T00:00:00.000Z')
    );
    // Only the task due inside the window is dated; the referral carries no due
    // date in this model, so it is the whole open tray regardless of the window.
    expect(entryIds(body)).toStrictEqual([testId(502), testId(503)]);
  });

  it('withholds the referral half from a caller holding task.read but not order.read', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Task', makeTaskRow({ id: testId(501) }));
    seed(dataset, 'Referral', makeReferralRow(testId(502)));

    const body = await json<WorklistResponse>(await worklist(app, TOKENS.frontDeskA));
    expect(entryIds(body)).toStrictEqual([testId(501)]);
    expect(body.withheld).toStrictEqual({ sources: ['referral'] });
  });

  it('refuses the worklist to a caller without task.read', async () => {
    const { app } = harness();
    const res = await worklist(app, UNPRIVILEGED_TOKEN);
    expect(res.status).toBe(403);
  });

  it('refuses the whole worklist when a source names a chart out of reach', async () => {
    /*
     * The same page gate `GET /bff/v0/tasks` and `GET /bff/v0/referrals` run
     * over their rows: a page spanning charts either has a relationship with
     * each or refuses the page (#300 / #322). The worklist is not exempted
     * because it names no chart in the URL - that is exactly why it must name
     * every chart it returns.
     */
    const { app, dataset } = harness();
    seed(dataset, 'Patient', makePatientRow({ id: SECOND_PATIENT }));
    seed(dataset, 'Task', makeTaskRow({ id: testId(501), patientId: SECOND_PATIENT }));

    // No appointment at SECOND_PATIENT's name, so the facility-activity source
    // does not answer for this chart.
    const res = await worklist(app);
    expect(res.status).toBe(404);
  });

  it('pages the merged, sorted list', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'Task',
      ...Array.from({ length: 3 }, (_, index) =>
        makeTaskRow({ id: testId(600 + index), dueAt: new Date(`2026-08-2${index + 1}T09:00:00Z`) })
      )
    );

    const body = await json<WorklistResponse>(
      await worklist(app, TOKENS.adminA, '?page=2&pageSize=2')
    );
    expect(body.page).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(body.data).toHaveLength(1);
  });
});

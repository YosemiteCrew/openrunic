import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import { parseQuery } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import { byIdentifier } from '../policy/permissions.js';
import type { ScopedRow } from '../repositories/rows.js';
import {
  worklistQuerySchema,
  worklistResponseSchema,
  type WorklistEntry,
  type WorklistSource,
} from '../schemas/admin.js';
import { windowOf } from '../schemas/pagination.js';
import { CRUD_ERRORS } from './crud.js';
import { gateCharts, policyOf, repositories } from './helpers.js';
import { awaiting } from './referrals.js';

/**
 * THE ADMINISTRATIVE WORKLIST.
 *
 * One route that puts the two open-work doors side by side: an open task
 * (through `task.read`) and an outstanding referral (through `order.read`).
 * It exists so a practice administrator sees "what needs action" in one place
 * instead of reading two collections and reconciling them by eye.
 *
 * The route is gated on `task.read` because every seeded role that holds
 * `order.read` also holds `task.read` - there is no role that reaches the
 * referral half without the task half. Whether the referral half is actually
 * served depends on `order.read`, checked in the handler rather than at the
 * door: a caller holding the task door but not the order door still gets the
 * task half, and the referral source is withheld explicitly rather than shown
 * empty, because an empty list reads as "all caught up" and that is a statement
 * the caller's permission does not entitle it to make.
 *
 * The window narrows the TASK half by due date; referrals are the whole open
 * tray. Referrals have no due date in this model - the entry says so with a
 * null `dueAt` - so there is nothing to date-filter, and hiding them because
 * they were created outside a window would hide work the caller asked to see.
 */

/**
 * Cap on the rows read from each source to assemble one page.
 *
 * The list is merged and re-sorted across both sources, so an entry's page
 * depends on rows from the other tray and the sources cannot be paged
 * individually. That leaves a bound as the only thing between a queue route and
 * a request for every open row in the practice. A source with more than this is
 * reported in `truncated` rather than silently cut, because a partial tray
 * counted as a whole one is the failure worth avoiding here.
 */
const WORKLIST_LIMIT = 5000;

/** The task statuses that mean the work is still in flight. */
const OPEN_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] as const;

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toEntry(now: Date, task: ScopedRow<'Task'>): WorklistEntry {
  return {
    source: 'task',
    id: task.id,
    patientId: task.patientId,
    title: task.title,
    status: task.status,
    owner: { userId: task.assigneeUserId, teamKey: task.assigneeTeamKey },
    dueAt: iso(task.dueAt),
    overdue: task.dueAt !== null && task.dueAt.getTime() < now.getTime(),
    // A task is not blocked: whatever it waits on is a task of its own.
    blockedBy: null,
    // The web workflow screens do not exist yet, so the link is the source's
    // own BFF resource; when the screens land the client supplies the shell.
    href: `/bff/v0/tasks/${task.id}`,
  };
}

function toReferralEntry(referral: ScopedRow<'Referral'>): WorklistEntry {
  return {
    source: 'referral',
    id: referral.id,
    patientId: referral.patientId,
    // The work, in one line: the specialty is what the referral is for.
    title: referral.specialtyDisplay,
    status: referral.status,
    owner: { userId: referral.referredById, teamKey: null },
    dueAt: null,
    // Null due dates are never overdue, whatever today's clock says.
    overdue: false,
    blockedBy: awaiting(referral),
    href: `/bff/v0/referrals/${referral.id}`,
  };
}

/**
 * A deterministic order for the mixed list. Dates ascending, so the most
 * overdue task surfaces first; then the named owner; then the id, so two rows
 * that are equal on date and owner still render in a stable order. Rows with
 * no due date sort last, the same rule `GET /bff/v0/tasks` applies when it
 * sorts by `dueAt`.
 */
export function compareEntries(left: WorklistEntry, right: WorklistEntry): number {
  const comparisons = [
    byNullableIdentifier(left.dueAt, right.dueAt),
    byNullableIdentifier(left.owner.userId, right.owner.userId),
    byNullableIdentifier(left.owner.teamKey, right.owner.teamKey),
    byIdentifier(left.id, right.id),
  ];
  return comparisons.find((comparison) => comparison !== 0) ?? 0;
}

/** Machine identifiers sort by code unit, with absent values last. */
function byNullableIdentifier(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return byIdentifier(left, right);
}

const ADMIN_WORKLIST_CONTRACT: RouteContract = {
  method: 'get',
  path: '/bff/v0/admin/worklist',
  operationId: 'getAdminWorklist',
  summary: 'The administrative worklist.',
  description:
    'Open tasks and outstanding referrals across the practice, one entry per source, ordered by due date and owner. The window narrows tasks by due date; the referral half is the whole open tray. Callers holding `task.read` but not `order.read` receive the task half with the referral source withheld explicitly rather than shown empty. A source with more outstanding work than one assembly reads is named in `truncated`, so `total` is never read as the whole tray.',
  tags: ['admin'],
  permission: 'task.read',
  query: worklistQuerySchema,
  responses: [
    {
      status: 200,
      description:
        'One page of the worklist, plus which sources were withheld and which were truncated.',
      schema: worklistResponseSchema,
    },
    ...CRUD_ERRORS,
  ],
};

export interface AdminRouteOptions {
  /** The clock. See `InternalRouteOptions.now`. */
  now: () => Date;
}

export function adminRoutes(options: AdminRouteOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/admin/worklist', requirePermission('task.read'), async (c: Context<AppEnv>) => {
    const query = parseQuery(c, worklistQuerySchema);
    const now = options.now();
    const repos = repositories(c);
    const maySeeOrders = policyOf(c)?.can('order.read') ?? false;

    /*
     * ONE read over the three open statuses, not one read each. Read
     * separately, a task moving from `OPEN` to `IN_PROGRESS` between two of
     * the reads appears in both result sets or in neither, so the worklist
     * duplicates a task or briefly loses live work - and it does so under
     * exactly the concurrent task updates this queue exists to show.
     */
    const taskPage = await repos.tasks.list({
      page: 1,
      pageSize: WORKLIST_LIMIT,
      sort: 'dueAt',
      order: 'asc',
      statusIn: OPEN_TASK_STATUSES,
      ...windowOf(query),
    });
    const taskRows = taskPage.rows;

    // The same care-relationship gate `GET /bff/v0/tasks` runs over the same
    // rows - this queue names no chart in the URL, which is exactly why it must
    // name every chart it returns (the #300 lesson from collections).
    await gateCharts(c, 'tasks', taskRows);

    let referralRows: ScopedRow<'Referral'>[] = [];
    let referralTotal = 0;
    if (maySeeOrders) {
      const reply = await repos.referrals.list({
        page: 1,
        pageSize: WORKLIST_LIMIT,
        sort: 'createdAt',
        order: 'asc',
        openOnly: true,
      });
      referralRows = reply.rows;
      referralTotal = reply.total;
      // Referrals carry a chart (`patientId` on the row), so the same gate
      // applies as the addressed read. Refused as a whole rather than dropping
      // the row, exactly as `GET /bff/v0/referrals` behaves.
      await gateCharts(c, 'referrals', referralRows);
    }

    const entries: WorklistEntry[] = [
      ...taskRows.map((row) => toEntry(now, row)),
      ...referralRows.map(toReferralEntry),
    ].sort(compareEntries);

    const offset = (query.page - 1) * query.pageSize;
    const data = entries.slice(offset, offset + query.pageSize);

    /*
     * `total` counts the rows assembled, so it is exact about what this list
     * can reach and says nothing about what the cap left behind. The marker is
     * what says that, per source, and it is read from the repository's own
     * total rather than by comparing the row count to WORKLIST_LIMIT: a tray
     * holding exactly the cap is complete, and a fixture built from the
     * constant could not tell the two apart.
     */
    const truncated: WorklistSource[] = [];
    if (taskPage.total > taskRows.length) truncated.push('task');
    if (referralTotal > referralRows.length) truncated.push('referral');

    return c.json({
      data,
      page: {
        page: query.page,
        pageSize: query.pageSize,
        total: entries.length,
        // A zero-result worklist has one (empty) page, not zero pages.
        totalPages: Math.max(1, Math.ceil(entries.length / query.pageSize)),
      },
      withheld: { sources: maySeeOrders ? [] : ['referral'] },
      truncated: { sources: truncated },
    });
  });

  return router;
}

export function adminRouteContracts(): RouteContract[] {
  return [ADMIN_WORKLIST_CONTRACT];
}

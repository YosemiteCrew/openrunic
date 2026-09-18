import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppEnv } from '../context.js';
import { parseQuery } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { ScopedRow } from '../repositories/rows.js';
import {
  worklistQuerySchema,
  worklistResponseSchema,
  type WorklistEntry,
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

/** Cap on the statements and referrals read to assemble one page. */
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
  if (left.dueAt !== null && right.dueAt !== null) {
    const byDue = left.dueAt.localeCompare(right.dueAt);
    if (byDue !== 0) return byDue;
  } else if (left.dueAt === null && right.dueAt !== null) {
    return 1;
  } else if (left.dueAt !== null && right.dueAt === null) {
    return -1;
  }
  if (left.owner.userId !== null && right.owner.userId !== null) {
    const byUser = left.owner.userId.localeCompare(right.owner.userId);
    if (byUser !== 0) return byUser;
  } else if (left.owner.userId === null && right.owner.userId !== null) {
    return 1;
  } else if (left.owner.userId !== null && right.owner.userId === null) {
    return -1;
  }
  if (left.owner.teamKey !== null && right.owner.teamKey !== null) {
    const byTeam = left.owner.teamKey.localeCompare(right.owner.teamKey);
    if (byTeam !== 0) return byTeam;
  } else if (left.owner.teamKey === null && right.owner.teamKey !== null) {
    return 1;
  } else if (left.owner.teamKey !== null && right.owner.teamKey === null) {
    return -1;
  }
  return left.id.localeCompare(right.id);
}

const ADMIN_WORKLIST_CONTRACT: RouteContract = {
  method: 'get',
  path: '/bff/v0/admin/worklist',
  operationId: 'getAdminWorklist',
  summary: 'The administrative worklist.',
  description:
    'Open tasks and outstanding referrals across the practice, one entry per source, ordered by due date and owner. The window narrows tasks by due date; the referral half is the whole open tray. Callers holding `task.read` but not `order.read` receive the task half with the referral source withheld explicitly rather than shown empty.',
  tags: ['admin'],
  permission: 'task.read',
  query: worklistQuerySchema,
  responses: [
    {
      status: 200,
      description: 'One page of the worklist, plus which sources were withheld.',
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

    const taskPages = await Promise.all(
      OPEN_TASK_STATUSES.map((status) =>
        repos.tasks.list({
          page: 1,
          pageSize: WORKLIST_LIMIT,
          sort: 'dueAt',
          order: 'asc',
          status,
          ...windowOf(query),
        })
      )
    );
    const taskRows = taskPages.flatMap((page) => page.rows);

    // The same care-relationship gate `GET /bff/v0/tasks` runs over the same
    // rows - this queue names no chart in the URL, which is exactly why it must
    // name every chart it returns (the #300 lesson from collections).
    await gateCharts(c, 'tasks', taskRows);

    let referralRows: ScopedRow<'Referral'>[] = [];
    if (maySeeOrders) {
      const reply = await repos.referrals.list({
        page: 1,
        pageSize: WORKLIST_LIMIT,
        sort: 'createdAt',
        order: 'asc',
        openOnly: true,
      });
      referralRows = reply.rows;
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
    });
  });

  return router;
}

export function adminRouteContracts(): RouteContract[] {
  return [ADMIN_WORKLIST_CONTRACT];
}

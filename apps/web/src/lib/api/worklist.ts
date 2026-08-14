'use client';

import { queryKey, useApiQuery } from './hooks';
import type { AsyncState } from './hooks';
import {
  MOCK_INBOX_ITEMS,
  MOCK_ORDERS,
  MOCK_ORDER_CATALOG,
  MOCK_ORDER_WARNINGS,
  MOCK_PATIENT_PROBLEMS,
  MOCK_RESULTS,
} from './mock/fixtures';
import type { ListResponse } from './types';

/**
 * Orders, results and the typed inbox.
 *
 * `apps/api` serves `/bff/v0/orders` and `/bff/v0/results`, transitions
 * included. What is missing is not the routes but the mapping from those
 * payloads into the view types below, which is a change of its own; the inbox
 * is the exception, a composition across results, messages and tasks that the
 * API does not assemble and has no segment for. So this module is the seam that
 * lets the screens exist meanwhile: the same `AsyncState` shape the rest of the
 * data layer returns, the same injectable-client convention as
 * {@link HookOptions}, and fixtures that live in the one mock module rather
 * than a parallel one. When the mapping is written, the types below move to
 * `types.ts`, `createWorklistClient` becomes an HTTP client, and no screen
 * changes.
 *
 * Everything here is pure and deterministic. Nothing reads the clock: SLA and
 * age are always computed against an explicit `now`, so a test and a screenshot
 * see the same clinic day.
 */

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

/** The three things a clinician orders from one surface (guidelines OR-01). */
export const ORDER_CATEGORIES = ['LAB', 'IMAGING', 'PROCEDURE'] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];

export const ORDER_PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

/** The order ledger's lifecycle, first-class like a claim's (guidelines OR-03). */
export const ORDER_STATUSES = [
  'PENDED',
  'SIGNED',
  'TRANSMITTED',
  'IN_PROGRESS',
  'RESULTED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** One coded problem on a patient's list. Ranks the catalogue and justifies an order. */
export interface PatientProblem {
  /** ICD-10, because that is what justifies a charge downstream. */
  code: string;
  display: string;
  onset: string;
}

/** One orderable thing, as the catalogue holds it. */
export interface OrderCatalogEntry {
  /** Stable catalogue id, rendered in `.or-mono`. */
  code: string;
  name: string;
  category: OrderCategory;
  /** Null for imaging and procedures: nothing is collected. */
  specimen: string | null;
  /** Where a signed order goes. From the destination catalogue, never typed. */
  destination: string;
  /** Pinned by this clinician: one click, everything pre-filled. */
  favourite: boolean;
  /** Problem codes this order is commonly placed for. Drives ranking. */
  problemCodes: string[];
  /** What a tired person types instead of the name. */
  keywords: string[];
  turnaround: string;
}

/** The four alert tiers, minus the passive one, as an order composer needs them. */
export const WARNING_TIERS = ['INFO', 'CAUTION', 'CRITICAL'] as const;
export type WarningTier = (typeof WARNING_TIERS)[number];

export interface OrderWarning {
  id: string;
  /** The catalogue entry that raises it. */
  orderCode: string;
  /** Null when the warning applies to every patient. */
  patientId: string | null;
  tier: WarningTier;
  title: string;
  /** What is true and what to do about it. One or two sentences. */
  detail: string;
  /** CRITICAL only: signing is blocked until one of these is chosen. */
  overrideReasons?: string[];
}

export interface Order {
  id: string;
  patientId: string;
  code: string;
  name: string;
  category: OrderCategory;
  status: OrderStatus;
  priority: OrderPriority;
  /** ISO instant. */
  placedAt: string;
  /** ISO instant of the last lifecycle event, for the age-in-state chip. */
  lastEventAt: string;
  providerId: string;
  destination: string;
  specimen: string | null;
  diagnosisCode: string | null;
  diagnosisDisplay: string | null;
  /** Set once a report exists, so the ledger row can link to it. */
  resultId: string | null;
  cancelReason: string | null;
}

export interface OrderListQuery {
  patientId?: string;
  status?: OrderStatus;
  category?: OrderCategory;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

/** The triage flag, always rendered as a word beside its colour. */
export const RESULT_FLAGS = ['NORMAL', 'ABNORMAL', 'CRITICAL'] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];

export const RESULT_STATUSES = ['UNREVIEWED', 'SIGNED'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Who owns a piece of work: the signed-in clinician, or the shared pool. */
export const ASSIGNMENTS = ['ME', 'TEAM'] as const;
export type Assignment = (typeof ASSIGNMENTS)[number];

/** One prior value of an analyte, for the cumulative context in the reading pane. */
export interface PriorValue {
  /** ISO instant. */
  at: string;
  value: number;
}

export interface ResultAnalyte {
  code: string;
  label: string;
  /** Null when the lab reported the analyte without a value. */
  value: number | null;
  unit: string;
  /** Reference bounds; either end may be open. */
  low?: number;
  high?: number;
  decimals?: number;
  /** Newest first, at most three. */
  previous?: PriorValue[];
}

export interface ResultReport {
  id: string;
  orderId: string | null;
  patientId: string;
  /** "Comprehensive metabolic panel", "Chest X-ray, two views". */
  panel: string;
  category: OrderCategory;
  /** ISO instant. */
  collectedAt: string;
  /** ISO instant. */
  reportedAt: string;
  flag: ResultFlag;
  status: ResultStatus;
  performer: string;
  orderedBy: string;
  assignedTo: Assignment;
  analytes: ResultAnalyte[];
  /** Imaging and procedure reports read as prose rather than a value table. */
  narrative: string | null;
}

export interface ResultListQuery {
  assignedTo?: Assignment;
  flag?: ResultFlag;
  status?: ResultStatus;
  patientId?: string;
}

/* -------------------------------------------------------------------------- */
/* Inbox                                                                       */
/* -------------------------------------------------------------------------- */

/** The five typed streams of guidelines C13. Order is the order they render in. */
export const INBOX_STREAMS = ['RESULTS', 'MESSAGES', 'REFILLS', 'COSIGN', 'TASKS'] as const;
export type InboxStream = (typeof INBOX_STREAMS)[number];

export interface InboxItem {
  id: string;
  stream: InboxStream;
  /** Null for a practice-level task that belongs to nobody's chart. */
  patientId: string | null;
  /** The work, in one line. */
  summary: string;
  /** The detail a disposition needs, without opening anything. */
  detail: string;
  /** ISO instant. */
  receivedAt: string;
  /** ISO instant the practice promised itself. Drives the SLA chip. */
  dueAt: string;
  assignedTo: Assignment;
  unread: boolean;
  /** The one action that finishes this item in the row: "Approve refill". */
  actionLabel: string;
  /** What the toast says once it is done: "Refill approved". */
  doneLabel: string;
  /** Where the full context lives, when there is more to see. */
  href: string | null;
}

export interface InboxListQuery {
  stream?: InboxStream;
  assignedTo?: Assignment;
}

/* -------------------------------------------------------------------------- */
/* Derived state                                                               */
/* -------------------------------------------------------------------------- */

export type SlaState = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE';

/** Anything due inside this window reads as due soon rather than comfortable. */
const DUE_SOON_MINUTES = 240;

/**
 * The SLA state of one work item.
 *
 * The label is the signal; the tone is decoration on top of it. That is the
 * colour-never-alone rule applied to the one chip a tired person scans for.
 */
export function slaState(dueAt: string, now: string): SlaState {
  const minutes = (new Date(dueAt).getTime() - new Date(now).getTime()) / 60_000;
  if (Number.isNaN(minutes)) return 'ON_TIME';
  if (minutes < 0) return 'OVERDUE';
  return minutes <= DUE_SOON_MINUTES ? 'DUE_SOON' : 'ON_TIME';
}

/**
 * A critical result never leaves the queue in a batch: someone reads it, and
 * the queue makes that impossible to skip.
 */
export function isBulkSignable(report: ResultReport): boolean {
  return report.status === 'UNREVIEWED' && report.flag === 'NORMAL';
}

/** The patient's coded problem list. Empty rather than absent for an unknown id. */
export function patientProblems(patientId: string | null): PatientProblem[] {
  if (!patientId) return [];
  return MOCK_PATIENT_PROBLEMS[patientId] ?? [];
}

/**
 * The catalogue, ranked for this patient.
 *
 * Ranking is the whole point of the screen: The legacy procedure order form made
 * a clinician re-find the same eight tests every day. Favourites first, then
 * anything the patient's problem list makes likely, then name matches, then the
 * rest, and a typed query narrows before any of that applies.
 */
export function rankCatalog(
  query: string,
  problems: PatientProblem[],
  catalog: readonly OrderCatalogEntry[] = MOCK_ORDER_CATALOG
): OrderCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  const problemCodes = new Set(problems.map((problem) => problem.code));

  const matches = catalog.filter((entry) => {
    if (!needle) return true;
    const haystack = [entry.name, entry.code, entry.category, ...entry.keywords]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  return [...matches].sort(
    (a, b) => score(b, needle, problemCodes) - score(a, needle, problemCodes)
  );
}

function score(entry: OrderCatalogEntry, needle: string, problemCodes: Set<string>): number {
  let value = 0;
  if (needle && entry.name.toLowerCase().startsWith(needle)) value += 8;
  if (entry.problemCodes.some((code) => problemCodes.has(code))) value += 4;
  if (entry.favourite) value += 2;
  return value;
}

/** Every warning the drafted codes raise for this patient, criticals first. */
export function warningsFor(
  patientId: string | null,
  codes: readonly string[],
  warnings: readonly OrderWarning[] = MOCK_ORDER_WARNINGS
): OrderWarning[] {
  const drafted = new Set(codes);
  const rank: Record<WarningTier, number> = { CRITICAL: 0, CAUTION: 1, INFO: 2 };
  const relevant = warnings.filter(
    (warning) =>
      drafted.has(warning.orderCode) &&
      (warning.patientId === null || warning.patientId === patientId)
  );
  return relevant.sort((a, b) => rank[a.tier] - rank[b.tier]);
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export function filterOrders(rows: readonly Order[], query: OrderListQuery = {}): Order[] {
  return rows.filter((order) => {
    if (query.patientId && order.patientId !== query.patientId) return false;
    if (query.status && order.status !== query.status) return false;
    if (query.category && order.category !== query.category) return false;
    return true;
  });
}

export function filterResults(
  rows: readonly ResultReport[],
  query: ResultListQuery = {}
): ResultReport[] {
  return rows.filter((report) => {
    if (query.assignedTo && report.assignedTo !== query.assignedTo) return false;
    if (query.flag && report.flag !== query.flag) return false;
    if (query.status && report.status !== query.status) return false;
    if (query.patientId && report.patientId !== query.patientId) return false;
    return true;
  });
}

export function filterInbox(rows: readonly InboxItem[], query: InboxListQuery = {}): InboxItem[] {
  return rows.filter((item) => {
    if (query.stream && item.stream !== query.stream) return false;
    if (query.assignedTo && item.assignedTo !== query.assignedTo) return false;
    return true;
  });
}

function page<T>(rows: T[]): ListResponse<T> {
  return {
    data: rows,
    // One page: these worklists are designed to be short enough to finish.
    page: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 },
  };
}

/** The read surface the three screens share. An HTTP client will satisfy it too. */
export interface WorklistClient {
  orders: { list: (query?: OrderListQuery) => Promise<ListResponse<Order>> };
  results: { list: (query?: ResultListQuery) => Promise<ListResponse<ResultReport>> };
  inbox: { list: (query?: InboxListQuery) => Promise<ListResponse<InboxItem>> };
}

export interface WorklistData {
  orders: readonly Order[];
  results: readonly ResultReport[];
  inbox: readonly InboxItem[];
}

/**
 * A client over fixture rows. Tests pass their own rows to reach the empty
 * state, and their own rejecting client to reach the error state.
 */
export function createWorklistClient(data: Partial<WorklistData> = {}): WorklistClient {
  const orders = data.orders ?? MOCK_ORDERS;
  const results = data.results ?? MOCK_RESULTS;
  const inbox = data.inbox ?? MOCK_INBOX_ITEMS;

  return {
    orders: { list: (query) => Promise.resolve(page(filterOrders(orders, query))) },
    results: { list: (query) => Promise.resolve(page(filterResults(results, query))) },
    inbox: { list: (query) => Promise.resolve(page(filterInbox(inbox, query))) },
  };
}

/** The app's client. Mock-backed until the aggregates exist in `apps/api`. */
export const worklist: WorklistClient = createWorklistClient();

export interface WorklistHookOptions {
  /** Injectable for tests. Defaults to the app's client. */
  client?: WorklistClient;
  enabled?: boolean;
}

export function useOrders(
  query: OrderListQuery = {},
  options: WorklistHookOptions = {}
): AsyncState<ListResponse<Order>> {
  const client = options.client ?? worklist;
  return useApiQuery(queryKey('orders.list', { ...query }), () => client.orders.list(query), {
    enabled: options.enabled,
  });
}

export function useResults(
  query: ResultListQuery = {},
  options: WorklistHookOptions = {}
): AsyncState<ListResponse<ResultReport>> {
  const client = options.client ?? worklist;
  return useApiQuery(queryKey('results.list', { ...query }), () => client.results.list(query), {
    enabled: options.enabled,
  });
}

export function useInbox(
  query: InboxListQuery = {},
  options: WorklistHookOptions = {}
): AsyncState<ListResponse<InboxItem>> {
  const client = options.client ?? worklist;
  return useApiQuery(queryKey('inbox.list', { ...query }), () => client.inbox.list(query), {
    enabled: options.enabled,
  });
}

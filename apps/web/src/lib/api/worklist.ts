'use client';

import { api } from './api';
import { API_MODE } from './config';
import { queryKey, useApiQuery, useOwnCapabilities } from './hooks';
import type { AsyncState } from './hooks';
import {
  MOCK_INBOX_ITEMS,
  MOCK_ORDERS,
  MOCK_ORDER_CATALOG,
  MOCK_ORDER_WARNINGS,
  MOCK_PATIENT_PROBLEMS,
  MOCK_RESULTS,
} from './mock/fixtures';
import { paginate } from './pagination';
import type {
  ApiClient,
  DiagnosticReportDto,
  DiagnosticReportListQuery,
  ListResponse,
  PaginationQuery,
  ResultObservationDto,
  ServiceRequestDto,
  TaskDto,
  TaskKind,
  TaskListQuery,
} from './types';

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
  /** Null until a lab is chosen: nothing is transmitted to a destination yet. */
  destination: string | null;
  specimen: string | null;
  diagnosisCode: string | null;
  diagnosisDisplay: string | null;
  /** Set once a report exists, so the ledger row can link to it. */
  resultId: string | null;
  cancelReason: string | null;
}

/**
 * `PaginationQuery` because the route paginates whether or not the caller says
 * so: `/bff/v0/orders` defaults to 25 rows and clamps at `MAX_PAGE_SIZE`. A
 * query with no `pageSize` does not mean "every order", it means "the first
 * 25", and a screen that could not spell the field could not ask for anything
 * else (#539). Asking is only half of it - the window is smaller than the match
 * whenever the clinic is busier than the clamp, so the screen states it too.
 */
export interface OrderListQuery extends PaginationQuery {
  patientId?: string;
  status?: OrderStatus;
  category?: OrderCategory;
}

/**
 * A service request as the order ledger reads it, or null when the ledger has
 * no word for what the row is.
 *
 * The domain enums are strictly wider than this screen's, and neither width is
 * an oversight. `SERVICE_REQUEST_CATEGORIES` carries REFERRAL and THERAPY,
 * `SERVICE_REQUEST_STATUSES` carries DRAFT, COMPLETED and ENTERED_IN_ERROR, and
 * the database's `ORDER_PRIORITIES` carries ASAP; OR-01 fixes this surface to
 * the three things a clinician orders from it and OR-03 to the six states the
 * ledger tracks.
 *
 * Whether a referral belongs on this screen at all, and whether an ASAP order
 * wears the URGENT badge or the STAT one, are product decisions open as #535.
 * Until they are answered this returns null rather than guessing, because a
 * guess is a wrong word on a clinical row - an ASAP order shown as URGENT reads
 * as less urgent than it is, to the one person who could act on the difference -
 * whereas a null is a row the caller can count and say so about.
 */
export function toOrder(dto: ServiceRequestDto): Order | null {
  const category = viewValue(ORDER_CATEGORIES, dto.category);
  const status = viewValue(ORDER_STATUSES, dto.status);
  const priority = viewValue(ORDER_PRIORITIES, dto.priority);
  if (category === undefined || status === undefined || priority === undefined) return null;

  return {
    id: dto.id,
    patientId: dto.patientId,
    code: dto.code,
    name: dto.display,
    category,
    status,
    priority,
    placedAt: dto.requestedAt,
    lastEventAt: dto.updatedAt,
    providerId: dto.orderedById,
    destination: dto.performingLabName,
    specimen: dto.specimenTypeCode,
    diagnosisCode: dto.reasonCodes[0] ?? null,
    /* The remaining three have no source yet, all of them open in #535:
       `reasonCodes` are ICD-10 codes with no display beside them, the order to
       report link is held on the report rather than the order, and
       `ServiceRequest` has no cancellation reason column at all. They are
       nullable on the view type and the screen already renders them as absent,
       so a null here is the row rather than a placeholder for it. */
    diagnosisDisplay: null,
    resultId: null,
    cancelReason: null,
  };
}

/**
 * The domain value, when the view has that word too.
 *
 * A lookup rather than a cast: a cast would make every future widening of a
 * database enum arrive on the screen as a badge nobody defined, silently, and
 * the widening would be somewhere else entirely.
 */
function viewValue<T extends string>(view: readonly T[], value: string): T | undefined {
  return view.find((option) => option === value);
}

/**
 * A page of orders, with the rows the ledger refused counted rather than dropped.
 *
 * `page.total` counts what the API matched; `data` holds what {@link toOrder}
 * could render. The two are different numbers whenever the page contains a
 * referral, a draft or an ASAP order, and the difference is the whole reason
 * this type exists: a clinician reading "25 orders" above 22 rows has no way to
 * tell whether three are missing or three are elsewhere. So the count travels
 * with the page and the screen states it (#539). Discarding it inside the
 * mapping layer is what made it invisible.
 */
export interface OrderPage extends ListResponse<Order> {
  /** Rows on this page the ledger has no word for. Counted in `page.total`, absent from `data`. */
  refused: number;
}

/** One page of service requests, as the order ledger reads it. */
export function toOrderPage(response: ListResponse<ServiceRequestDto>): OrderPage {
  const data = response.data.map(toOrder).filter((order): order is Order => order !== null);
  return { data, page: response.page, refused: response.data.length - data.length };
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
  /**
   * Null when the lab reported no unit, which a qualitative analyte - a
   * culture, a presence - legitimately does. Nullable rather than `''` so the
   * reading pane can tell "no unit" from "a unit nobody filled in".
   */
  unit: string | null;
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
  /** ISO instant, null when no specimen collection time was recorded. */
  collectedAt: string | null;
  /** ISO instant. */
  reportedAt: string;
  flag: ResultFlag;
  status: ResultStatus;
  /** The laboratory, null when the report names none. */
  performer: string | null;
  /**
   * The ordering clinician's id, null when the report has no service request
   * behind it - and null on every live row until that join lands (#535).
   */
  orderedBy: string | null;
  /**
   * Whose queue this sits in, null where nothing records it.
   *
   * Assignment is a `Task` fact - `assigneeType`, `assigneeUserId`,
   * `assigneeTeamKey`, over the `RESULT` stream - and not a column on the
   * report, so a live row reads null until the report-to-task join lands
   * (#535). `reviewedById` is a different question: who signed it, not whose
   * work it is.
   */
  assignedTo: Assignment | null;
  /** Empty from a list: fetched per report, never per row. See {@link WorklistClient}. */
  analytes: ResultAnalyte[];
  /** Imaging and procedure reports read as prose rather than a value table. */
  narrative: string | null;
}

/**
 * `PaginationQuery` for the same reason `OrderListQuery` carries it:
 * `/bff/v0/results` paginates whether or not the caller says so, so a screen
 * that could not spell the field could not ask for anything but the first 25
 * (#539).
 *
 * `assignedTo` is answerable over fixtures and not over the route, which serves
 * no assignment filter at all. {@link liveResults} drops it rather than sending
 * something else, and {@link RESULT_ASSIGNMENT_IS_KNOWN} is how a screen finds
 * out before offering the control.
 */
export interface ResultListQuery extends PaginationQuery {
  assignedTo?: Assignment;
  flag?: ResultFlag;
  status?: ResultStatus;
  patientId?: string;
}

/**
 * One analyte, as the reading pane reads it.
 *
 * `decimals` and `previous` are absent rather than guessed: the observation DTO
 * carries neither a display precision nor the prior values of the same analyte,
 * and rendering 6.2 as 6.20 or an empty trend line would both be this layer
 * inventing laboratory context. Open in #535.
 */
export function toResultAnalyte(dto: ResultObservationDto): ResultAnalyte {
  return {
    code: dto.code,
    label: dto.display,
    value: dto.valueNumber,
    unit: dto.unit,
    ...(dto.referenceLow === null ? {} : { low: dto.referenceLow }),
    ...(dto.referenceHigh === null ? {} : { high: dto.referenceHigh }),
  };
}

/**
 * A diagnostic report as the sign-off queue reads it, or null when the queue
 * has no word for what the row is.
 *
 * Same refusal as {@link toOrder} and for the same reason: `category` is a
 * `SERVICE_REQUEST_CATEGORIES` on the wire and OR-01 fixes this surface to the
 * three things a clinician orders, so a REFERRAL report is refused and counted
 * rather than shown under a heading that is not its own.
 *
 * `status` is derived rather than read. The DTO's own `status` is a different
 * axis - `DIAGNOSTIC_REPORT_STATUSES` is the laboratory's correction
 * vocabulary, FINAL through CORRECTED - while this screen's is the sign-off
 * one, and `reviewedAt` is what the `/review` transition sets. Reading the
 * wrong one would show an amended report as unsigned work.
 */
export function toResultReport(dto: DiagnosticReportDto): ResultReport | null {
  const category = viewValue(ORDER_CATEGORIES, dto.category);
  if (category === undefined) return null;

  return {
    id: dto.id,
    orderId: dto.serviceRequestId,
    patientId: dto.patientId,
    panel: dto.display,
    category,
    collectedAt: dto.effectiveAt,
    reportedAt: dto.issuedAt,
    flag: dto.abnormalFlag,
    status: dto.reviewedAt === null ? 'UNREVIEWED' : 'SIGNED',
    performer: dto.performingLabName,
    /* Neither is on the report: the ordering clinician is on the service
       request one join away, and assignment is a `Task` fact. Null is the row
       rather than a placeholder for it, and the screen renders both as absent. */
    orderedBy: null,
    assignedTo: null,
    /* One `/results/{id}/observations` call per row would be N+1 on a list, so
       the list does not fetch them and the reading pane does, for the one
       report it is showing. */
    analytes: [],
    narrative: dto.narrative,
  };
}

/**
 * A page of reports, with the rows the queue refused counted rather than dropped.
 *
 * The same shape and the same argument as {@link OrderPage}: a clinician
 * reading "25 results" above 22 rows cannot tell whether three are missing or
 * three are elsewhere, so the difference travels with the page.
 */
export interface ResultPage extends ListResponse<ResultReport> {
  /** Rows on this page the queue has no word for. Counted in `page.total`, absent from `data`. */
  refused: number;
}

/** One page of diagnostic reports, as the sign-off queue reads it. */
export function toResultPage(response: ListResponse<DiagnosticReportDto>): ResultPage {
  const data = response.data
    .map(toResultReport)
    .filter((report): report is ResultReport => report !== null);
  return { data, page: response.page, refused: response.data.length - data.length };
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
  /** The detail a disposition needs, without opening anything. Absent on a bare task. */
  detail: string | null;
  /** ISO instant. */
  receivedAt: string;
  /**
   * ISO instant the practice promised itself. Drives the SLA chip.
   *
   * Null where nobody promised anything. A task with no due date is not the
   * most urgent one, so it sorts last and carries no chip rather than an
   * invented one.
   */
  dueAt: string | null;
  assignedTo: Assignment;
  /**
   * Null where this is not a fact the client can read.
   *
   * The API records no read receipt on a task, so a live row is neither unread
   * nor read. `false` would be a claim that somebody has looked at it.
   */
  unread: boolean | null;
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
export function slaState(dueAt: string | null, now: string): SlaState {
  if (dueAt === null) return 'ON_TIME';
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
  orders: { list: (query?: OrderListQuery) => Promise<OrderPage> };
  results: {
    list: (query?: ResultListQuery) => Promise<ResultPage>;
    /**
     * The analytes of one report.
     *
     * Separate from `list` because fetching them per row is N+1 on a queue that
     * exists to be scanned, and the one report open in the reading pane is the
     * only one whose values are read.
     *
     * A `ListResponse` rather than an array, because this collection paginates
     * too and a bare array cannot say that it is short: the reading pane is a
     * clinician deciding on values, and a table missing rows it does not
     * mention is the one shape this screen must not take.
     */
    analytes: (reportId: string) => Promise<ListResponse<ResultAnalyte>>;
  };
  inbox: { list: (query?: InboxListQuery) => Promise<InboxPage> };
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
    orders: {
      /* Paginated, unlike results and the inbox below, because `OrderListQuery`
         carries the window the route applies and a fixture client that ignored
         it would answer a question the live one does not.

         Refused is zero by construction: these rows are already `Order`s and
         never went through `toOrder`. */
      list: (query = {}) =>
        Promise.resolve({
          ...paginate(filterOrders(orders, query), query.page, query.pageSize),
          refused: 0,
        }),
    },
    /* Refused is zero by construction, as for orders above: these rows are
       already `ResultReport`s and never went through `toResultReport`. */
    results: {
      list: (query) => Promise.resolve({ ...page(filterResults(results, query)), refused: 0 }),
      analytes: (reportId) =>
        Promise.resolve(page(results.find((report) => report.id === reportId)?.analytes ?? [])),
    },
    /* The fixture rows are the whole inbox and every one of them is typed, so
       nothing is refused here. The field still travels: a screen reading it
       only in live mode would be a screen nothing in the demo build exercises. */
    inbox: { list: (query) => Promise.resolve({ ...page(filterInbox(inbox, query)), refused: 0 }) },
  };
}

/**
 * The orders half of {@link WorklistClient}, over `GET /bff/v0/orders`.
 *
 * `OrderListQuery` is assignable to `ServiceRequestListQuery` because the view
 * enums are subsets of the domain ones; that is the same narrowing `toOrder`
 * enforces on the way back, read from the other end.
 */
export function liveOrders(client: ApiClient): WorklistClient['orders'] {
  return { list: (query = {}) => client.orders.list(query).then(toOrderPage) };
}

/**
 * `ResultListQuery` as `/bff/v0/results` can answer it.
 *
 * Three of the four view filters have a served field. `assignedTo` does not -
 * `diagnosticReportListQuerySchema` carries no assignment filter, because
 * assignment is not a column on the report - and it is dropped here rather than
 * translated into the nearest thing, because the nearest thing is
 * `reviewedById`, which answers who signed a result and not whose queue it is
 * in. A screen must not offer the control over this client; see
 * {@link RESULT_ASSIGNMENT_IS_KNOWN}.
 */
export function toReportQuery(query: ResultListQuery): DiagnosticReportListQuery {
  return {
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
    ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
    ...(query.flag === undefined ? {} : { abnormalFlag: query.flag }),
    ...(query.status === undefined ? {} : { reviewed: query.status === 'SIGNED' }),
  };
}

/**
 * The widest page `/results/{id}/observations` will serve.
 *
 * `MAX_PAGE_SIZE` in `apps/api/src/schemas/pagination.ts`; asking for more is
 * rejected by the query schema rather than clamped. Asked for explicitly
 * because the route's DEFAULT is 25, and a reading pane that took the default
 * would render the first 25 analytes of a longer report as though they were all
 * of them. The residual is still reported - see {@link WorklistClient} - since
 * a panel longer than this is a fact about the laboratory, not one this layer
 * gets to rule out.
 */
const ANALYTE_PAGE_SIZE = 100;

/** The results half of {@link WorklistClient}, over `GET /bff/v0/results`. */
export function liveResults(client: ApiClient): WorklistClient['results'] {
  return {
    list: (query = {}) => client.results.list(toReportQuery(query)).then(toResultPage),
    analytes: (reportId) =>
      client.results
        .listObservations(reportId, { pageSize: ANALYTE_PAGE_SIZE })
        .then((response: ListResponse<ResultObservationDto>) => ({
          data: response.data.map(toResultAnalyte),
          page: response.page,
        })),
  };
}

/* ---------------------------------------------------------------- the inbox */

/**
 * The typed stream a task belongs to, or null for work this inbox has no word
 * for.
 *
 * Four of the nine task types are administrative - a fax, a document, a prior
 * authorisation, a claim exception - and belong to the practice administrator's
 * worklist (#475), not to a clinician's. Folding them into `TASKS` would put a
 * claim exception in a clinician's inbox, which is the thing the five typed
 * streams of C13 exist to prevent. They are refused and counted rather than
 * renamed; see {@link InboxPage}.
 */
function toStream(type: TaskKind): InboxStream | null {
  if (type === 'RESULT') return 'RESULTS';
  if (type === 'MESSAGE') return 'MESSAGES';
  if (type === 'REFILL') return 'REFILLS';
  if (type === 'COSIGN') return 'COSIGN';
  return type === 'GENERAL' ? 'TASKS' : null;
}

/**
 * One task as the typed inbox reads it.
 *
 * `userId` is the signed-in clinician, and it is what turns an assignee column
 * into the word the row shows: their own task is `ME`, and anything in the
 * shared pool is `TEAM`. `assigneeType` decides which - a pooled task carrying
 * a stale `assigneeUserId` is still unclaimed - so a task assigned to SOMEBODY
 * ELSE reads as `TEAM` here and should not have been fetched; the route's
 * `inboxFor` is what keeps it out.
 */
export function toInboxItem(dto: TaskDto, userId: string): InboxItem | null {
  const stream = toStream(dto.type);
  if (stream === null) return null;
  return {
    id: dto.id,
    stream,
    patientId: dto.patientId,
    summary: dto.title,
    detail: dto.description,
    receivedAt: dto.createdAt,
    dueAt: dto.dueAt,
    assignedTo: dto.assigneeType === 'USER' && dto.assigneeUserId === userId ? 'ME' : 'TEAM',
    /* No read receipt on a task, so this is not a fact here rather than a
       `false`. See {@link InboxItem.unread}. */
    unread: null,
    /* The only subject this application has a screen for. A task pointing at a
       message thread or a prescription has nowhere to open yet, and a link to
       nowhere is worse than no link. */
    href: dto.subjectType === 'DiagnosticReport' ? '/results' : null,
  };
}

/**
 * A page of inbox items, with the rows the five streams refused counted rather
 * than dropped.
 *
 * The same shape and the same argument as {@link OrderPage} and
 * {@link ResultPage}: `page.total` counts what the API matched, `data` holds
 * what the inbox has a word for, and a clinician reading "12 items" above 9
 * rows cannot tell whether three are missing or three are elsewhere.
 */
export interface InboxPage extends ListResponse<InboxItem> {
  /** Rows on this page that belong to an administrative worklist, not this one. */
  refused: number;
}

/** One page of tasks, as the typed inbox reads it. */
export function toInboxPage(response: ListResponse<TaskDto>, userId: string): InboxPage {
  const data = response.data
    .map((dto) => toInboxItem(dto, userId))
    .filter((item): item is InboxItem => item !== null);
  return { data, page: response.page, refused: response.data.length - data.length };
}

/**
 * `InboxListQuery` as `/bff/v0/tasks` can answer it.
 *
 * `stream` is deliberately NOT translated into `type`, even though the route
 * has that filter: the screen filters streams in the browser and counts all
 * five on the chips from one page, so narrowing at the route would empty the
 * other four counts. `assignedTo` is narrowed here, because the pool and one
 * person's own work are different pages rather than different rows of one.
 */
export function toTaskQuery(query: InboxListQuery, userId: string): TaskListQuery {
  return {
    inboxFor: userId,
    open: true,
    pageSize: INBOX_PAGE_SIZE,
    sort: 'dueAt',
    order: 'asc',
    ...(query.assignedTo === undefined
      ? {}
      : { assigneeType: query.assignedTo === 'ME' ? 'USER' : 'TEAM' }),
  };
}

/**
 * The widest page `/bff/v0/tasks` will serve.
 *
 * `MAX_PAGE_SIZE` in `apps/api/src/schemas/pagination.ts`. Asked for
 * explicitly because the route's default is 25 and this screen counts all five
 * streams off one page: a default-sized page would render chip counts that are
 * a property of the pagination rather than of the inbox. The residual is still
 * reported - an inbox longer than this is a fact about the practice.
 */
const INBOX_PAGE_SIZE = 100;

/** The inbox half of {@link WorklistClient}, over `GET /bff/v0/tasks`. */
export function liveInbox(client: ApiClient, userId: string): WorklistClient['inbox'] {
  return {
    list: (query = {}) =>
      client.tasks.list(toTaskQuery(query, userId)).then((page) => toInboxPage(page, userId)),
  };
}

/**
 * The app's client.
 *
 * Orders read the API in live mode. Results and the inbox do not, because
 * `apps/api` still has no aggregate behind them - the inbox in particular is a
 * composition across results, messages and tasks that no route assembles. Mock
 * mode keeps the fixture rows for all three: `MOCK_SERVICE_REQUESTS` is a
 * thinner set than `MOCK_ORDERS` and carries no cancellation reason or linked
 * report, so routing the demo through it would empty three columns of the
 * screen it is there to demonstrate.
 */
export const worklist: WorklistClient =
  API_MODE === 'live'
    ? { ...createWorklistClient(), orders: liveOrders(api), results: liveResults(api) }
    : createWorklistClient();

/**
 * The app's client, once the caller has a name.
 *
 * The inbox is the one worklist that cannot be built at module scope: it is
 * defined in terms of the signed-in clinician, and `userId` arrives from
 * `/bff/v0/me` a request later. Null is "not known yet" - or a principal that
 * is not staff at all - and yields the fixture client, which is why the hook
 * below holds the query until it is not null.
 */
export function worklistFor(userId: string | null): WorklistClient {
  if (API_MODE !== 'live' || userId === null) return worklist;
  return { ...worklist, inbox: liveInbox(api, userId) };
}

/**
 * Whether the assignment of a result is a fact this client can read.
 *
 * False over the API, where assignment lives on `Task` and no report field or
 * query filter carries it, and true over fixtures, where `MOCK_RESULTS` states
 * it per row. A screen reads this before offering a ME/TEAM control, because a
 * filter that cannot select is worse than an absent one: it narrows nothing and
 * says it narrowed.
 *
 * A mode test rather than a literal: it is already a property of which client
 * is wired up.
 */
export const RESULT_ASSIGNMENT_IS_KNOWN = API_MODE !== 'live';

export interface WorklistHookOptions {
  /** Injectable for tests. Defaults to the app's client. */
  client?: WorklistClient;
  enabled?: boolean;
}

export function useOrders(
  query: OrderListQuery = {},
  options: WorklistHookOptions = {}
): AsyncState<OrderPage> {
  const client = options.client ?? worklist;
  return useApiQuery(queryKey('orders.list', { ...query }), () => client.orders.list(query), {
    enabled: options.enabled,
  });
}

export function useResults(
  query: ResultListQuery = {},
  options: WorklistHookOptions = {}
): AsyncState<ResultPage> {
  const client = options.client ?? worklist;
  return useApiQuery(queryKey('results.list', { ...query }), () => client.results.list(query), {
    enabled: options.enabled,
  });
}

/**
 * The analytes of one report, fetched when there is a report to fetch them for.
 *
 * `enabled` is how the reading pane holds off until something is selected: the
 * queue is what the screen opens on, and a list of analytes for no report is a
 * request with no question in it.
 */
export function useResultAnalytes(
  reportId: string | null,
  options: WorklistHookOptions = {}
): AsyncState<ListResponse<ResultAnalyte>> {
  const client = options.client ?? worklist;
  return useApiQuery(
    queryKey('results.analytes', { reportId }),
    () => client.results.analytes(reportId ?? ''),
    { enabled: (options.enabled ?? true) && reportId !== null }
  );
}

/**
 * The typed inbox of the signed-in clinician.
 *
 * The only worklist hook that reads a second route. `/bff/v0/me` names the
 * caller, and without that name the inbox cannot be asked for: the route
 * filters on a user id, and every row is labelled mine or pool by comparing
 * against the same id. So in live mode the query waits rather than asking for
 * an unfiltered one, which would be every clinician's work under a heading
 * that says it is yours.
 *
 * An injected client is used as given, name or no name: that is the demo build
 * and the tests, where the rows say whose they are.
 */
export function useInbox(
  query: InboxListQuery = {},
  options: WorklistHookOptions = {}
): AsyncState<InboxPage> {
  const capabilities = useOwnCapabilities();
  const userId = capabilities.data?.userId ?? null;
  const client = options.client ?? worklistFor(userId);
  /* The name gates the request rather than keying it. Flipping `enabled` is
     already what re-runs the query when `/me` comes back, so an id in the key
     would add nothing in live mode and refetch the same fixture page in the
     demo build - on the one screen whose chip counts are read while it
     settles. */
  const live = options.client === undefined && API_MODE === 'live';
  return useApiQuery(queryKey('inbox.list', { ...query }), () => client.inbox.list(query), {
    enabled: (options.enabled ?? true) && (!live || userId !== null),
  });
}

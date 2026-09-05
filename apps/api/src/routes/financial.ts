import {
  chargeItemInput,
  claimCreateInput,
  coverageInput,
  paymentCreateInput,
  remittanceInput,
  statementInput,
  type ClaimStatusChangeInput,
  type PaymentAllocationInput,
} from '@openrunic/database';
import {
  ageBalance,
  DEFAULT_DUNNING_POLICY,
  nextAction,
  type BalanceState,
  type CollectionsAction,
  type DunningPolicy,
} from '@openrunic/collections';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { parseJsonBody, parseParam, parseQuery, toFieldIssues } from '../http/validate.js';
import { assertFacilityAccess, requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type {
  ChargeItemStatus,
  ClaimPatchInput,
  ClaimStatus,
  PaymentPatchInput,
  PaymentStatus,
  RemittanceStatus,
  StatementStatus,
} from '../repositories/specs/financial.js';
import type { Page } from '../repositories/collection.js';
import type { Repositories } from '../repositories/types.js';
import {
  chargeDtoSchema,
  chargeListQuerySchema,
  chargeUpdateSchema,
  chargeVoidSchema,
  claimDtoSchema,
  claimLineDtoSchema,
  claimListQuerySchema,
  claimStatusChangeBodySchema,
  claimStatusHistoryDtoSchema,
  claimTransitionSchema,
  claimUpdateSchema,
  coverageDtoSchema,
  coverageListQuerySchema,
  coverageUpdateSchema,
  eligibilityCheckSchema,
  eligibilityResultSchema,
  paymentAllocationDtoSchema,
  paymentDtoSchema,
  paymentListQuerySchema,
  paymentTransitionSchema,
  paymentUpdateSchema,
  remittanceDtoSchema,
  remittanceLineDtoSchema,
  remittanceListQuerySchema,
  remittanceParseResultSchema,
  remittanceParseSchema,
  remittancePostResultSchema,
  remittancePostSchema,
  remittanceUpdateSchema,
  statementDtoSchema,
  statementGenerateSchema,
  statementListQuerySchema,
  statementSendSchema,
  statementUpdateSchema,
  toChargeDto,
  toChargeListQuery,
  toChargePatchInput,
  toClaimDto,
  toClaimLineDto,
  toClaimListQuery,
  toClaimPatchInput,
  toClaimStatusHistoryDto,
  toCoverageDto,
  toCoverageListQuery,
  toCoveragePatchInput,
  toPaymentAllocationDto,
  toPaymentDto,
  toPaymentListQuery,
  toPaymentPatchInput,
  toRemittanceDto,
  toRemittanceLineDto,
  toRemittanceListQuery,
  toRemittancePatchInput,
  toStatementDto,
  toStatementListQuery,
  toStatementPatchInput,
  type ChargeDto,
  type ClaimDto,
  type CoverageRow,
  type EligibilityResult,
  type PaymentDto,
  type RemittanceLineRow,
  type RemittanceParseResult,
  type RemittancePostResult,
  type StatementDto,
  collectionsWorklistEntrySchema,
  collectionsWorklistQuerySchema,
  statementHoldSchema,
  statementNoticeSchema,
  statementWriteOffSchema,
  type CollectionsWorklistEntry,
  type StatementRow,
} from '../schemas/financial.js';
import { listResponseSchema, toListResponse } from '../schemas/pagination.js';

import {
  assertTransition,
  defineCrud,
  CONFLICT_RESPONSE,
  CRUD_ERRORS,
  NOT_FOUND_RESPONSE,
  UNPROCESSABLE_RESPONSE,
  type CrudModule,
} from './crud.js';
import {
  gateCharts,
  idParam,
  idParamSchema,
  policyOf,
  repositories,
  required,
  requiredParentChart,
} from './helpers.js';

/**
 * The revenue cycle, from eligibility to a paid statement.
 *
 * List, read, record and amend come from {@link defineCrud} for all six
 * top-level aggregates, because those four operations differ between a coverage
 * and a remittance only in the nouns. Everything that moves a record from one
 * state to another is written out longhand below, next to the table that
 * governs it, because a transition is exactly the place where a generic
 * abstraction would hide the rules that matter: which moves are legal, what
 * gets stamped, and what else has to be written in the same breath.
 *
 * Nothing here accepts an instrument. Card and account handling live entirely
 * behind the payments adapter; the only thing these routes ever carry is that
 * adapter's opaque reference.
 */

/* ---------------------------------------------------------------- the tables */

/**
 * A charge is never deleted; it is voided, with a reason and an author.
 *
 * OPEN to BILLED is the move a claim makes when it picks the charge up, so it
 * belongs in the table even though no route in this file performs it.
 */
const CHARGE_TRANSITIONS: Readonly<Record<ChargeItemStatus, readonly ChargeItemStatus[]>> = {
  OPEN: ['BILLED', 'VOIDED'],
  BILLED: ['VOIDED'],
  VOIDED: [],
};

/**
 * The claim lifecycle.
 *
 * SCRUBBED exists so that SUBMITTED means "we checked it first": submitting a
 * claim that has not been scrubbed is refused, and that refusal is the whole
 * reason for having two states rather than one. The three inbound acknowledgement
 * paths - a 999, a 277 and an 835 - all land in this same table, so an
 * adjudication outcome cannot take a claim somewhere a person could not have
 * taken it.
 */
const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  DRAFT: ['SCRUBBED', 'VOID'],
  SCRUBBED: ['SUBMITTED', 'DRAFT'],
  SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'DENIED'],
  ACKNOWLEDGED: ['PAID', 'PARTIAL', 'DENIED'],
  REJECTED: ['REBILLED', 'VOID'],
  DENIED: ['REBILLED', 'VOID'],
  PARTIAL: ['PAID', 'DENIED'],
  PAID: ['VOID'],
  REBILLED: ['SCRUBBED'],
  VOID: [],
};

/** Money that failed, was voided or was refunded is where it is staying. */
const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ['POSTED', 'VOIDED'],
  POSTED: ['REFUNDED', 'VOIDED'],
  FAILED: [],
  VOIDED: [],
  REFUNDED: [],
};

/**
 * An advice is parsed before it is posted.
 *
 * RECEIVED cannot be posted, because posting reads the matched lines and
 * nothing has looked at them yet. EXCEPTIONS is the state an advice is put in
 * when its matching needs a person; from there it can be parsed again or posted
 * as it stands, with the unmatched lines reported rather than applied.
 */
const REMITTANCE_TRANSITIONS: Readonly<Record<RemittanceStatus, readonly RemittanceStatus[]>> = {
  RECEIVED: ['PARSED'],
  PARSED: ['POSTED'],
  EXCEPTIONS: ['PARSED', 'POSTED'],
  POSTED: [],
};

/** A statement is generated, sent, and then either paid or written off. */
const STATEMENT_TRANSITIONS: Readonly<Record<StatementStatus, readonly StatementStatus[]>> = {
  DRAFT: ['GENERATED'],
  GENERATED: ['SENT'],
  // A sent statement can be paid, withdrawn as a mistake, or given up on. Only
  // the last of those is a collections outcome, and it is a separate state from
  // VOID because a practice that cannot tell abandoned debt from a billing
  // error cannot report either one.
  SENT: ['PAID', 'VOID', 'WRITTEN_OFF'],
  PAID: [],
  VOID: [],
  // Terminal. A written-off balance that is later paid is a payment against the
  // ledger, not a resurrection of the notice it ended: reopening it here would
  // put the statement back on a dunning schedule it had already left.
  WRITTEN_OFF: [],
};

/** The states that mean a payer has decided, as opposed to merely received. */
const ADJUDICATED_STATES: ReadonlySet<ClaimStatus> = new Set<ClaimStatus>([
  'PAID',
  'PARTIAL',
  'DENIED',
]);

/* ---------------------------------------------------------------- the plumbing */

const MISSING_COVERAGE = 'No such coverage record.';
const MISSING_CHARGE = 'No such charge.';
const MISSING_CLAIM = 'No such claim.';
const MISSING_PAYMENT = 'No such payment.';
const MISSING_REMITTANCE = 'No such remittance.';
const MISSING_STATEMENT = 'No such statement.';

/** Mirrors the ceilings the write contracts put on each composite's children. */
const CLAIM_LINE_LIMIT = 50;
const CLAIM_HISTORY_LIMIT = 200;
const PAYMENT_ALLOCATION_LIMIT = 500;
const REMITTANCE_LINE_LIMIT = 5000;

/**
 * How many outstanding statements the worklist will consider, per status.
 *
 * A ceiling rather than a page: a practice with more balances than this in one
 * state has a problem no list can present, and silently returning the first
 * screenful of it would read as "this is all of it". Kept in step with
 * `REMITTANCE_LINE_LIMIT`, which bounds the other unpaged read in this file.
 */
const WORKLIST_LIMIT = 5000;

type ClaimStatusSource = ClaimStatusChangeInput['source'];

/**
 * Reads a transition's body, which may not have been sent at all.
 *
 * Several of these moves carry nothing but the fact that they happened, and a
 * caller who posts them with no body is being reasonable. `parseJsonBody` would
 * report an absent body as malformed JSON, so an absent body is validated as an
 * empty object instead: a transition whose schema has a required field still
 * fails, with the field named, rather than with a complaint about syntax.
 */
async function parseTransitionBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const raw = (await c.req.text()).trim();
  if (raw.length > 0) return parseJsonBody(c, schema);

  const result = schema.safeParse({});
  if (!result.success) {
    throw ApiError.validation('The request body failed validation.', toFieldIssues(result.error));
  }
  return result.data;
}

/**
 * The acting principal, for the columns that record who did something.
 *
 * Every route below is behind `requirePermission`, which 401s a request that
 * carries no principal, so an absent one here is a wiring bug rather than a
 * client error: the router was mounted outside the middleware chain. It is
 * raised the same way `repositories` raises it, and for the same reason - what
 * it must never do is quietly write an unattributed void or posting.
 */
function actorId(c: Context<AppEnv>): string {
  const principal = c.get('principal');
  if (principal === undefined) {
    throw new Error(
      'route reached without a principal: it is mounted outside the middleware chain'
    );
  }
  return principal.subject;
}

/** X12 CAS group codes, narrowed from the stored string without a cast. */
const ADJUSTMENT_GROUPS = ['CO', 'CR', 'OA', 'PI', 'PR'] as const;

function toAdjustmentGroup(value: string | null): (typeof ADJUSTMENT_GROUPS)[number] | undefined {
  return ADJUSTMENT_GROUPS.find((group) => group === value);
}

/* ------------------------------------------------------------ crud resources */

function coverageModule(): CrudModule {
  return defineCrud({
    segment: 'coverage',
    singular: 'coverage record',
    plural: 'coverage records',
    tag: 'coverage',
    operation: 'Coverage',
    readPermission: 'coverage.read',
    writePermission: 'coverage.write',
    chartFrom: 'coverages',
    collection: (repos: Repositories) => repos.coverages,
    listQuerySchema: coverageListQuerySchema,
    toQuery: toCoverageListQuery,
    listDescription:
      'The coordination-of-benefits list for one chart is `patientId` sorted by `rank`, which is why that is the default sort.',
    createSchema: coverageInput,
    toCreate: (body) => body,
    patchSchema: coverageUpdateSchema,
    toPatch: (body) => toCoveragePatchInput(body),
    dtoSchema: coverageDtoSchema,
    toDto: toCoverageDto,
  });
}

function chargeModule(): CrudModule {
  return defineCrud({
    segment: 'charges',
    singular: 'charge',
    plural: 'charges',
    tag: 'charges',
    operation: 'Charge',
    readPermission: 'charge.read',
    writePermission: 'charge.write',
    chartFrom: 'charges',
    collection: (repos: Repositories) => repos.charges,
    listQuerySchema: chargeListQuerySchema,
    toQuery: toChargeListQuery,
    listDescription:
      'The fee sheet for a visit is `encounterId`; the unbilled work queue is `facilityId` plus `status=OPEN`. `from` is inclusive and `to` exclusive on the service date, so one day is `[day, next day)`.',
    createSchema: chargeItemInput,
    toCreate: (body) => body,
    patchSchema: chargeUpdateSchema,
    toPatch: (body) => toChargePatchInput(body),
    dtoSchema: chargeDtoSchema,
    toDto: toChargeDto,
    // Charges are facility-scoped, so the facility grant is asked as well as
    // the permission, and it is asked before the write rather than after.
    facilityOfRow: (row) => row.facilityId,
    facilityOfInput: (input) => input.facilityId,
    facilityOfQuery: (query) => query.facilityId ?? null,
  });
}

function claimModule(): CrudModule {
  return defineCrud({
    segment: 'claims',
    singular: 'claim',
    plural: 'claims',
    tag: 'claims',
    operation: 'Claim',
    readPermission: 'claim.read',
    writePermission: 'claim.write',
    chartFrom: 'claims',
    collection: (repos: Repositories) => repos.claims,
    listQuerySchema: claimListQuerySchema,
    toQuery: toClaimListQuery,
    listDescription:
      'This list is the accounts-receivable work queue: `status` plus a window on `createdAt` or `submittedAt`, oldest first by default, because the oldest unpaid claim is the one costing money. Creating a claim writes its lines in the same request and derives `totals.chargedCents` from them.',
    createSchema: claimCreateInput,
    toCreate: (body) => body,
    patchSchema: claimUpdateSchema,
    toPatch: (body) => toClaimPatchInput(body),
    dtoSchema: claimDtoSchema,
    toDto: toClaimDto,
  });
}

function paymentModule(): CrudModule {
  return defineCrud({
    segment: 'payments',
    singular: 'payment',
    plural: 'payments',
    tag: 'payments',
    operation: 'Payment',
    readPermission: 'payment.read',
    writePermission: 'payment.write',
    chartFrom: 'payments',
    collection: (repos: Repositories) => repos.payments,
    listQuerySchema: paymentListQuerySchema,
    toQuery: toPaymentListQuery,
    listDescription:
      'Money in, from a patient or from a payer. Allocations supplied on the create are written in the same transaction, so a payment never exists without knowing what it was applied to.',
    createSchema: paymentCreateInput,
    toCreate: (body) => body,
    patchSchema: paymentUpdateSchema,
    toPatch: (body) => toPaymentPatchInput(body),
    dtoSchema: paymentDtoSchema,
    toDto: toPaymentDto,
  });
}

function remittanceModule(): CrudModule {
  return defineCrud({
    segment: 'remittances',
    singular: 'remittance',
    plural: 'remittances',
    tag: 'remittances',
    operation: 'Remittance',
    readPermission: 'payment.read',
    writePermission: 'payment.write',
    collection: (repos: Repositories) => repos.remittances,
    listQuerySchema: remittanceListQuerySchema,
    toQuery: toRemittanceListQuery,
    listDescription:
      'Electronic remittance advice, one row per 835. Service lines supplied on the create are written in the same transaction.',
    createSchema: remittanceInput,
    toCreate: (body) => body,
    patchSchema: remittanceUpdateSchema,
    toPatch: (body) => toRemittancePatchInput(body),
    dtoSchema: remittanceDtoSchema,
    toDto: toRemittanceDto,
  });
}

function statementModule(): CrudModule {
  return defineCrud({
    segment: 'statements',
    singular: 'statement',
    plural: 'statements',
    tag: 'statements',
    operation: 'Statement',
    readPermission: 'payment.read',
    writePermission: 'payment.write',
    chartFrom: 'statements',
    collection: (repos: Repositories) => repos.statements,
    listQuerySchema: statementListQuerySchema,
    toQuery: toStatementListQuery,
    listDescription:
      'The dunning run is `status` plus `dunningCycle`. The pay-link token is never emitted; `payLinkSet` and `payLinkExpiresAt` are what a screen actually needs.',
    createSchema: statementInput,
    toCreate: (body) => body,
    patchSchema: statementUpdateSchema,
    toPatch: (body) => toStatementPatchInput(body),
    dtoSchema: statementDtoSchema,
    toDto: toStatementDto,
  });
}

function financialModules(): CrudModule[] {
  return [
    coverageModule(),
    chargeModule(),
    claimModule(),
    paymentModule(),
    remittanceModule(),
    statementModule(),
  ];
}

/* ------------------------------------------------------------- eligibility */

/**
 * A local eligibility determination.
 *
 * There is no clearing-house call behind this seam yet, so what it answers is
 * whether the stored policy covers the service date, together with what the
 * plan says the patient owes. Every reason it can give is a fact about the
 * record in front of it, which is why the answer names itself as local: a
 * caller must be able to tell this apart from a payer's own word without
 * reading the documentation.
 */
function determineEligibility(row: CoverageRow, serviceDate: Date, now: Date): EligibilityResult {
  const reasons: string[] = [];
  if (row.status === 'CANCELLED') reasons.push('The coverage is cancelled.');
  if (row.status === 'DRAFT') reasons.push('The coverage has not been verified.');
  if (row.effectiveFrom !== null && serviceDate.getTime() < row.effectiveFrom.getTime()) {
    reasons.push('The service date precedes the policy effective date.');
  }
  if (row.effectiveTo !== null && serviceDate.getTime() > row.effectiveTo.getTime()) {
    reasons.push('The service date falls after the policy end date.');
  }

  return {
    coverageId: row.id,
    patientId: row.patientId,
    payerId: row.payerId,
    serviceDate: serviceDate.toISOString().slice(0, 10),
    eligible: reasons.length === 0,
    rank: row.rank,
    status: row.status,
    planName: row.planName,
    memberId: row.memberId,
    copayCents: row.copayCents,
    deductibleCents: row.deductibleCents,
    reasons,
    determination: 'local',
    determinedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------- claim moves */

interface ClaimMove {
  to: ClaimStatus;
  source: ClaimStatusSource;
  occurredAt?: Date;
  detail?: Record<string, unknown>;
  statusReason?: string;
}

/** The lifecycle columns a state means, stamped where the state is set. */
function claimStamps(move: ClaimStatus, at: Date): ClaimPatchInput {
  if (move === 'SUBMITTED') return { submittedAt: at };
  if (move === 'ACKNOWLEDGED') return { acknowledgedAt: at };
  return ADJUDICATED_STATES.has(move) ? { adjudicatedAt: at } : {};
}

/**
 * Moves a claim, and writes down that it moved.
 *
 * The history row is not an afterthought: the claim's own columns remember only
 * the state it is in now, and every accounts-receivable question worth asking
 * is about the sequence. This is also where the 999, the 277 and the 835 land,
 * so the same table governs an inbound acknowledgement and a biller pressing a
 * button.
 */
async function moveClaim(c: Context<AppEnv>, id: string, move: ClaimMove): Promise<ClaimDto> {
  const repos = repositories(c);
  const before = required(await repos.claims.findById(id), MISSING_CLAIM);
  assertTransition(CLAIM_TRANSITIONS, 'claim', before.status, move.to);

  const occurredAt = move.occurredAt ?? new Date();
  const row = required(
    await repos.claims.update(id, {
      status: move.to,
      ...claimStamps(move.to, occurredAt),
      ...(move.statusReason === undefined ? {} : { statusReason: move.statusReason }),
    }),
    MISSING_CLAIM
  );

  await repos.claimStatusHistory.create({
    claimId: id,
    status: move.to,
    occurredAt,
    source: move.source,
    ...(move.detail === undefined ? {} : { detail: move.detail }),
    byUserId: actorId(c),
  });

  return toClaimDto(row);
}

/* ----------------------------------------------------------- payment moves */

/**
 * The payment moves that have a ROUTE, as `[url segment, resulting status]`.
 *
 * Distinct from PAYMENT_TRANSITIONS above, which is the legal-transition graph
 * the move is checked against. This one says which moves a client can ask for;
 * that one says which are allowed from where. Both are needed and they are not
 * the same list.
 *
 * `as const` is load-bearing: it keeps each status a literal so `movePayment`
 * still takes a `PaymentStatus` rather than a widened `string`, and a typo in
 * this table fails to compile instead of failing at runtime.
 */
const ROUTED_PAYMENT_MOVES = [
  ['post', 'POSTED'],
  ['void', 'VOIDED'],
  ['refund', 'REFUNDED'],
] as const satisfies readonly (readonly [string, PaymentStatus])[];

async function movePayment(
  c: Context<AppEnv>,
  id: string,
  to: PaymentStatus,
  note: string | undefined
): Promise<PaymentDto> {
  const repos = repositories(c);
  const before = required(await repos.payments.findById(id), MISSING_PAYMENT);
  assertTransition(PAYMENT_TRANSITIONS, 'payment', before.status, to);

  const patch: PaymentPatchInput = {
    status: to,
    ...(note === undefined ? {} : { note }),
    // Posting is the moment the money became the practice's, so it is stamped
    // where the status is set rather than by a later job that might not run.
    ...(to === 'POSTED' ? { postedAt: new Date(), postedById: actorId(c) } : {}),
  };

  return toPaymentDto(required(await repos.payments.update(id, patch), MISSING_PAYMENT));
}

/* -------------------------------------------------------- remittance posting */

/**
 * A remittance's service lines, with the charts behind them gated.
 *
 * A remittance is a payer document: `remittances.findById` narrows by tenant
 * and by nothing else, so unlike every other parent in #300 there is no chart
 * ON the parent to guard - and the chart data is on the children. A
 * `RemittanceLine` names a claim and publishes that claim's procedure code, its
 * service date and four money fields including what the patient owes. So the
 * guard resolves the claims this page names and asks the chart question about
 * those, which is the move the collections worklist already makes over its own
 * rows.
 *
 * A line naming NO claim is an unmatched line: there is no chart behind it and
 * nothing to check.
 *
 * There is deliberately no branch for a line whose claim does not resolve.
 * `Claim` is compartment-scoped but not facility-scoped, and a compartment
 * principal cannot reach a remittance at all, so for every caller that gets
 * here the claims resolve - a refusal there could not fire, and a guard that
 * cannot fail is not a guard. `allocationForLine` already documents the
 * unresolvable claim as a legitimate skip on the posting path rather than an
 * error, and this does not contradict it.
 *
 * Every caller reads through here rather than listing the rows itself, so the
 * read route and the two write routes over the same rows cannot drift apart.
 */
async function allRemittanceLines(
  c: Context<AppEnv>,
  repos: Repositories,
  remittanceId: string
): Promise<Page<RemittanceLineRow>> {
  const page = await repos.remittanceLines.list({
    page: 1,
    pageSize: REMITTANCE_LINE_LIMIT,
    sort: 'sequence',
    order: 'asc',
    remittanceId,
  });
  const claimIds = [...new Set(page.rows.map((line) => line.claimId).filter((id) => id !== null))];
  await gateCharts(c, 'claims', await repos.claims.findByIds(claimIds));
  return page;
}

/**
 * The allocation a service line becomes, or null when it cannot become one.
 *
 * A line is skipped for three reasons, and none of them is an error: it was
 * never matched, it names a claim this organisation cannot see, or it paid
 * nothing. Posting counts the skips and reports them, because an unmatched line
 * is somebody's work rather than money that quietly stopped existing.
 */
async function allocationForLine(
  repos: Repositories,
  line: RemittanceLineRow
): Promise<PaymentAllocationInput | null> {
  if (!line.matched || line.paidCents === 0 || line.claimId === null) return null;

  const claim = await repos.claims.findById(line.claimId);
  if (claim === null) return null;

  const group = toAdjustmentGroup(line.adjustmentGroupCode);
  return {
    patientId: claim.patientId,
    claimId: claim.id,
    ...(line.claimLineId === null ? {} : { claimLineId: line.claimLineId }),
    amountCents: line.paidCents,
    ...(group === undefined ? {} : { adjustmentGroupCode: group }),
    ...(line.adjustmentReasonCode === null
      ? {}
      : { adjustmentReasonCode: line.adjustmentReasonCode }),
  };
}

/* ------------------------------------------------------------------- routes */

function transitionRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.post('/coverage/:id/eligibility', requirePermission('coverage.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, eligibilityCheckSchema);
    const row = required(await repositories(c).coverages.findById(id), MISSING_COVERAGE);

    if (row.status === 'ENTERED_IN_ERROR') {
      // A record that should not exist cannot support a determination, and
      // answering "not eligible" would imply the policy had been looked at.
      throw ApiError.invalidTransition({
        subject: 'coverage record',
        from: 'ENTERED_IN_ERROR',
        to: 'DETERMINED',
        allowed: [],
      });
    }

    const serviceDate = new Date(`${body.serviceDate}T00:00:00.000Z`);
    return c.json(determineEligibility(row, serviceDate, new Date()));
  });

  router.post('/charges/:id/void', requirePermission('charge.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, chargeVoidSchema);
    const charges = repositories(c).charges;
    const before = required(await charges.findById(id), MISSING_CHARGE);
    assertFacilityAccess(policyOf(c), before.facilityId);
    assertTransition(CHARGE_TRANSITIONS, 'charge', before.status, 'VOIDED');

    const row = required(
      await charges.update(id, {
        status: 'VOIDED',
        voidReason: body.voidReason,
        voidedById: actorId(c),
      }),
      MISSING_CHARGE
    );
    return c.json<ChargeDto>(toChargeDto(row));
  });

  router.post('/claims/:id/scrub', requirePermission('claim.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, claimTransitionSchema);
    return c.json(await moveClaim(c, id, { to: 'SCRUBBED', source: 'system', ...body }));
  });

  router.post('/claims/:id/submit', requirePermission('claim.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, claimTransitionSchema);
    return c.json(await moveClaim(c, id, { to: 'SUBMITTED', source: 'system', ...body }));
  });

  router.post('/claims/:id/status', requirePermission('claim.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, claimStatusChangeBodySchema);
    return c.json(
      await moveClaim(c, id, {
        to: body.status,
        source: body.source,
        ...(body.occurredAt === undefined ? {} : { occurredAt: body.occurredAt }),
        ...(body.detail === undefined ? {} : { detail: body.detail }),
        ...(body.statusReason === undefined ? {} : { statusReason: body.statusReason }),
      })
    );
  });

  router.get('/claims/:id/lines', requirePermission('claim.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);
    // Asked first so an unknown claim is a 404 rather than an empty list, which
    // would read as "this claim has no lines" - and gated, because the read
    // narrows by tenant, compartment and facility and never by care
    // relationship (#300).
    await requiredParentChart(c, 'claims', await repos.claims.findById(id), MISSING_CLAIM);
    const page = await repos.claimLines.list({
      page: 1,
      pageSize: CLAIM_LINE_LIMIT,
      sort: 'sequence',
      order: 'asc',
      claimId: id,
    });
    return c.json(toListResponse(page, toClaimLineDto));
  });

  router.get('/claims/:id/history', requirePermission('claim.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);
    await requiredParentChart(c, 'claims', await repos.claims.findById(id), MISSING_CLAIM);
    const page = await repos.claimStatusHistory.list({
      page: 1,
      pageSize: CLAIM_HISTORY_LIMIT,
      sort: 'occurredAt',
      order: 'asc',
      claimId: id,
    });
    return c.json(toListResponse(page, toClaimStatusHistoryDto));
  });

  // Declared rather than copied. The three routes differed by a URL segment and
  // a status and agreed on everything else, which is the shape that invites a
  // fourth to be pasted in and then edited in only two of its three places.
  // Reading them as a table also puts the payment state machine on one screen.
  for (const [segment, status] of ROUTED_PAYMENT_MOVES) {
    router.post(`/payments/:id/${segment}`, requirePermission('payment.write'), async (c) => {
      const id = parseParam(c.req.param('id'), idParamSchema, 'id');
      const body = await parseTransitionBody(c, paymentTransitionSchema);
      return c.json(await movePayment(c, id, status, body.note));
    });
  }

  router.get('/payments/:id/allocations', requirePermission('payment.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);
    await requiredParentChart(c, 'payments', await repos.payments.findById(id), MISSING_PAYMENT);
    const page = await repos.paymentAllocations.list({
      page: 1,
      pageSize: PAYMENT_ALLOCATION_LIMIT,
      sort: 'appliedAt',
      order: 'asc',
      paymentId: id,
    });
    return c.json(toListResponse(page, toPaymentAllocationDto));
  });

  router.post('/remittances/:id/parse', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    await parseTransitionBody(c, remittanceParseSchema);
    const repos = repositories(c);
    const before = required(await repos.remittances.findById(id), MISSING_REMITTANCE);
    assertTransition(REMITTANCE_TRANSITIONS, 'remittance', before.status, 'PARSED');

    const lines = (await allRemittanceLines(c, repos, id)).rows;
    const matchedCount = lines.filter((line) => line.matched).length;
    const exceptionCount = lines.length - matchedCount;
    const row = required(
      await repos.remittances.update(id, { status: 'PARSED', exceptionCount }),
      MISSING_REMITTANCE
    );

    return c.json<RemittanceParseResult>({
      remittance: toRemittanceDto(row),
      lineCount: lines.length,
      matchedCount,
      exceptionCount,
    });
  });

  router.post('/remittances/:id/post', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, remittancePostSchema);
    const repos = repositories(c);
    const before = required(await repos.remittances.findById(id), MISSING_REMITTANCE);
    // Asked before anything is written, so a refused post never leaves a
    // payment behind for a remittance that did not move.
    assertTransition(REMITTANCE_TRANSITIONS, 'remittance', before.status, 'POSTED');

    const lines = (await allRemittanceLines(c, repos, id)).rows;
    const allocations: PaymentAllocationInput[] = [];
    for (const line of lines) {
      const allocation = await allocationForLine(repos, line);
      if (allocation !== null) allocations.push(allocation);
    }
    const allocatedCents = allocations.reduce((total, entry) => total + entry.amountCents, 0);

    const actor = actorId(c);
    const payment = await repos.payments.create({
      payerId: before.payerId,
      remittanceId: id,
      source: 'PAYER_ERA',
      method: body.method ?? 'EFT',
      status: 'POSTED',
      // The advice's own total is what arrived; the allocations are what could
      // be applied. Taking the larger stops the payment from claiming to hold
      // less money than it hands out when no total was stated.
      amountCents: Math.max(before.totalPaidCents, allocatedCents),
      ...(before.checkOrEftNumber === null ? {} : { reference: before.checkOrEftNumber }),
      receivedAt: before.receivedAt,
      allocations,
      postedById: actor,
    });

    const row = required(
      await repos.remittances.update(id, {
        status: 'POSTED',
        postedAt: new Date(),
        postedById: actor,
      }),
      MISSING_REMITTANCE
    );

    return c.json<RemittancePostResult>({
      remittance: toRemittanceDto(row),
      payment: toPaymentDto(payment),
      allocationCount: allocations.length,
      allocatedCents,
      skippedLineCount: lines.length - allocations.length,
    });
  });

  router.get('/remittances/:id/lines', requirePermission('payment.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const repos = repositories(c);
    required(await repos.remittances.findById(id), MISSING_REMITTANCE);
    const page = await allRemittanceLines(c, repos, id);
    return c.json(toListResponse(page, toRemittanceLineDto));
  });

  router.post('/statements/:id/generate', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, statementGenerateSchema);
    const statements = repositories(c).statements;
    const before = required(await statements.findById(id), MISSING_STATEMENT);
    assertTransition(STATEMENT_TRANSITIONS, 'statement', before.status, 'GENERATED');

    const row = required(
      await statements.update(id, {
        status: 'GENERATED',
        generatedAt: new Date(),
        ...(body.balanceCents === undefined ? {} : { balanceCents: body.balanceCents }),
        ...(body.pdfStorageKey === undefined ? {} : { pdfStorageKey: body.pdfStorageKey }),
      }),
      MISSING_STATEMENT
    );
    return c.json<StatementDto>(toStatementDto(row));
  });

  router.post('/statements/:id/send', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, statementSendSchema);
    const statements = repositories(c).statements;
    const before = required(await statements.findById(id), MISSING_STATEMENT);
    assertTransition(STATEMENT_TRANSITIONS, 'statement', before.status, 'SENT');

    const row = required(
      await statements.update(id, {
        status: 'SENT',
        deliveredVia: body.deliveredVia,
        deliveredAt: new Date(),
        ...(body.payLinkToken === undefined ? {} : { payLinkToken: body.payLinkToken }),
        ...(body.payLinkExpiresAt === undefined
          ? {}
          : { payLinkExpiresAt: new Date(body.payLinkExpiresAt) }),
      }),
      MISSING_STATEMENT
    );
    return c.json<StatementDto>(toStatementDto(row));
  });

  /**
   * WHAT NEEDS CHASING TODAY.
   *
   * Mounted under `/collections` rather than `/statements` because
   * `/statements/worklist` would be caught by `/statements/:id` and answer a
   * validation error about a malformed uuid, which is a confusing way to learn
   * that a route exists.
   *
   * Only SENT and GENERATED statements are considered: those are the ones on a
   * schedule. Paid, voided and written-off balances are outcomes, and a
   * worklist that listed them would grow forever and be abandoned within a
   * month.
   *
   * The action is computed here rather than stored. A stored decision goes
   * stale the moment a payment lands, and a worklist telling a biller to chase
   * somebody who paid yesterday is worse than no worklist at all.
   */
  router.get('/collections/worklist', requirePermission('payment.read'), async (c) => {
    const query = parseQuery(c, collectionsWorklistQuerySchema);
    const now = new Date();
    const policy = dunningPolicy();
    const statements = repositories(c).statements;

    const pages = await Promise.all(
      (['GENERATED', 'SENT'] as const).map((status) =>
        statements.list({
          page: 1,
          pageSize: WORKLIST_LIMIT,
          sort: 'generatedAt',
          order: 'asc',
          status,
        })
      )
    );

    /*
     * The same page gate `GET /bff/v0/statements` runs over the same rows.
     * This queue names no chart, so nothing about the request looks like a
     * chart read - which is exactly why it was serving `patientId` and
     * `balanceCents` for charts whose own statement read answers 404 (#300).
     *
     * Refuses the queue rather than dropping the row, because that is what the
     * crud list and the FHIR search already do on this boundary and a third
     * answer to the same question is how the two doors drift apart.
     */
    await gateCharts(
      c,
      'statements',
      pages.flatMap((page) => page.rows)
    );

    const entries = pages
      .flatMap((page) => page.rows)
      .map((row) => {
        const aged = ageBalance(balanceStateOf(row), policy, now);
        return {
          statementId: row.id,
          patientId: row.patientId,
          balanceCents: row.balanceCents,
          daysOverdue: aged.daysOverdue,
          bucket: aged.bucket,
          noticesSent: row.dunningCycle,
          lastNoticeAt: row.lastNoticeAt?.toISOString() ?? null,
          action: aged.action.kind,
          actionableAt: actionableAt(aged.action),
        } satisfies CollectionsWorklistEntry;
      })
      .filter((entry) => query.action === undefined || entry.action === query.action)
      // Oldest debt first. A biller working down a list gets to the balances
      // closest to being uncollectable before the ones that just came due.
      .sort((left, right) => right.daysOverdue - left.daysOverdue);

    return c.json({ items: entries, total: entries.length });
  });

  /**
   * ADVANCING THE DUNNING CYCLE.
   *
   * The caller says a notice went out and by which channel. It does not say
   * which notice: that comes from the row and the practice's policy, because a
   * caller who can name the cycle can place a patient anywhere on the schedule,
   * and a retried job would do exactly that by accident.
   *
   * The policy is consulted rather than trusted to the caller for the same
   * reason. If it says to wait, this refuses, and the refusal is the feature:
   * it is what stops a patient being chased twice in a week by a job that ran
   * twice.
   */
  router.post('/statements/:id/notice', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, statementNoticeSchema);
    const statements = repositories(c).statements;
    const before = required(await statements.findById(id), MISSING_STATEMENT);

    // GENERATED is where the first notice comes from, and SENT is where every
    // later one does. Anything else has left the schedule.
    if (before.status !== 'GENERATED' && before.status !== 'SENT') {
      throw ApiError.conflict(`A statement in ${before.status} is not on a dunning schedule.`);
    }

    const now = new Date();
    const balanceCents = body.balanceCents ?? before.balanceCents;
    const action = nextAction(balanceStateOf({ ...before, balanceCents }), dunningPolicy(), now);
    if (action.kind !== 'notice') {
      throw ApiError.conflict(noticeRefusal(action));
    }

    const row = required(
      await statements.update(id, {
        status: 'SENT',
        dunningCycle: action.notice,
        lastNoticeAt: now,
        deliveredVia: body.deliveredVia,
        deliveredAt: now,
        ...(body.balanceCents === undefined ? {} : { balanceCents: body.balanceCents }),
      }),
      MISSING_STATEMENT
    );
    return c.json<StatementDto>(toStatementDto(row));
  });

  /**
   * Agreeing not to chase.
   *
   * Does not change the status. A held statement is still owed and still SENT;
   * what a hold suspends is the schedule, and moving it to a state of its own
   * would take it out of the ageing report it most needs to stay in.
   */
  router.post('/statements/:id/hold', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, statementHoldSchema);
    const statements = repositories(c).statements;
    const before = required(await statements.findById(id), MISSING_STATEMENT);

    if (before.status === 'PAID' || before.status === 'VOID' || before.status === 'WRITTEN_OFF') {
      throw ApiError.conflict(`A statement in ${before.status} is not being chased.`);
    }

    const row = required(
      await statements.update(id, {
        holdUntil: new Date(body.until),
        holdReason: body.reason,
      }),
      MISSING_STATEMENT
    );
    return c.json<StatementDto>(toStatementDto(row));
  });

  /**
   * Giving up on a real debt.
   *
   * Separate from voiding, which says the statement should never have been
   * sent. The reason is required and kept, because this is one of the two
   * decisions a practice has to be able to justify afterwards.
   */
  router.post('/statements/:id/write-off', requirePermission('payment.write'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const body = await parseTransitionBody(c, statementWriteOffSchema);
    const statements = repositories(c).statements;
    const before = required(await statements.findById(id), MISSING_STATEMENT);
    assertTransition(STATEMENT_TRANSITIONS, 'statement', before.status, 'WRITTEN_OFF');

    const row = required(
      await statements.update(id, { status: 'WRITTEN_OFF', closedReason: body.reason }),
      MISSING_STATEMENT
    );
    return c.json<StatementDto>(toStatementDto(row));
  });

  return router;
}

/* --------------------------------------------------------------- collections */

/**
 * The practice's dunning policy.
 *
 * The default for now, and deliberately behind a function rather than read
 * inline, so the one place this becomes practice-configured is the one place
 * that has to change. Every caller already asks a question rather than reading
 * a constant.
 */
function dunningPolicy(): DunningPolicy {
  return DEFAULT_DUNNING_POLICY;
}

/**
 * The handful of facts the policy needs, taken off a statement row.
 *
 * `dueSince` is the delivery date, falling back to when the statement was
 * generated. Ageing measures how long the patient has had the bill, and a
 * statement sitting in a queue was never theirs to pay.
 */
function balanceStateOf(row: StatementRow): BalanceState {
  return {
    balanceCents: row.balanceCents,
    noticesSent: row.dunningCycle,
    lastNoticeAt: row.lastNoticeAt,
    dueSince: row.deliveredAt ?? row.generatedAt,
    heldUntil: row.holdUntil,
  };
}

/** Why a notice was refused, in the caller's terms rather than the policy's. */
function noticeRefusal(action: CollectionsAction): string {
  if (action.kind === 'wait') {
    return `The next notice is not due until ${action.nextNoticeDueAt.toISOString()}.`;
  }
  if (action.kind === 'held') {
    return `This balance is on hold until ${action.until.toISOString()}.`;
  }
  if (action.kind === 'settled') return 'There is no balance owed.';
  // Both remaining cases mean the schedule is finished: every notice the policy
  // defines has gone out, and what happens next is a decision rather than
  // another letter.
  return 'Every notice in the policy has been sent. Write it off or escalate it.';
}

function actionableAt(action: CollectionsAction): string | null {
  if (action.kind === 'wait') return action.nextNoticeDueAt.toISOString();
  if (action.kind === 'held') return action.until.toISOString();
  return null;
}

/* ----------------------------------------------------------------- contracts */

const TRANSITION_CONTRACTS: RouteContract[] = [
  {
    method: 'post',
    path: '/bff/v0/coverage/{id}/eligibility',
    operationId: 'checkCoverageEligibility',
    summary: 'Determine eligibility for a service date, locally.',
    description:
      'A local determination, with no clearing-house exchange behind it: it answers whether the stored policy covers the given service date, and what the plan says the copay and deductible are. The answer names itself `local` so it cannot be mistaken for a payer response. A coverage record in ENTERED_IN_ERROR is refused rather than answered.',
    tags: ['coverage'],
    permission: 'coverage.read',
    pathParams: [idParam('Coverage record')],
    body: eligibilityCheckSchema,
    responses: [
      { status: 200, description: 'The determination.', schema: eligibilityResultSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/charges/{id}/void',
    operationId: 'voidCharge',
    summary: 'Void a charge.',
    description:
      'OPEN and BILLED charges become VOIDED. A reason is required and the acting principal is recorded. A charge is never deleted, because the fee sheet has to keep showing what was once billed.',
    tags: ['charges'],
    permission: 'charge.write',
    pathParams: [idParam('Charge')],
    body: chargeVoidSchema,
    responses: [
      { status: 200, description: 'The voided charge.', schema: chargeDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/claims/{id}/scrub',
    operationId: 'scrubClaim',
    summary: 'Mark a claim as scrubbed.',
    description: 'DRAFT becomes SCRUBBED. The transition is appended to the claim history.',
    tags: ['claims'],
    permission: 'claim.write',
    pathParams: [idParam('Claim')],
    body: claimTransitionSchema,
    responses: [
      { status: 200, description: 'The scrubbed claim.', schema: claimDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/claims/{id}/submit',
    operationId: 'submitClaim',
    summary: 'Submit a scrubbed claim.',
    description:
      'SCRUBBED becomes SUBMITTED and `submittedAt` is stamped. Submitting a claim that has not been scrubbed is refused; that refusal is the reason the two states exist.',
    tags: ['claims'],
    permission: 'claim.write',
    pathParams: [idParam('Claim')],
    body: claimTransitionSchema,
    responses: [
      { status: 200, description: 'The submitted claim.', schema: claimDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/claims/{id}/status',
    operationId: 'recordClaimStatus',
    summary: 'Record an adjudication outcome.',
    description:
      'The transition an inbound 999, 277 or 835 produced, or one a person made; `source` says which. `acknowledgedAt` and `adjudicatedAt` are stamped on the states that mean them, and every move is appended to the claim history.',
    tags: ['claims'],
    permission: 'claim.write',
    pathParams: [idParam('Claim')],
    body: claimStatusChangeBodySchema,
    responses: [
      { status: 200, description: 'The claim in its new state.', schema: claimDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/claims/{id}/lines',
    operationId: 'listClaimLines',
    summary: "List a claim's service lines.",
    description: 'Ordered by `sequence`, which is the order the 837P carries them in.',
    tags: ['claims'],
    permission: 'claim.read',
    pathParams: [idParam('Claim')],
    responses: [
      {
        status: 200,
        description: 'The claim lines.',
        schema: listResponseSchema(claimLineDtoSchema),
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/claims/{id}/history',
    operationId: 'listClaimHistory',
    summary: "List a claim's transitions.",
    description:
      'Oldest first. This replaces a separate transaction-history screen: everything that ever moved the claim, whether a person or an inbound 999, 277 or 835, wrote here.',
    tags: ['claims'],
    permission: 'claim.read',
    pathParams: [idParam('Claim')],
    responses: [
      {
        status: 200,
        description: 'The claim transitions.',
        schema: listResponseSchema(claimStatusHistoryDtoSchema),
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/payments/{id}/post',
    operationId: 'postPayment',
    summary: 'Post a pending payment.',
    description: 'PENDING becomes POSTED; `postedAt` and the acting principal are stamped.',
    tags: ['payments'],
    permission: 'payment.write',
    pathParams: [idParam('Payment')],
    body: paymentTransitionSchema,
    responses: [
      { status: 200, description: 'The posted payment.', schema: paymentDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/payments/{id}/void',
    operationId: 'voidPayment',
    summary: 'Void a payment.',
    description: 'PENDING and POSTED payments become VOIDED.',
    tags: ['payments'],
    permission: 'payment.write',
    pathParams: [idParam('Payment')],
    body: paymentTransitionSchema,
    responses: [
      { status: 200, description: 'The voided payment.', schema: paymentDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/payments/{id}/refund',
    operationId: 'refundPayment',
    summary: 'Refund a posted payment.',
    description:
      'POSTED becomes REFUNDED. FAILED, VOIDED and REFUNDED are terminal. The refund itself is recorded as a negative allocation, never by editing the original amount.',
    tags: ['payments'],
    permission: 'payment.write',
    pathParams: [idParam('Payment')],
    body: paymentTransitionSchema,
    responses: [
      { status: 200, description: 'The refunded payment.', schema: paymentDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/payments/{id}/allocations',
    operationId: 'listPaymentAllocations',
    summary: 'List what a payment was applied to.',
    description: 'Oldest first. A patient balance is charges minus these.',
    tags: ['payments'],
    permission: 'payment.read',
    pathParams: [idParam('Payment')],
    responses: [
      {
        status: 200,
        description: 'The allocations.',
        schema: listResponseSchema(paymentAllocationDtoSchema),
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/remittances/{id}/parse',
    operationId: 'parseRemittance',
    summary: 'Parse a received remittance.',
    description:
      "RECEIVED becomes PARSED and the count of unmatched lines is recorded in `exceptionCount`, because an unmatched line becomes somebody's work rather than being silently dropped.",
    tags: ['remittances'],
    permission: 'payment.write',
    pathParams: [idParam('Remittance')],
    body: remittanceParseSchema,
    responses: [
      { status: 200, description: 'What parsing found.', schema: remittanceParseResultSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/remittances/{id}/post',
    operationId: 'postRemittance',
    summary: 'Post a parsed remittance.',
    description:
      'PARSED and EXCEPTIONS become POSTED. One payment is created for the advice, with an allocation per matched line. Posting with unmatched lines is allowed, and the response reports how many were skipped. A RECEIVED advice cannot be posted: nothing has looked at its lines yet.',
    tags: ['remittances'],
    permission: 'payment.write',
    pathParams: [idParam('Remittance')],
    body: remittancePostSchema,
    responses: [
      { status: 200, description: 'What posting applied.', schema: remittancePostResultSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/remittances/{id}/lines',
    operationId: 'listRemittanceLines',
    summary: "List a remittance's service lines.",
    description: 'Ordered by `sequence`, which is the order the 835 carries them in.',
    tags: ['remittances'],
    permission: 'payment.read',
    pathParams: [idParam('Remittance')],
    responses: [
      {
        status: 200,
        description: 'The service lines.',
        schema: listResponseSchema(remittanceLineDtoSchema),
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/statements/{id}/generate',
    operationId: 'generateStatement',
    summary: 'Generate a draft statement.',
    description: 'DRAFT becomes GENERATED and `generatedAt` is stamped.',
    tags: ['statements'],
    permission: 'payment.write',
    pathParams: [idParam('Statement')],
    body: statementGenerateSchema,
    responses: [
      { status: 200, description: 'The generated statement.', schema: statementDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/statements/{id}/send',
    operationId: 'sendStatement',
    summary: 'Send a generated statement.',
    description:
      'GENERATED becomes SENT, recording the delivery channel and time. A pay-link token may be supplied and must carry an expiry; the token is stored but never emitted.',
    tags: ['statements'],
    permission: 'payment.write',
    pathParams: [idParam('Statement')],
    body: statementSendSchema,
    responses: [
      { status: 200, description: 'The sent statement.', schema: statementDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/statements/{id}/notice',
    operationId: 'sendStatementNotice',
    summary: 'Send the next dunning notice.',
    description:
      'Advances the dunning cycle by one and stamps the notice date. Which notice this is comes from the practice policy and the statement, not from the caller. Answers 409 when the policy says to wait, when the balance is on hold, when nothing is owed, or when every notice has already been sent.',
    tags: ['statements'],
    permission: 'payment.write',
    pathParams: [idParam('Statement')],
    body: statementNoticeSchema,
    responses: [
      {
        status: 200,
        description: 'The statement, with the cycle advanced.',
        schema: statementDtoSchema,
      },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/statements/{id}/hold',
    operationId: 'holdStatement',
    summary: 'Suspend dunning on a balance.',
    description:
      'Records that the practice agreed not to chase this balance until the given date, and why. The status does not change: the balance is still owed and stays in the ageing report. Answers 409 for a statement that is already paid, void or written off.',
    tags: ['statements'],
    permission: 'payment.write',
    pathParams: [idParam('Statement')],
    body: statementHoldSchema,
    responses: [
      { status: 200, description: 'The statement, now on hold.', schema: statementDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'post',
    path: '/bff/v0/statements/{id}/write-off',
    operationId: 'writeOffStatement',
    summary: 'Stop pursuing a real debt.',
    description:
      'SENT becomes WRITTEN_OFF, with the reason recorded. Distinct from voiding, which says the statement should never have been sent; a practice needs to tell abandoned debt from a billing error.',
    tags: ['statements'],
    permission: 'payment.write',
    pathParams: [idParam('Statement')],
    body: statementWriteOffSchema,
    responses: [
      { status: 200, description: 'The written-off statement.', schema: statementDtoSchema },
      ...CRUD_ERRORS,
      NOT_FOUND_RESPONSE,
      CONFLICT_RESPONSE,
      UNPROCESSABLE_RESPONSE,
    ],
  },
  {
    method: 'get',
    path: '/bff/v0/collections/worklist',
    operationId: 'listCollectionsWorklist',
    summary: 'What needs chasing today.',
    description:
      'Outstanding balances with their ageing bucket and what the practice policy says to do with each, oldest debt first. The action is computed on read, so it is never stale against a payment that has landed.',
    tags: ['statements'],
    permission: 'payment.read',
    query: collectionsWorklistQuerySchema,
    responses: [
      {
        status: 200,
        description: 'The worklist.',
        schema: listResponseSchema(collectionsWorklistEntrySchema),
      },
      ...CRUD_ERRORS,
    ],
  },
];

export function financialRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // The literal sub-paths go on first. Hono matches in registration order, so
  // registering `/claims/:id/scrub` ahead of the generated `/claims/:id` is
  // what keeps a route named after a verb from ever being read as an id.
  router.route('/', transitionRoutes());

  for (const module of financialModules()) {
    router.route('/', module.routes);
  }

  return router;
}

export function financialRouteContracts(): RouteContract[] {
  return [
    ...financialModules().flatMap((module) => [...module.contracts]),
    ...TRANSITION_CONTRACTS,
  ];
}

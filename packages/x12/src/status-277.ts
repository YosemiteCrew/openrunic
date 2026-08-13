import { ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { X12Error } from './errors.js';
import { parseAmount, parseDate8 } from './format.js';
import { firstTransactionOfType, readInterchange } from './reader.js';
import type { X12Transaction } from './reader.js';
import { componentAt, locate, simpleAt } from './segments.js';
import type { Segment } from './segments.js';

/**
 * The 277 claim status decoder.
 *
 * A 277 is what moves a claim off "submitted". It arrives from the payer or
 * the clearinghouse and says, per claim, whether the thing was accepted into
 * adjudication or thrown back. The lifecycle needs exactly two things from it:
 * which of our claims it is talking about, and whether that claim advanced or
 * stalled. Everything else is detail a biller reads when it stalled.
 *
 * The decoder flattens the hierarchical levels rather than reproducing them.
 * The HL tree in a 277 exists to avoid repeating the payer and provider on
 * every claim, and nothing downstream cares about the tree itself, so keeping
 * it would be structure for its own sake.
 */

/** One STC composite: the category, the status, and who it is about. */
export interface ClaimStatusDetail {
  /** STC01-1, the health-care claim status category code, e.g. `A2`, `A3`. */
  readonly categoryCode: string;
  /** STC01-2, the status code that narrows the category. */
  readonly statusCode: string;
  /** STC01-3, the entity the status is about, when the payer names one. */
  readonly entityCode?: string;
  /** STC02, `YYYY-MM-DD`. */
  readonly effectiveDate?: string;
  /** STC03: `WQ` accept, `U` reject. */
  readonly actionCode?: string;
  /** STC04, the amount the status refers to. */
  readonly amountCents?: number;
  /** STC05, what has been paid so far. */
  readonly paidCents?: number;
  /** STC12, the payer's free-text explanation. */
  readonly freeText?: string;
}

/** One claim's status, keyed by the control number we sent in CLM01. */
export interface ClaimStatusEntry {
  /** TRN02 at the patient level, echoing the 837's CLM01. */
  readonly patientControlNumber: string;
  readonly patientName?: string;
  /** REF*1K, the payer's own claim control number once it has one. */
  readonly payerControlNumber?: string;
  readonly statuses: readonly ClaimStatusDetail[];
  /** DTP*472 service date, `YYYY-MM-DD`. Ranges keep both ends. */
  readonly serviceDateFrom?: string;
  readonly serviceDateTo?: string;
  /**
   * Whether the claim advanced. Derived from the category codes rather than
   * reported by the payer, because the payer reports a code and the lifecycle
   * needs a decision. See `REJECTION_CATEGORY_CODES` for the rule.
   */
  readonly accepted: boolean;
}

/** A decoded claim acknowledgement or status response. */
export interface StatusReport277 {
  /** BHT02: `08` status response, `11` response, `13` request. */
  readonly transactionPurpose: string;
  /** BHT03, the sender's reference for this batch. */
  readonly referenceIdentification: string;
  /** BHT04, `YYYY-MM-DD`. */
  readonly created?: string;
  readonly informationSource?: NamedEntity;
  readonly informationReceiver?: NamedEntity;
  readonly billingProvider?: NamedEntity;
  /** Statuses reported above the claim level, e.g. a whole batch rejected. */
  readonly batchStatuses: readonly ClaimStatusDetail[];
  readonly claims: readonly ClaimStatusEntry[];
  readonly controlNumbers: {
    readonly interchange: string;
    readonly transaction: string;
  };
}

/** An NM1 party reduced to what the status report actually needs. */
export interface NamedEntity {
  readonly name: string;
  readonly identifier?: string;
}

/** The implementation convention this decoder expects. */
export const IMPLEMENTATION_277 = '005010X214';

/**
 * Category codes that mean the claim did not advance.
 *
 * `A3` unprocessable, `A4` not found, `A6` missing information, `A7` invalid
 * information and `A8` a relational-field error are all "we did not adjudicate
 * this, fix it and send it again". `A1` received and `A2` accepted are the
 * happy path, and `A5` split is neutral but does not stall the claim. Anything
 * unrecognized is treated as accepted, because stalling a claim on a code we
 * do not know would be worse than letting the next status correct it.
 */
export const REJECTION_CATEGORY_CODES: readonly string[] = ['A3', 'A4', 'A6', 'A7', 'A8'];

/** Decodes a complete 277 interchange. */
export function decode277(raw: string): Result<StatusReport277, X12Error> {
  const interchange = readInterchange(raw);
  if (!interchange.ok) return interchange;

  const transaction = firstTransactionOfType(interchange.value, '277');
  if (!transaction.ok) return transaction;

  const mapped = mapStatusReport(transaction.value);
  if (!mapped.ok) return mapped;

  return ok({
    ...mapped.value,
    controlNumbers: {
      interchange: interchange.value.controlNumber,
      transaction: transaction.value.controlNumber,
    },
  });
}

type PartialReport = Omit<StatusReport277, 'controlNumbers'>;

/** Hierarchical level codes: 19 provider, 21 information receiver, PT patient. */
type Level = 'source' | 'receiver' | 'provider' | 'patient' | 'other';

function mapStatusReport(transaction: X12Transaction): Result<PartialReport, X12Error> {
  let transactionPurpose = '';
  let referenceIdentification = '';
  let created: string | undefined;
  let informationSource: NamedEntity | undefined;
  let informationReceiver: NamedEntity | undefined;
  let billingProvider: NamedEntity | undefined;
  const batchStatuses: ClaimStatusDetail[] = [];
  const claims: ClaimStatusEntry[] = [];

  let level: Level = 'other';
  let current: MutableEntry | undefined;

  const finish = (): void => {
    if (current !== undefined) {
      claims.push({
        ...current,
        statuses: [...current.statuses],
        accepted: current.statuses.every(
          (status) => !REJECTION_CATEGORY_CODES.includes(status.categoryCode)
        ),
      });
    }
    current = undefined;
  };

  for (const [offset, source] of transaction.segments.entries()) {
    const index = transaction.startIndex + 1 + offset;

    switch (source.tag) {
      case 'BHT': {
        transactionPurpose = simpleAt(source, 2);
        referenceIdentification = simpleAt(source, 3);
        const rawDate = simpleAt(source, 4);
        if (rawDate !== '') {
          const parsed = parseDate8(rawDate, locate(source, index, 4));
          if (!parsed.ok) return parsed;
          created = parsed.value;
        }
        break;
      }
      case 'HL': {
        finish();
        level = toLevel(simpleAt(source, 3));
        if (level === 'patient') {
          current = { patientControlNumber: '', statuses: [] };
        }
        break;
      }
      case 'NM1': {
        const entity: NamedEntity = {
          name: entityName(source),
          identifier: emptyToUndefined(simpleAt(source, 9)),
        };
        if (level === 'source') informationSource = entity;
        else if (level === 'receiver') informationReceiver = entity;
        else if (level === 'provider') billingProvider = entity;
        else if (current !== undefined) current.patientName = entity.name;
        break;
      }
      case 'TRN': {
        if (current !== undefined) current.patientControlNumber = simpleAt(source, 2);
        break;
      }
      case 'STC': {
        const status = readStatus(source, index);
        if (!status.ok) return status;
        if (current !== undefined) current.statuses.push(status.value);
        else batchStatuses.push(status.value);
        break;
      }
      case 'REF': {
        if (current !== undefined && simpleAt(source, 1) === '1K') {
          current.payerControlNumber = simpleAt(source, 2);
        }
        break;
      }
      case 'DTP': {
        if (current === undefined || simpleAt(source, 1) !== '472') break;
        const range = readServiceDate(source, index);
        if (!range.ok) return range;
        current.serviceDateFrom = range.value.from;
        current.serviceDateTo = range.value.to;
        break;
      }
      default:
        break;
    }
  }

  finish();

  return ok({
    transactionPurpose,
    referenceIdentification,
    created,
    informationSource,
    informationReceiver,
    billingProvider,
    batchStatuses,
    claims,
  });
}

interface MutableEntry {
  patientControlNumber: string;
  patientName?: string;
  payerControlNumber?: string;
  statuses: ClaimStatusDetail[];
  serviceDateFrom?: string;
  serviceDateTo?: string;
}

function toLevel(code: string): Level {
  switch (code) {
    case '20':
      return 'source';
    case '21':
      return 'receiver';
    case '19':
      return 'provider';
    case 'PT':
      return 'patient';
    default:
      return 'other';
  }
}

function entityName(source: Segment): string {
  const organisation = simpleAt(source, 3);
  const given = simpleAt(source, 4);
  return given === '' ? organisation : `${organisation}, ${given}`;
}

function readStatus(source: Segment, index: number): Result<ClaimStatusDetail, X12Error> {
  let effectiveDate: string | undefined;
  const rawDate = simpleAt(source, 2);
  if (rawDate !== '') {
    const parsed = parseDate8(rawDate, locate(source, index, 2));
    if (!parsed.ok) return parsed;
    effectiveDate = parsed.value;
  }

  const amounts: (number | undefined)[] = [];
  for (const position of [4, 5]) {
    const raw = simpleAt(source, position);
    if (raw === '') {
      amounts.push(undefined);
      continue;
    }
    const parsed = parseAmount(raw, locate(source, index, position));
    if (!parsed.ok) return parsed;
    amounts.push(parsed.value);
  }

  return ok({
    categoryCode: componentAt(source, 1, 1),
    statusCode: componentAt(source, 1, 2),
    entityCode: emptyToUndefined(componentAt(source, 1, 3)),
    effectiveDate,
    actionCode: emptyToUndefined(simpleAt(source, 3)),
    amountCents: amounts[0],
    paidCents: amounts[1],
    freeText: emptyToUndefined(simpleAt(source, 12)),
  });
}

interface ServiceDateRange {
  readonly from: string;
  readonly to?: string;
}

/** DTP03 is either a D8 date or an RD8 `CCYYMMDD-CCYYMMDD` range. */
function readServiceDate(source: Segment, index: number): Result<ServiceDateRange, X12Error> {
  const format = simpleAt(source, 2);
  const value = simpleAt(source, 3);
  const at = locate(source, index, 3);

  if (format === 'RD8') {
    const [from, to] = value.split('-');
    const parsedFrom = parseDate8(from ?? '', at);
    if (!parsedFrom.ok) return parsedFrom;
    const parsedTo = parseDate8(to ?? '', at);
    if (!parsedTo.ok) return parsedTo;
    return ok({ from: parsedFrom.value, to: parsedTo.value });
  }

  const parsed = parseDate8(value, at);
  if (!parsed.ok) return parsed;
  return ok({ from: parsed.value });
}

function emptyToUndefined(value: string): string | undefined {
  return value === '' ? undefined : value;
}

/**
 * Reduces a status report to the lifecycle decision it exists to drive.
 *
 * Returned as a list rather than a map so the caller can process claims in the
 * order the payer sent them, which is the order a biller will see them in the
 * work queue.
 */
export interface ClaimStatusOutcome {
  readonly patientControlNumber: string;
  readonly accepted: boolean;
  readonly payerControlNumber?: string;
  /** The first rejecting status, which is what a biller needs to act on. */
  readonly reason?: ClaimStatusDetail;
}

/** Projects the report into one accept-or-reject outcome per claim. */
export function toClaimStatusOutcomes(report: StatusReport277): readonly ClaimStatusOutcome[] {
  return report.claims.map((claim) => ({
    patientControlNumber: claim.patientControlNumber,
    accepted: claim.accepted,
    payerControlNumber: claim.payerControlNumber,
    reason: claim.statuses.find((status) => REJECTION_CATEGORY_CODES.includes(status.categoryCode)),
  }));
}

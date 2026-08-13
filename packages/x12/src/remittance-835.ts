import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { Adjustment, AdjustmentDetail } from './domain.js';
import type { X12Error } from './errors.js';
import { parseAmount, parseDate8, parseNumber } from './format.js';
import { firstTransactionOfType, readInterchange } from './reader.js';
import type { X12Transaction } from './reader.js';
import { componentAt, locate, simpleAt } from './segments.js';
import type { Segment } from './segments.js';

/**
 * The 835 remittance decoder: what the payer decided, and why.
 *
 * An 835 is not a payment notice, it is an adjudication record. The money is
 * the easy part; the reason codes are the part that decides whether a balance
 * is written off, billed to the patient, appealed or rebilled to a secondary.
 * So this decoder keeps every CAS triplet exactly as it arrived, including the
 * stacking, rather than collapsing adjustments into a single "adjusted" figure.
 * The lossy projection into the database's flat `RemittanceLine` row happens
 * separately, in `toRemittanceLines`, and the full structure is what gets
 * stored in `Remittance.parsed` so nothing is ever unrecoverable.
 */

/** BPR: the money movement itself. */
export interface RemittanceFinancials {
  /** BPR01: `I` remittance information only, `C` payment accompanies, `H` notification. */
  readonly transactionHandlingCode: string;
  readonly totalPaidCents: number;
  /** BPR03: `C` credit, `D` debit. A debit is the payer taking money back. */
  readonly creditDebitFlag: string;
  /** BPR04: `ACH`, `CHK`, `NON` and friends. */
  readonly paymentMethod: string;
  /** BPR16, `YYYY-MM-DD`. */
  readonly effectiveDate?: string;
}

/** TRN: the reassociation key that ties this advice to a deposit. */
export interface RemittanceTrace {
  /** TRN02, the check or EFT number. */
  readonly traceNumber: string;
  /** TRN03, the payer's identifier. */
  readonly payerIdentifier: string;
}

/** A party as an N1 loop carries it. */
export interface RemittanceParty {
  readonly name: string;
  readonly identifierQualifier?: string;
  readonly identifier?: string;
}

/** One SVC loop: a single adjudicated service line. */
export interface RemittanceServiceLine {
  /** One-based position within its claim, assigned by the decoder. */
  readonly sequence: number;
  readonly procedureCode: string;
  readonly modifiers: readonly string[];
  readonly chargedCents: number;
  readonly paidCents: number;
  readonly revenueCode?: string;
  readonly units?: number;
  /** AMT*B6. */
  readonly allowedCents?: number;
  /** DTM*472, `YYYY-MM-DD`. */
  readonly serviceDate?: string;
  /** REF*6R, the line control number the 837 sent, so a ClaimLine can be matched. */
  readonly lineControlNumber?: string;
  readonly adjustments: readonly Adjustment[];
  /** LQ*HE remark codes, the RARC values that explain the CARCs. */
  readonly remarkCodes: readonly string[];
}

/** One CLP loop: a single adjudicated claim. */
export interface RemittanceClaim {
  /** CLP01, echoing the 837's CLM01. This is the match key. */
  readonly patientControlNumber: string;
  /** CLP02: `1` processed as primary, `4` denied, `22` reversal of previous payment. */
  readonly statusCode: string;
  readonly chargedCents: number;
  readonly paidCents: number;
  readonly patientResponsibilityCents: number;
  /** CLP06, the claim filing indicator. */
  readonly filingIndicatorCode?: string;
  /** CLP07, the payer's own control number for this claim. */
  readonly payerControlNumber?: string;
  readonly facilityCode?: string;
  readonly frequencyCode?: string;
  readonly patient?: RemittanceParty;
  readonly correctedPatient?: RemittanceParty;
  /** Claim-level CAS, which applies to the claim as a whole rather than a line. */
  readonly adjustments: readonly Adjustment[];
  /** AMT segments at claim level, keyed by their qualifier. */
  readonly amounts: readonly RemittanceAmount[];
  /** DTM segments at claim level, keyed by their qualifier. */
  readonly dates: readonly RemittanceDate[];
  readonly lines: readonly RemittanceServiceLine[];
}

/** A qualified monetary amount, e.g. `AU` coverage amount. */
export interface RemittanceAmount {
  readonly qualifier: string;
  readonly cents: number;
}

/** A qualified date, e.g. `232` statement period start. */
export interface RemittanceDate {
  readonly qualifier: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

/**
 * PLB: an adjustment against the provider rather than against a claim.
 *
 * These are the ones that reconcile a deposit that does not equal the sum of
 * its claims: a prior overpayment being recouped, an interest payment, a
 * capitation withhold. Ignoring them is how an ERA posts to the cent and the
 * bank balance still disagrees.
 */
export interface ProviderAdjustment {
  readonly providerIdentifier: string;
  /** `YYYY-MM-DD`, the fiscal period end. */
  readonly fiscalPeriodDate?: string;
  readonly reasonCode: string;
  readonly referenceIdentifier?: string;
  readonly amountCents: number;
}

/** A fully decoded remittance advice. */
export interface Remittance835 {
  readonly financials: RemittanceFinancials;
  readonly trace: RemittanceTrace;
  /** DTM*405, `YYYY-MM-DD`. */
  readonly productionDate?: string;
  readonly payer: RemittanceParty;
  readonly payee: RemittanceParty;
  readonly claims: readonly RemittanceClaim[];
  readonly providerAdjustments: readonly ProviderAdjustment[];
  readonly controlNumbers: {
    readonly interchange: string;
    readonly group: string;
    readonly transaction: string;
  };
}

/** The implementation convention this decoder expects in ST03 and GS08. */
export const IMPLEMENTATION_835 = '005010X221A1';

/**
 * Decodes a complete 835 interchange.
 *
 * The envelope is reconciled first, by `readInterchange`, so by the time any
 * mapping runs the segment counts and control numbers are known to agree. A
 * remittance that fails that check is never partially posted.
 */
export function decode835(raw: string): Result<Remittance835, X12Error> {
  const interchange = readInterchange(raw);
  if (!interchange.ok) return interchange;

  const transaction = firstTransactionOfType(interchange.value, '835');
  if (!transaction.ok) return transaction;

  const group = interchange.value.groups.find((candidate) =>
    candidate.transactions.includes(transaction.value)
  );

  const mapped = mapRemittance(transaction.value);
  if (!mapped.ok) return mapped;

  return ok({
    ...mapped.value,
    controlNumbers: {
      interchange: interchange.value.controlNumber,
      group: group?.controlNumber ?? '',
      transaction: transaction.value.controlNumber,
    },
  });
}

type PartialRemittance = Omit<Remittance835, 'controlNumbers'>;

function mapRemittance(transaction: X12Transaction): Result<PartialRemittance, X12Error> {
  let financials: RemittanceFinancials | undefined;
  let trace: RemittanceTrace | undefined;
  let productionDate: string | undefined;
  let payer: RemittanceParty | undefined;
  let payee: RemittanceParty | undefined;
  const claims: RemittanceClaim[] = [];
  const providerAdjustments: ProviderAdjustment[] = [];

  // The 835 is a flat segment stream with implicit loops, so the decoder tracks
  // which loop it is inside rather than recursing. `currentLine` being defined
  // is what makes a CAS a line adjustment instead of a claim adjustment, and
  // getting that wrong is the single most common way an ERA parser mis-posts.
  let currentClaim: MutableClaim | undefined;
  let currentLine: MutableLine | undefined;

  const finishLine = (): void => {
    if (currentClaim !== undefined && currentLine !== undefined) {
      currentClaim.lines.push(freezeLine(currentLine));
    }
    currentLine = undefined;
  };
  const finishClaim = (): void => {
    finishLine();
    if (currentClaim !== undefined) claims.push(freezeClaim(currentClaim));
    currentClaim = undefined;
  };

  for (const [offset, current] of transaction.segments.entries()) {
    const index = transaction.startIndex + 1 + offset;

    switch (current.tag) {
      case 'BPR': {
        const total = parseAmount(simpleAt(current, 2), locate(current, index, 2));
        if (!total.ok) return total;
        const effective = simpleAt(current, 16);
        let effectiveDate: string | undefined;
        if (effective !== '') {
          const parsed = parseDate8(effective, locate(current, index, 16));
          if (!parsed.ok) return parsed;
          effectiveDate = parsed.value;
        }
        financials = {
          transactionHandlingCode: simpleAt(current, 1),
          totalPaidCents: total.value,
          creditDebitFlag: simpleAt(current, 3),
          paymentMethod: simpleAt(current, 4),
          effectiveDate,
        };
        break;
      }
      case 'TRN': {
        trace = { traceNumber: simpleAt(current, 2), payerIdentifier: simpleAt(current, 3) };
        break;
      }
      case 'N1': {
        const party: RemittanceParty = {
          name: simpleAt(current, 2),
          identifierQualifier: emptyToUndefined(simpleAt(current, 3)),
          identifier: emptyToUndefined(simpleAt(current, 4)),
        };
        if (simpleAt(current, 1) === 'PR') payer = party;
        else if (simpleAt(current, 1) === 'PE') payee = party;
        break;
      }
      case 'CLP': {
        finishClaim();
        const claim = readClaimHeader(current, index);
        if (!claim.ok) return claim;
        currentClaim = claim.value;
        break;
      }
      case 'SVC': {
        if (currentClaim === undefined) {
          return unexpected(current, index, ['CLP']);
        }
        finishLine();
        const line = readServiceLine(current, index, currentClaim.lines.length + 1);
        if (!line.ok) return line;
        currentLine = line.value;
        break;
      }
      case 'CAS': {
        const adjustment = readAdjustment(current, index);
        if (!adjustment.ok) return adjustment;
        if (currentLine !== undefined) currentLine.adjustments.push(adjustment.value);
        else if (currentClaim !== undefined) currentClaim.adjustments.push(adjustment.value);
        else return unexpected(current, index, ['CLP', 'SVC']);
        break;
      }
      case 'NM1': {
        if (currentClaim === undefined) break;
        const party: RemittanceParty = {
          name: [simpleAt(current, 3), simpleAt(current, 4)]
            .filter((part) => part !== '')
            .join(', '),
          identifierQualifier: emptyToUndefined(simpleAt(current, 8)),
          identifier: emptyToUndefined(simpleAt(current, 9)),
        };
        if (simpleAt(current, 1) === 'QC') currentClaim.patient = party;
        else if (simpleAt(current, 1) === '74') currentClaim.correctedPatient = party;
        break;
      }
      case 'AMT': {
        const amount = parseAmount(simpleAt(current, 2), locate(current, index, 2));
        if (!amount.ok) return amount;
        const qualifier = simpleAt(current, 1);
        if (currentLine !== undefined) {
          if (qualifier === 'B6') currentLine.allowedCents = amount.value;
        } else if (currentClaim !== undefined) {
          currentClaim.amounts.push({ qualifier, cents: amount.value });
        }
        break;
      }
      case 'DTM': {
        const qualifier = simpleAt(current, 1);
        const raw = simpleAt(current, 2);
        if (raw === '') break;
        const date = parseDate8(raw, locate(current, index, 2));
        if (!date.ok) return date;
        if (currentLine !== undefined) {
          if (qualifier === '472') currentLine.serviceDate = date.value;
        } else if (currentClaim !== undefined) {
          currentClaim.dates.push({ qualifier, date: date.value });
        } else if (qualifier === '405') {
          productionDate = date.value;
        }
        break;
      }
      case 'REF': {
        if (currentLine !== undefined && simpleAt(current, 1) === '6R') {
          currentLine.lineControlNumber = simpleAt(current, 2);
        }
        break;
      }
      case 'LQ': {
        if (currentLine !== undefined && simpleAt(current, 1) === 'HE') {
          currentLine.remarkCodes.push(simpleAt(current, 2));
        }
        break;
      }
      case 'PLB': {
        finishClaim();
        const adjustments = readProviderAdjustments(current, index);
        if (!adjustments.ok) return adjustments;
        providerAdjustments.push(...adjustments.value);
        break;
      }
      default:
        break;
    }
  }

  finishClaim();

  if (financials === undefined) return missing('BPR');
  if (trace === undefined) return missing('TRN');
  if (payer === undefined) return missing('N1*PR');
  if (payee === undefined) return missing('N1*PE');

  return ok({ financials, trace, productionDate, payer, payee, claims, providerAdjustments });
}

interface MutableClaim {
  patientControlNumber: string;
  statusCode: string;
  chargedCents: number;
  paidCents: number;
  patientResponsibilityCents: number;
  filingIndicatorCode?: string;
  payerControlNumber?: string;
  facilityCode?: string;
  frequencyCode?: string;
  patient?: RemittanceParty;
  correctedPatient?: RemittanceParty;
  adjustments: Adjustment[];
  amounts: RemittanceAmount[];
  dates: RemittanceDate[];
  lines: RemittanceServiceLine[];
}

interface MutableLine {
  sequence: number;
  procedureCode: string;
  modifiers: readonly string[];
  chargedCents: number;
  paidCents: number;
  revenueCode?: string;
  units?: number;
  allowedCents?: number;
  serviceDate?: string;
  lineControlNumber?: string;
  adjustments: Adjustment[];
  remarkCodes: string[];
}

function readClaimHeader(current: Segment, index: number): Result<MutableClaim, X12Error> {
  const charged = parseAmount(simpleAt(current, 3), locate(current, index, 3));
  if (!charged.ok) return charged;
  const paid = parseAmount(simpleAt(current, 4), locate(current, index, 4));
  if (!paid.ok) return paid;

  let patientResponsibilityCents = 0;
  const rawResponsibility = simpleAt(current, 5);
  if (rawResponsibility !== '') {
    const parsed = parseAmount(rawResponsibility, locate(current, index, 5));
    if (!parsed.ok) return parsed;
    patientResponsibilityCents = parsed.value;
  }

  return ok({
    patientControlNumber: simpleAt(current, 1),
    statusCode: simpleAt(current, 2),
    chargedCents: charged.value,
    paidCents: paid.value,
    patientResponsibilityCents,
    filingIndicatorCode: emptyToUndefined(simpleAt(current, 6)),
    payerControlNumber: emptyToUndefined(simpleAt(current, 7)),
    facilityCode: emptyToUndefined(simpleAt(current, 8)),
    frequencyCode: emptyToUndefined(simpleAt(current, 9)),
    adjustments: [],
    amounts: [],
    dates: [],
    lines: [],
  });
}

function readServiceLine(
  current: Segment,
  index: number,
  sequence: number
): Result<MutableLine, X12Error> {
  const charged = parseAmount(simpleAt(current, 2), locate(current, index, 2));
  if (!charged.ok) return charged;
  const paid = parseAmount(simpleAt(current, 3), locate(current, index, 3));
  if (!paid.ok) return paid;

  let units: number | undefined;
  const rawUnits = simpleAt(current, 5);
  if (rawUnits !== '') {
    const parsed = parseNumber(rawUnits, locate(current, index, 5), 'a unit count');
    if (!parsed.ok) return parsed;
    units = parsed.value;
  }

  // SVC01 is a composite: qualifier, procedure code, then up to four modifiers.
  const modifiers: string[] = [];
  for (let position = 3; position <= 6; position += 1) {
    const modifier = componentAt(current, 1, position);
    if (modifier !== '') modifiers.push(modifier);
  }

  return ok({
    sequence,
    procedureCode: componentAt(current, 1, 2),
    modifiers,
    chargedCents: charged.value,
    paidCents: paid.value,
    revenueCode: emptyToUndefined(simpleAt(current, 4)),
    units,
    adjustments: [],
    remarkCodes: [],
  });
}

/**
 * Reads one CAS segment, including its stacking.
 *
 * CAS carries a group code and then up to six independent reason/amount/
 * quantity triplets in fixed positional slots. Reading only the first is the
 * classic ERA bug: a claim whose contractual write-off, deductible and
 * coinsurance all arrived in one segment posts as if only the write-off
 * happened, and the patient never gets billed.
 */
function readAdjustment(current: Segment, index: number): Result<Adjustment, X12Error> {
  const details: AdjustmentDetail[] = [];
  for (let triplet = 0; triplet < 6; triplet += 1) {
    const reasonPosition = 2 + triplet * 3;
    const reasonCode = simpleAt(current, reasonPosition);
    if (reasonCode === '') continue;
    const amount = parseAmount(
      simpleAt(current, reasonPosition + 1),
      locate(current, index, reasonPosition + 1),
      'an adjustment amount'
    );
    if (!amount.ok) return amount;
    const rawQuantity = simpleAt(current, reasonPosition + 2);
    let quantity: number | undefined;
    if (rawQuantity !== '') {
      const parsed = parseNumber(
        rawQuantity,
        locate(current, index, reasonPosition + 2),
        'an adjustment quantity'
      );
      if (!parsed.ok) return parsed;
      quantity = parsed.value;
    }
    details.push({ reasonCode, amountCents: amount.value, quantity });
  }

  if (details.length === 0) {
    return err({
      kind: 'missing_element',
      message: 'a CAS segment must carry at least one adjustment reason',
      at: locate(current, index, 2),
    });
  }

  return ok({ groupCode: simpleAt(current, 1), details });
}

/** PLB stacks up to six reason/amount pairs the same way CAS stacks triplets. */
function readProviderAdjustments(
  current: Segment,
  index: number
): Result<readonly ProviderAdjustment[], X12Error> {
  const providerIdentifier = simpleAt(current, 1);
  let fiscalPeriodDate: string | undefined;
  const rawDate = simpleAt(current, 2);
  if (rawDate !== '') {
    const parsed = parseDate8(rawDate, locate(current, index, 2));
    if (!parsed.ok) return parsed;
    fiscalPeriodDate = parsed.value;
  }

  const out: ProviderAdjustment[] = [];
  for (let pair = 0; pair < 6; pair += 1) {
    const codePosition = 3 + pair * 2;
    const reasonCode = componentAt(current, codePosition, 1);
    if (reasonCode === '') continue;
    const amount = parseAmount(
      simpleAt(current, codePosition + 1),
      locate(current, index, codePosition + 1),
      'a provider adjustment amount'
    );
    if (!amount.ok) return amount;
    out.push({
      providerIdentifier,
      fiscalPeriodDate,
      reasonCode,
      referenceIdentifier: emptyToUndefined(componentAt(current, codePosition, 2)),
      amountCents: amount.value,
    });
  }
  return ok(out);
}

function freezeLine(line: MutableLine): RemittanceServiceLine {
  return { ...line, adjustments: [...line.adjustments], remarkCodes: [...line.remarkCodes] };
}

function freezeClaim(claim: MutableClaim): RemittanceClaim {
  return {
    ...claim,
    adjustments: [...claim.adjustments],
    amounts: [...claim.amounts],
    dates: [...claim.dates],
    lines: [...claim.lines],
  };
}

function emptyToUndefined(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function unexpected(
  current: Segment,
  index: number,
  expected: readonly string[]
): Result<never, X12Error> {
  return err({
    kind: 'unexpected_segment',
    message: `${current.tag} appeared outside the loop it belongs to`,
    at: locate(current, index),
    expected,
    actual: current.tag,
  });
}

function missing(tag: string): Result<never, X12Error> {
  return err({
    kind: 'missing_segment',
    message: `the remittance has no ${tag} segment`,
    tag,
  });
}

/**
 * The projection into the database's `RemittanceLine` rows.
 *
 * `RemittanceLine` is deliberately flat: one row per adjudicated service, with
 * a single headline adjustment group and reason. That shape is what makes the
 * accounts-receivable work queue a single indexed scan, and it is not meant to
 * be the system of record for adjudication detail. The full decoded structure
 * is stored alongside it in `Remittance.parsed`, so nothing here is lossy in a
 * way that cannot be recovered.
 *
 * Two decisions worth stating, because they are judgement calls rather than
 * transcription:
 *
 *   * A claim that arrives with no SVC loops still produces one row. Payers do
 *     send claim-level-only remittances, most often on denials, and dropping
 *     them would leave the claim looking unanswered forever.
 *   * The headline adjustment is the one with the largest absolute amount, ties
 *     broken by document order. That is the adjustment a biller would want to
 *     see first when triaging, and picking the first-in-document instead would
 *     usually surface a one-cent rounding adjustment ahead of a full denial.
 */
export interface RemittanceLineProjection {
  readonly sequence: number;
  readonly payerControlNumber?: string;
  readonly patientControlNumber: string;
  readonly code?: string;
  readonly chargedCents: number;
  readonly allowedCents: number;
  readonly paidCents: number;
  readonly patientResponsibilityCents: number;
  readonly adjustmentGroupCode?: string;
  readonly adjustmentReasonCode?: string;
  readonly remarkCodes: readonly string[];
  readonly serviceDateFrom?: string;
  readonly lineControlNumber?: string;
}

/** Projects a decoded remittance into the flat rows the ledger posts from. */
export function toRemittanceLines(remittance: Remittance835): readonly RemittanceLineProjection[] {
  const rows: RemittanceLineProjection[] = [];
  let sequence = 0;

  for (const claim of remittance.claims) {
    if (claim.lines.length === 0) {
      sequence += 1;
      const headline = headlineAdjustment(claim.adjustments);
      rows.push({
        sequence,
        payerControlNumber: claim.payerControlNumber,
        patientControlNumber: claim.patientControlNumber,
        chargedCents: claim.chargedCents,
        allowedCents: allowedFromAmounts(claim),
        paidCents: claim.paidCents,
        patientResponsibilityCents: claim.patientResponsibilityCents,
        adjustmentGroupCode: headline?.groupCode,
        adjustmentReasonCode: headline?.reasonCode,
        remarkCodes: [],
      });
      continue;
    }

    for (const line of claim.lines) {
      sequence += 1;
      const headline = headlineAdjustment(line.adjustments);
      rows.push({
        sequence,
        payerControlNumber: claim.payerControlNumber,
        patientControlNumber: claim.patientControlNumber,
        code: line.procedureCode,
        chargedCents: line.chargedCents,
        allowedCents: line.allowedCents ?? line.chargedCents - contractualTotal(line.adjustments),
        paidCents: line.paidCents,
        patientResponsibilityCents: patientResponsibilityTotal(line.adjustments),
        adjustmentGroupCode: headline?.groupCode,
        adjustmentReasonCode: headline?.reasonCode,
        remarkCodes: line.remarkCodes,
        serviceDateFrom: line.serviceDate,
        lineControlNumber: line.lineControlNumber,
      });
    }
  }

  return rows;
}

interface HeadlineAdjustment {
  readonly groupCode: string;
  readonly reasonCode: string;
}

function headlineAdjustment(adjustments: readonly Adjustment[]): HeadlineAdjustment | undefined {
  let best: HeadlineAdjustment | undefined;
  let bestMagnitude = -1;
  for (const adjustment of adjustments) {
    for (const detail of adjustment.details) {
      const magnitude = Math.abs(detail.amountCents);
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        best = { groupCode: adjustment.groupCode, reasonCode: detail.reasonCode };
      }
    }
  }
  return best;
}

/** Sums the `PR` group, which is exactly what the patient can be billed. */
function patientResponsibilityTotal(adjustments: readonly Adjustment[]): number {
  return sumWhere(adjustments, (groupCode) => groupCode === 'PR');
}

/** Sums everything the patient cannot be billed, which is what "allowed" nets out. */
function contractualTotal(adjustments: readonly Adjustment[]): number {
  return sumWhere(adjustments, (groupCode) => groupCode !== 'PR');
}

function sumWhere(
  adjustments: readonly Adjustment[],
  matches: (groupCode: string) => boolean
): number {
  let total = 0;
  for (const adjustment of adjustments) {
    if (!matches(adjustment.groupCode)) continue;
    for (const detail of adjustment.details) total += detail.amountCents;
  }
  return total;
}

function allowedFromAmounts(claim: RemittanceClaim): number {
  const allowed = claim.amounts.find((amount) => amount.qualifier === 'AU');
  return allowed?.cents ?? claim.paidCents + claim.patientResponsibilityCents;
}

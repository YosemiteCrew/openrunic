import { ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { Delimiters } from './delimiters.js';
import type { X12Error } from './errors.js';
import { parseAmount, parseDate8, parseNumber } from './format.js';
import { firstTransactionOfType, readInterchange } from './reader.js';
import type { X12Transaction } from './reader.js';
import { locate, simpleAt } from './segments.js';
import type { Segment } from './segments.js';

/**
 * The 271 eligibility response decoder.
 *
 * The answer to a 270 is not a boolean. A payer replies with a stack of EB
 * segments that between them say: the policy is active, here is the plan, here
 * is the deductible and how much of it is met, here is the copay for this
 * service type, and here is whether you are in network. A front desk needs the
 * boolean; a biller needs the stack. This decoder returns the stack and
 * derives the boolean, rather than the other way round, because deriving
 * "active" from the codes is a rule that belongs in one place.
 *
 * AAA segments are kept as first-class rejections. A payer that cannot find
 * the member is not answering "not covered", it is answering "ask again with
 * better data", and conflating those two sends a patient home who is in fact
 * insured.
 */

/** One EB segment: a single benefit statement. */
export interface BenefitDetail {
  /** EB01: `1` active coverage, `6` inactive, `A` coinsurance, `B` copay, `C` deductible. */
  readonly eligibilityCode: string;
  /** EB02: `IND` individual, `FAM` family. */
  readonly coverageLevelCode?: string;
  /** EB03, which repeats. `30` is the whole plan. */
  readonly serviceTypeCodes: readonly string[];
  /** EB04, e.g. `HM`, `PP`, `PS`. */
  readonly insuranceTypeCode?: string;
  /** EB05, the payer's own plan description. */
  readonly planDescription?: string;
  /** EB06: `23` calendar year, `27` visit, `29` remaining. */
  readonly timeQualifierCode?: string;
  /** EB07, a benefit amount. */
  readonly amountCents?: number;
  /** EB08, a benefit percentage as a fraction, e.g. `0.2` for 20 percent. */
  readonly percent?: number;
  /** EB10, the quantity, e.g. remaining visits. */
  readonly quantity?: number;
  /** EB11: `Y` authorization required, `N` not. */
  readonly authorizationRequired?: string;
  /** EB12: `Y` in plan network, `N` out. */
  readonly inPlanNetwork?: string;
  /** MSG segments that followed this EB. */
  readonly messages: readonly string[];
}

/** AAA: the payer could not answer, and says what to fix. */
export interface EligibilityRejection {
  /** AAA01: `Y` the request was valid, `N` it was not. */
  readonly validRequest: string;
  /** AAA03, the reject reason code. */
  readonly reasonCode: string;
  /** AAA04, the follow-up action code, e.g. `C` correct and resubmit. */
  readonly followUpActionCode?: string;
}

/** A party in the response, as its NM1 carries it. */
export interface EligibilityParty {
  readonly name: string;
  readonly identifier?: string;
}

/** The member, with whatever demographics the payer echoed back. */
export interface EligibilityMember extends EligibilityParty {
  readonly memberId?: string;
  /** `YYYY-MM-DD`. */
  readonly birthDate?: string;
  readonly gender?: string;
}

/** A decoded eligibility response. */
export interface EligibilityResponse271 {
  readonly payer: EligibilityParty;
  readonly provider: EligibilityParty;
  readonly subscriber: EligibilityMember;
  readonly dependent?: EligibilityMember;
  /** TRN02, echoing the trace number we sent in the 270. */
  readonly traceNumber?: string;
  readonly benefits: readonly BenefitDetail[];
  readonly rejections: readonly EligibilityRejection[];
  /** Qualified dates from DTP segments, e.g. `346` plan begin. */
  readonly dates: readonly { readonly qualifier: string; readonly date: string }[];
  /**
   * Whether any benefit says the coverage is live. Derived, not reported: see
   * `ACTIVE_ELIGIBILITY_CODES`.
   */
  readonly active: boolean;
  readonly controlNumbers: {
    readonly interchange: string;
    readonly transaction: string;
  };
}

/** The implementation convention this decoder expects. */
export const IMPLEMENTATION_271 = '005010X279A1';

/**
 * EB01 codes that mean the policy is live.
 *
 * `1` is plain active coverage. `2` active, pending investigation and `3`
 * active, pending eligibility both mean the payer expects to pay, so treating
 * them as inactive would turn away patients the payer would have covered. `4`
 * pending, `6` inactive and `7` and `8` pending or inactive variants do not
 * make the list.
 */
export const ACTIVE_ELIGIBILITY_CODES: readonly string[] = ['1', '2', '3'];

/** Decodes a complete 271 interchange. */
export function decode271(raw: string): Result<EligibilityResponse271, X12Error> {
  const interchange = readInterchange(raw);
  if (!interchange.ok) return interchange;

  const transaction = firstTransactionOfType(interchange.value, '271');
  if (!transaction.ok) return transaction;

  const mapped = mapResponse(transaction.value, interchange.value.delimiters);
  if (!mapped.ok) return mapped;

  return ok({
    ...mapped.value,
    controlNumbers: {
      interchange: interchange.value.controlNumber,
      transaction: transaction.value.controlNumber,
    },
  });
}

type PartialResponse = Omit<EligibilityResponse271, 'controlNumbers'>;

type Level = 'source' | 'receiver' | 'subscriber' | 'dependent' | 'other';

function mapResponse(
  transaction: X12Transaction,
  delimiters: Delimiters
): Result<PartialResponse, X12Error> {
  let payer: EligibilityParty = { name: '' };
  let provider: EligibilityParty = { name: '' };
  let subscriber: EligibilityMember = { name: '' };
  let dependent: EligibilityMember | undefined;
  let traceNumber: string | undefined;
  const benefits: MutableBenefit[] = [];
  const rejections: EligibilityRejection[] = [];
  const dates: { qualifier: string; date: string }[] = [];

  let level: Level = 'other';

  for (const [offset, source] of transaction.segments.entries()) {
    const index = transaction.startIndex + 1 + offset;

    switch (source.tag) {
      case 'HL': {
        level = toLevel(simpleAt(source, 3));
        break;
      }
      case 'NM1': {
        const party = readParty(source);
        if (level === 'source') payer = party;
        else if (level === 'receiver') provider = party;
        else if (level === 'subscriber') subscriber = { ...party, memberId: party.identifier };
        else if (level === 'dependent') dependent = party;
        break;
      }
      case 'TRN': {
        traceNumber = simpleAt(source, 2);
        break;
      }
      case 'DMG': {
        const rawBirthDate = simpleAt(source, 2);
        if (rawBirthDate === '') break;
        const birthDate = parseDate8(rawBirthDate, locate(source, index, 2));
        if (!birthDate.ok) return birthDate;
        const gender = emptyToUndefined(simpleAt(source, 3));
        if (level === 'dependent' && dependent !== undefined) {
          dependent = { ...dependent, birthDate: birthDate.value, gender };
        } else {
          subscriber = { ...subscriber, birthDate: birthDate.value, gender };
        }
        break;
      }
      case 'DTP': {
        const rawDate = simpleAt(source, 3);
        if (rawDate === '') break;
        // Plan periods arrive as RD8 ranges; only the start is useful here, and
        // keeping the raw range would push parsing into every consumer.
        const first = rawDate.split('-')[0] ?? '';
        const parsed = parseDate8(first, locate(source, index, 3));
        if (!parsed.ok) return parsed;
        dates.push({ qualifier: simpleAt(source, 1), date: parsed.value });
        break;
      }
      case 'EB': {
        const benefit = readBenefit(source, index, delimiters);
        if (!benefit.ok) return benefit;
        benefits.push(benefit.value);
        break;
      }
      case 'MSG': {
        const last = benefits[benefits.length - 1];
        if (last !== undefined) last.messages.push(simpleAt(source, 1));
        break;
      }
      case 'AAA': {
        rejections.push({
          validRequest: simpleAt(source, 1),
          reasonCode: simpleAt(source, 3),
          followUpActionCode: emptyToUndefined(simpleAt(source, 4)),
        });
        break;
      }
      default:
        break;
    }
  }

  return ok({
    payer,
    provider,
    subscriber,
    dependent,
    traceNumber,
    benefits: benefits.map((benefit) => ({ ...benefit, messages: [...benefit.messages] })),
    rejections,
    dates,
    active: benefits.some((benefit) => ACTIVE_ELIGIBILITY_CODES.includes(benefit.eligibilityCode)),
  });
}

interface MutableBenefit extends Omit<BenefitDetail, 'messages'> {
  messages: string[];
}

function readBenefit(
  source: Segment,
  index: number,
  delimiters: Delimiters
): Result<MutableBenefit, X12Error> {
  let amountCents: number | undefined;
  const rawAmount = simpleAt(source, 7);
  if (rawAmount !== '') {
    const parsed = parseAmount(rawAmount, locate(source, index, 7), 'a benefit amount');
    if (!parsed.ok) return parsed;
    amountCents = parsed.value;
  }

  let percent: number | undefined;
  const rawPercent = simpleAt(source, 8);
  if (rawPercent !== '') {
    const parsed = parseNumber(rawPercent, locate(source, index, 8), 'a benefit percentage');
    if (!parsed.ok) return parsed;
    percent = parsed.value;
  }

  let quantity: number | undefined;
  const rawQuantity = simpleAt(source, 10);
  if (rawQuantity !== '') {
    const parsed = parseNumber(rawQuantity, locate(source, index, 10), 'a benefit quantity');
    if (!parsed.ok) return parsed;
    quantity = parsed.value;
  }

  // EB03 is a repeating element, so it arrives as one string joined by the
  // interchange's repetition separator rather than as separate elements.
  const rawServiceTypes = simpleAt(source, 3);
  const serviceTypeCodes =
    rawServiceTypes === ''
      ? []
      : rawServiceTypes.split(delimiters.repetition).filter((code) => code !== '');

  return ok({
    eligibilityCode: simpleAt(source, 1),
    coverageLevelCode: emptyToUndefined(simpleAt(source, 2)),
    serviceTypeCodes,
    insuranceTypeCode: emptyToUndefined(simpleAt(source, 4)),
    planDescription: emptyToUndefined(simpleAt(source, 5)),
    timeQualifierCode: emptyToUndefined(simpleAt(source, 6)),
    amountCents,
    percent,
    quantity,
    authorizationRequired: emptyToUndefined(simpleAt(source, 11)),
    inPlanNetwork: emptyToUndefined(simpleAt(source, 12)),
    messages: [],
  });
}

function readParty(source: Segment): EligibilityParty {
  const organisation = simpleAt(source, 3);
  const given = simpleAt(source, 4);
  return {
    name: given === '' ? organisation : `${organisation}, ${given}`,
    identifier: emptyToUndefined(simpleAt(source, 9)),
  };
}

function toLevel(code: string): Level {
  switch (code) {
    case '20':
      return 'source';
    case '21':
      return 'receiver';
    case '22':
      return 'subscriber';
    case '23':
      return 'dependent';
    default:
      return 'other';
  }
}

function emptyToUndefined(value: string): string | undefined {
  return value === '' ? undefined : value;
}

/**
 * The front-desk answer, extracted from the stack.
 *
 * Deliberately separate from the full response: a check-in screen wants three
 * facts and a reason, and asking it to reduce a benefit stack itself would put
 * the same reduction in every caller.
 */
export interface CoverageSummary {
  readonly active: boolean;
  readonly planDescription?: string;
  /** The individual copay for the requested service type, when one was quoted. */
  readonly copayCents?: number;
  /** The individual deductible, when one was quoted. */
  readonly deductibleCents?: number;
  /** Present when the payer refused rather than answered. */
  readonly rejection?: EligibilityRejection;
}

/** Reduces a response to the four facts a check-in screen shows. */
export function toCoverageSummary(response: EligibilityResponse271): CoverageSummary {
  const active = response.benefits.find((benefit) =>
    ACTIVE_ELIGIBILITY_CODES.includes(benefit.eligibilityCode)
  );
  const copay = response.benefits.find((benefit) => benefit.eligibilityCode === 'B');
  const deductible = response.benefits.find((benefit) => benefit.eligibilityCode === 'C');

  return {
    active: response.active,
    planDescription: active?.planDescription,
    copayCents: copay?.amountCents,
    deductibleCents: deductible?.amountCents,
    rejection: response.rejections[0],
  };
}

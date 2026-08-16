import type { Cents } from './fee-schedule.js';

/**
 * SLIDING SCALE: WHAT A PATIENT WITHOUT INSURANCE IS ASKED TO PAY.
 *
 * A discount schedule keyed on household income against a published poverty
 * guideline. For a community health centre it is a condition of funding rather
 * than a kindness, and the determination has to be reproducible: a patient who
 * asks why they were charged what they were charged is entitled to an answer
 * that does not depend on who was at the desk.
 *
 * ## Why the guideline is supplied and not embedded
 *
 * The federal poverty guidelines are public data, and embedding them would be
 * the same move as the CDC growth charts. It is the wrong move here, for two
 * reasons that the growth charts do not share:
 *
 * - They change every year, and a table compiled into a release is a table that
 *   silently applies last year's threshold to this year's patients. The growth
 *   charts have not moved since 2000.
 * - They are jurisdictional. Alaska and Hawaii have their own, and a deployment
 *   outside the United States has something else entirely or nothing.
 *
 * So the practice supplies the guideline amount for the household size, and this
 * computes the percentage and applies the band. What is stored is the number the
 * practice was given by whoever funds it.
 *
 * ## Why a nominal fee is not a discount
 *
 * Most scales end in a band that charges a flat small amount rather than a
 * percentage - twenty dollars a visit regardless of the charge. That is not
 * ninety-something per cent off; it is a different rule, and expressing it as a
 * percentage would produce a different number for every charge and none of them
 * the twenty dollars the policy promises.
 */

export interface SlidingScaleBand {
  /**
   * Household income as a percentage of the guideline, inclusive.
   * A band from 0 covers a household with no income at all.
   */
  readonly fromPercent: number;
  /**
   * Exclusive, so bands meet without overlapping. `undefined` is the top band,
   * which is the one that charges full price.
   */
  readonly toPercent?: number;
  /** 0-100. What comes off the charge. */
  readonly discountPercent?: number;
  /**
   * A flat amount per visit, instead of a percentage. Where both are given the
   * nominal fee wins, because a policy that says "twenty dollars" means twenty
   * dollars rather than whichever of the two happens to be lower.
   */
  readonly nominalFeeCents?: Cents;
  /** What the practice calls this band on a statement. */
  readonly label: string;
}

export interface SlidingScale {
  readonly id: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly bands: readonly SlidingScaleBand[];
}

/** What the practice knows about the household, as it was attested. */
export interface HouseholdFinancials {
  readonly annualIncomeCents: Cents;
  /**
   * The guideline amount for this household's size, supplied by the practice.
   * See the header: it is not embedded, because it changes yearly and varies by
   * jurisdiction.
   */
  readonly guidelineAmountCents: Cents;
}

/** Why a charge came out at the number it did. */
export interface Determination {
  readonly bandLabel: string;
  /** The household's income as a percentage of the guideline, to one decimal. */
  readonly percentOfGuideline: number;
  readonly discountPercent?: number;
  readonly nominalFeeCents?: Cents;
}

export interface DiscountedCharge {
  readonly originalCents: Cents;
  readonly patientOwesCents: Cents;
  readonly discountCents: Cents;
  readonly determination: Determination;
}

/**
 * A household with no guideline to measure against cannot be placed on a scale.
 *
 * Returned rather than thrown, and returned as a named refusal rather than as a
 * silent full-price charge: "we could not determine a discount" and "this
 * patient does not qualify for one" are different answers, and only one of them
 * is something the front desk should act on without asking.
 */
export interface DeterminationRefused {
  readonly refused: true;
  readonly reason: string;
}

export function isRefused(
  value: DiscountedCharge | DeterminationRefused
): value is DeterminationRefused {
  return 'refused' in value;
}

/** Income as a percentage of the guideline, to one decimal place. */
export function percentOfGuideline(household: HouseholdFinancials): number {
  return Math.round((household.annualIncomeCents / household.guidelineAmountCents) * 1000) / 10;
}

/**
 * The band a household falls in, or undefined when none does.
 *
 * A scale with a gap in it answers undefined for a household that lands in the
 * gap, and `applyScale` turns that into a named refusal. It fails closed on
 * purpose: charging full price to somebody the policy meant to discount is the
 * failure this exists to prevent, and quietly promoting them to the next band up
 * would be a discount nobody wrote down. `validateScale` is what stops a scale
 * with a gap ever reaching a patient.
 */
export function bandFor(scale: SlidingScale, percent: number): SlidingScaleBand | undefined {
  return [...scale.bands]
    .sort((a, b) => a.fromPercent - b.fromPercent)
    .find(
      (band) =>
        percent >= band.fromPercent && (band.toPercent === undefined || percent < band.toPercent)
    );
}

/**
 * Applies the scale to a charge.
 *
 * The nominal fee is capped at the charge itself. A twenty-dollar nominal fee
 * against an eight-dollar charge would otherwise bill the patient more than the
 * service costs, which no policy intends and every patient notices.
 */
export function applyScale(
  originalCents: Cents,
  scale: SlidingScale,
  household: HouseholdFinancials
): DiscountedCharge | DeterminationRefused {
  if (household.guidelineAmountCents <= 0) {
    return {
      refused: true,
      reason:
        'No poverty guideline amount was supplied for this household size, so income cannot be placed on the scale.',
    };
  }
  if (household.annualIncomeCents < 0) {
    return { refused: true, reason: 'A household income cannot be negative.' };
  }

  const percent = percentOfGuideline(household);
  const band = bandFor(scale, percent);
  if (band === undefined) {
    return {
      refused: true,
      reason: `No band on ${scale.name} covers ${String(percent)}% of the guideline. The scale has a gap or does not reach this far.`,
    };
  }

  const determination: Determination = {
    bandLabel: band.label,
    percentOfGuideline: percent,
    ...(band.discountPercent === undefined ? {} : { discountPercent: band.discountPercent }),
    ...(band.nominalFeeCents === undefined ? {} : { nominalFeeCents: band.nominalFeeCents }),
  };

  if (band.nominalFeeCents !== undefined) {
    const owed = Math.min(band.nominalFeeCents, originalCents);
    return {
      originalCents,
      patientOwesCents: owed,
      discountCents: originalCents - owed,
      determination,
    };
  }

  const discountCents = Math.round((originalCents * (band.discountPercent ?? 0)) / 100);
  return {
    originalCents,
    patientOwesCents: originalCents - discountCents,
    discountCents,
    determination,
  };
}

/**
 * Checks a scale covers its whole range without gaps or overlaps.
 *
 * Run when a practice saves one rather than when a patient is charged. A gap
 * found at the desk is a patient waiting while somebody edits a policy; the same
 * gap found on save is a validation message.
 */
export function validateScale(scale: SlidingScale): readonly string[] {
  const problems: string[] = [];
  const sorted = [...scale.bands].sort((a, b) => a.fromPercent - b.fromPercent);

  if (sorted.length === 0) return ['A sliding scale must have at least one band.'];
  if ((sorted[0]?.fromPercent ?? 0) > 0) {
    problems.push(
      'The lowest band does not start at 0%, so the poorest households fall outside it.'
    );
  }
  if (sorted.at(-1)?.toPercent !== undefined) {
    problems.push('The highest band is bounded, so a household above it falls outside the scale.');
  }

  for (const [index, band] of sorted.entries()) {
    if (band.discountPercent === undefined && band.nominalFeeCents === undefined) {
      problems.push(`Band "${band.label}" says neither a discount nor a nominal fee.`);
    }
    if (
      band.discountPercent !== undefined &&
      (band.discountPercent < 0 || band.discountPercent > 100)
    ) {
      problems.push(`Band "${band.label}" has a discount outside 0-100%.`);
    }
    // A negative nominal fee becomes a negative balance owed: the practice
    // paying the patient to attend. The validator checked the percentage and
    // not this one, so it passed on save and surfaced at the desk.
    if (band.nominalFeeCents !== undefined && band.nominalFeeCents < 0) {
      problems.push(`Band "${band.label}" has a nominal fee below zero.`);
    }
    if (band.toPercent !== undefined && band.toPercent <= band.fromPercent) {
      problems.push(`Band "${band.label}" ends at or before it starts.`);
    }

    const next = sorted[index + 1];
    // An unbounded band anywhere but the end swallows every band above it, and
    // the top-band check does not catch it because the last band is unbounded
    // too. The scale then validates clean and applies the wrong discount to
    // everybody above this point.
    if (next !== undefined && band.toPercent === undefined) {
      problems.push(
        `Band "${band.label}" has no upper bound but is not the last, so "${next.label}" and everything above it is unreachable.`
      );
    }
    if (next === undefined || band.toPercent === undefined) continue;
    if (band.toPercent < next.fromPercent) {
      problems.push(`Nothing covers ${String(band.toPercent)}% to ${String(next.fromPercent)}%.`);
    }
    if (band.toPercent > next.fromPercent) {
      problems.push(
        `"${band.label}" and "${next.label}" overlap, so the discount depends on order.`
      );
    }
  }

  return problems;
}

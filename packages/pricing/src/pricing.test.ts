import { describe, expect, it } from 'vitest';

import { coversDate, itemFor, priceFor, scheduleOn, type FeeSchedule } from './fee-schedule.js';
import {
  applyScale,
  bandFor,
  isRefused,
  percentOfGuideline,
  validateScale,
  type SlidingScale,
} from './sliding-scale.js';

/**
 * Pricing mistakes are expensive and invisible. A practice billing a payer its
 * own contracted rate forfeits the difference on every claim and the remittance
 * balances perfectly; a sliding scale with a gap in it charges full price to
 * somebody the policy meant to discount, and nobody finds out unless they ask.
 *
 * So these assert the answers rather than the arithmetic.
 */

const STANDARD: FeeSchedule = {
  id: 'std-2026',
  name: 'Standard 2026',
  effectiveFrom: '2026-01-01',
  items: [
    { code: '99213', amountCents: 15_000 },
    { code: '71046', amountCents: 8_000 },
    { code: '71046', modifiers: ['26'], amountCents: 3_000 },
    { code: '99490', amountCents: 6_500 },
  ],
};

const CONTRACTED: FeeSchedule = {
  id: 'ehp-2026',
  name: 'Example Health Plan 2026',
  payerId: 'EHP',
  effectiveFrom: '2026-01-01',
  items: [
    { code: '99213', amountCents: 9_200 },
    { code: '71046', modifiers: ['26'], amountCents: 2_100 },
  ],
};

describe('what a practice bills, and what it will be paid', () => {
  /**
   * The billed amount comes from the standard schedule and never from the
   * payer's. Billing a payer its own contracted rate forfeits the difference
   * wherever the contract would have paid more, and it is invisible - the
   * remittance balances to the penny.
   */
  it('bills the standard rate and allows the contracted one', () => {
    const price = priceFor({ code: '99213', units: 1 }, STANDARD, CONTRACTED);

    expect(price?.billedCents).toBe(15_000);
    expect(price?.allowedCents).toBe(9_200);
    expect(price?.contractualAdjustmentCents).toBe(5_800);
  });

  it('names which schedule each half came from, so a disputed price can be traced', () => {
    const price = priceFor({ code: '99213', units: 1 }, STANDARD, CONTRACTED);

    expect(price?.billedFrom).toBe('std-2026');
    expect(price?.allowedFrom).toBe('ehp-2026');
  });

  /**
   * Absent is not zero. A contract that does not name a code has not agreed to
   * pay nothing for it, and a caller treating the two the same would write off
   * the entire charge.
   */
  it('leaves the allowed amount absent when the contract does not name the code', () => {
    const price = priceFor({ code: '99490', units: 1 }, STANDARD, CONTRACTED);

    expect(price?.billedCents).toBe(6_500);
    expect(price?.allowedCents).toBeUndefined();
    expect(price?.contractualAdjustmentCents).toBeUndefined();
    expect(price?.allowedFrom).toBeUndefined();
  });

  it('prices a self-pay charge with no contract at all', () => {
    const price = priceFor({ code: '99213', units: 1 }, STANDARD);

    expect(price?.billedCents).toBe(15_000);
    expect(price?.allowedCents).toBeUndefined();
  });

  it('answers nothing for a code no schedule prices', () => {
    expect(priceFor({ code: '00000', units: 1 }, STANDARD, CONTRACTED)).toBeUndefined();
  });

  it('multiplies by the units, and rounds a fractional result to the cent', () => {
    expect(priceFor({ code: '99213', units: 2 }, STANDARD)?.billedCents).toBe(30_000);
    // Anaesthesia time and drug quantities are genuinely fractional.
    expect(priceFor({ code: '99213', units: 1.5 }, STANDARD)?.billedCents).toBe(22_500);
    expect(priceFor({ code: '99490', units: 0.333 }, STANDARD)?.billedCents).toBe(2_165);
  });

  /**
   * A contract negotiated upward, or a standard schedule nobody has updated.
   * Reporting the adjustment as zero would hide a fee schedule that is losing
   * money on every claim.
   */
  it('reports a negative adjustment rather than flooring it at zero', () => {
    const generous: FeeSchedule = {
      ...CONTRACTED,
      items: [{ code: '99213', amountCents: 18_000 }],
    };

    const price = priceFor({ code: '99213', units: 1 }, STANDARD, generous);

    expect(price?.contractualAdjustmentCents).toBe(-3_000);
  });
});

describe('modifiers, which are different services and not variants', () => {
  /**
   * `26` is the professional component - reading a film somebody else's machine
   * produced. A schedule that ignored the modifier would bill the global rate
   * for it, which is roughly three times the work.
   */
  it('prefers the entry that names the modifiers the charge carries', () => {
    const price = priceFor({ code: '71046', modifiers: ['26'], units: 1 }, STANDARD);

    expect(price?.billedCents).toBe(3_000);
  });

  it('falls back to the unmodified entry for a charge carrying none', () => {
    expect(priceFor({ code: '71046', units: 1 }, STANDARD)?.billedCents).toBe(8_000);
  });

  it('does not use a modified entry for a charge that does not carry it', () => {
    const professionalOnly: FeeSchedule = {
      ...STANDARD,
      items: [{ code: '71046', modifiers: ['26'], amountCents: 3_000 }],
    };

    expect(itemFor(professionalOnly, { code: '71046', units: 1 })).toBeUndefined();
  });

  it('matches an entry whose modifiers are a subset of the charge’s', () => {
    const price = priceFor({ code: '71046', modifiers: ['26', 'LT'], units: 1 }, STANDARD);

    expect(price?.billedCents).toBe(3_000);
  });
});

describe('which schedule is in force', () => {
  const older: FeeSchedule = { ...STANDARD, id: 'std-2025', effectiveFrom: '2025-01-01' };
  const ended: FeeSchedule = {
    ...STANDARD,
    id: 'std-2024',
    effectiveFrom: '2024-01-01',
    effectiveTo: '2025-01-01',
  };

  /**
   * The end date is exclusive so a schedule ends the day its successor begins.
   * Inclusive bounds are how two schedules come to both claim a day, and the
   * price then depends on which the code happened to check first.
   */
  it('ends a schedule on the day its successor starts, not the day after', () => {
    expect(coversDate(ended, '2024-12-31')).toBe(true);
    expect(coversDate(ended, '2025-01-01')).toBe(false);
    expect(coversDate(older, '2025-01-01')).toBe(true);
  });

  it('takes the latest schedule that covers the date', () => {
    expect(scheduleOn([older, STANDARD, ended], '2026-06-01')?.id).toBe('std-2026');
    expect(scheduleOn([older, STANDARD, ended], '2025-06-01')?.id).toBe('std-2025');
    expect(scheduleOn([older, STANDARD, ended], '2024-06-01')?.id).toBe('std-2024');
  });

  it('keeps a payer’s schedules apart from the standard ones', () => {
    expect(scheduleOn([STANDARD, CONTRACTED], '2026-06-01')?.id).toBe('std-2026');
    expect(scheduleOn([STANDARD, CONTRACTED], '2026-06-01', 'EHP')?.id).toBe('ehp-2026');
    expect(scheduleOn([STANDARD, CONTRACTED], '2026-06-01', 'OTHER')).toBeUndefined();
  });

  it('answers nothing for a date before anything was in force', () => {
    expect(scheduleOn([STANDARD], '2023-01-01')).toBeUndefined();
  });
});

describe('the sliding scale', () => {
  const SCALE: SlidingScale = {
    id: 'scale-2026',
    name: 'Sliding Fee Discount Schedule 2026',
    effectiveFrom: '2026-01-01',
    bands: [
      { fromPercent: 0, toPercent: 101, nominalFeeCents: 2_000, label: 'Nominal fee' },
      { fromPercent: 101, toPercent: 134, discountPercent: 80, label: 'Band A' },
      { fromPercent: 134, toPercent: 167, discountPercent: 60, label: 'Band B' },
      { fromPercent: 167, toPercent: 201, discountPercent: 40, label: 'Band C' },
      { fromPercent: 201, discountPercent: 0, label: 'Full charge' },
    ],
  };

  const guideline = 15_060_00;

  it('works out where a household sits against the guideline', () => {
    expect(
      percentOfGuideline({ annualIncomeCents: 15_060_00, guidelineAmountCents: guideline })
    ).toBe(100);
    expect(
      percentOfGuideline({ annualIncomeCents: 22_590_00, guidelineAmountCents: guideline })
    ).toBe(150);
  });

  it('applies the percentage discount of the band it lands in', () => {
    const result = applyScale(15_000, SCALE, {
      annualIncomeCents: 22_590_00,
      guidelineAmountCents: guideline,
    });

    expect(isRefused(result)).toBe(false);
    if (isRefused(result)) return;
    expect(result.determination.bandLabel).toBe('Band B');
    expect(result.discountCents).toBe(9_000);
    expect(result.patientOwesCents).toBe(6_000);
  });

  /**
   * A nominal fee is not a large discount. A policy that says twenty dollars
   * means twenty dollars, and expressing it as a percentage would give a
   * different number for every charge and none of them twenty.
   */
  it('charges the nominal fee flat, whatever the charge was', () => {
    for (const charge of [15_000, 40_000, 2_500]) {
      const result = applyScale(charge, SCALE, {
        annualIncomeCents: 5_000_00,
        guidelineAmountCents: guideline,
      });

      expect(isRefused(result)).toBe(false);
      if (isRefused(result)) return;
      expect(result.patientOwesCents, String(charge)).toBe(2_000);
    }
  });

  /**
   * A twenty-dollar nominal fee against an eight-dollar charge would bill the
   * patient more than the service costs, which no policy intends and every
   * patient notices.
   */
  it('never charges a nominal fee larger than the charge itself', () => {
    const result = applyScale(800, SCALE, {
      annualIncomeCents: 0,
      guidelineAmountCents: guideline,
    });

    expect(isRefused(result)).toBe(false);
    if (isRefused(result)) return;
    expect(result.patientOwesCents).toBe(800);
    expect(result.discountCents).toBe(0);
  });

  it('charges full price at the top of the scale', () => {
    const result = applyScale(15_000, SCALE, {
      annualIncomeCents: 45_000_00,
      guidelineAmountCents: guideline,
    });

    expect(isRefused(result)).toBe(false);
    if (isRefused(result)) return;
    expect(result.patientOwesCents).toBe(15_000);
    expect(result.determination.bandLabel).toBe('Full charge');
  });

  it('explains itself, so a patient asking why has an answer', () => {
    const result = applyScale(15_000, SCALE, {
      annualIncomeCents: 18_000_00,
      guidelineAmountCents: guideline,
    });

    expect(isRefused(result)).toBe(false);
    if (isRefused(result)) return;
    expect(result.determination).toEqual({
      bandLabel: 'Band A',
      percentOfGuideline: 119.5,
      discountPercent: 80,
    });
  });

  it('puts a household exactly on a boundary in the upper band', () => {
    const result = applyScale(10_000, SCALE, {
      annualIncomeCents: guideline * 2.01,
      guidelineAmountCents: guideline,
    });

    expect(isRefused(result)).toBe(false);
    if (isRefused(result)) return;
    expect(result.determination.bandLabel).toBe('Full charge');
  });

  it('finds the band for a percentage directly', () => {
    expect(bandFor(SCALE, 0)?.label).toBe('Nominal fee');
    expect(bandFor(SCALE, 100.9)?.label).toBe('Nominal fee');
    expect(bandFor(SCALE, 101)?.label).toBe('Band A');
    expect(bandFor(SCALE, 9_999)?.label).toBe('Full charge');
  });
});

describe('what the scale refuses to determine', () => {
  const SCALE: SlidingScale = {
    id: 's',
    name: 'Test scale',
    effectiveFrom: '2026-01-01',
    bands: [{ fromPercent: 0, discountPercent: 50, label: 'Everyone' }],
  };

  /**
   * "We could not determine a discount" and "this patient does not qualify for
   * one" are different answers, and only one of them is something the front desk
   * should act on without asking.
   */
  it('refuses rather than charging full price when there is no guideline', () => {
    const result = applyScale(15_000, SCALE, {
      annualIncomeCents: 20_000_00,
      guidelineAmountCents: 0,
    });

    expect(isRefused(result)).toBe(true);
    expect(isRefused(result) && result.reason).toContain('poverty guideline');
  });

  it('refuses a negative income rather than discounting it', () => {
    const result = applyScale(15_000, SCALE, {
      annualIncomeCents: -1,
      guidelineAmountCents: 15_060_00,
    });

    expect(isRefused(result)).toBe(true);
  });

  it('refuses when no band covers the household, naming the gap', () => {
    const gapped: SlidingScale = {
      ...SCALE,
      bands: [{ fromPercent: 0, toPercent: 100, discountPercent: 50, label: 'Low' }],
    };

    const result = applyScale(15_000, gapped, {
      annualIncomeCents: 30_000_00,
      guidelineAmountCents: 15_060_00,
    });

    expect(isRefused(result)).toBe(true);
    // The reason names where the household actually fell, so whoever fixes the
    // scale knows which end of it to extend.
    expect(isRefused(result) && result.reason).toContain('199.2%');
    expect(isRefused(result) && result.reason).toContain('gap or does not reach');
  });
});

describe('validating a scale when it is saved, not when a patient is charged', () => {
  /**
   * A gap found at the desk is a patient waiting while somebody edits a policy.
   * The same gap found on save is a validation message.
   */
  it('accepts a scale that covers everything without overlapping', () => {
    const good: SlidingScale = {
      id: 's',
      name: 'Good',
      effectiveFrom: '2026-01-01',
      bands: [
        { fromPercent: 0, toPercent: 100, nominalFeeCents: 2_000, label: 'A' },
        { fromPercent: 100, toPercent: 200, discountPercent: 50, label: 'B' },
        { fromPercent: 200, discountPercent: 0, label: 'C' },
      ],
    };

    expect(validateScale(good)).toEqual([]);
  });

  it('reports a gap between two bands', () => {
    const gapped: SlidingScale = {
      id: 's',
      name: 'Gapped',
      effectiveFrom: '2026-01-01',
      bands: [
        { fromPercent: 0, toPercent: 100, discountPercent: 50, label: 'A' },
        { fromPercent: 150, discountPercent: 0, label: 'B' },
      ],
    };

    expect(validateScale(gapped)).toContain('Nothing covers 100% to 150%.');
  });

  it('reports an overlap, because the discount would depend on order', () => {
    const overlapping: SlidingScale = {
      id: 's',
      name: 'Overlapping',
      effectiveFrom: '2026-01-01',
      bands: [
        { fromPercent: 0, toPercent: 150, discountPercent: 50, label: 'A' },
        { fromPercent: 100, discountPercent: 0, label: 'B' },
      ],
    };

    expect(validateScale(overlapping).join(' ')).toContain('overlap');
  });

  it('reports a scale that leaves the poorest households outside it', () => {
    const raised: SlidingScale = {
      id: 's',
      name: 'Raised',
      effectiveFrom: '2026-01-01',
      bands: [{ fromPercent: 50, discountPercent: 50, label: 'A' }],
    };

    expect(validateScale(raised).join(' ')).toContain('does not start at 0%');
  });

  it('reports a top band that is bounded, so somebody falls off the end', () => {
    const bounded: SlidingScale = {
      id: 's',
      name: 'Bounded',
      effectiveFrom: '2026-01-01',
      bands: [{ fromPercent: 0, toPercent: 200, discountPercent: 50, label: 'A' }],
    };

    expect(validateScale(bounded).join(' ')).toContain('bounded');
  });

  it('reports a band that says neither a discount nor a fee', () => {
    const silent: SlidingScale = {
      id: 's',
      name: 'Silent',
      effectiveFrom: '2026-01-01',
      bands: [{ fromPercent: 0, label: 'A' }],
    };

    expect(validateScale(silent).join(' ')).toContain('neither a discount nor a nominal fee');
  });

  it('reports a discount outside nought to a hundred, and a band that ends before it starts', () => {
    const wrong: SlidingScale = {
      id: 's',
      name: 'Wrong',
      effectiveFrom: '2026-01-01',
      bands: [
        { fromPercent: 0, toPercent: 100, discountPercent: 150, label: 'A' },
        { fromPercent: 100, toPercent: 90, discountPercent: 10, label: 'B' },
        { fromPercent: 100, discountPercent: 0, label: 'C' },
      ],
    };
    const problems = validateScale(wrong).join(' ');

    expect(problems).toContain('outside 0-100%');
    expect(problems).toContain('ends at or before it starts');
  });

  it('reports a scale with no bands at all', () => {
    expect(
      validateScale({ id: 's', name: 'Empty', effectiveFrom: '2026-01-01', bands: [] })
    ).toEqual(['A sliding scale must have at least one band.']);
  });
});

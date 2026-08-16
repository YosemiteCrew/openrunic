/**
 * WHAT A PRACTICE SHOULD CHARGE, AND WHAT IT WILL ACTUALLY BE PAID.
 *
 * A charge has two prices and a practice needs both. There is what it bills -
 * the standard fee, the same for everyone, the number on the claim - and there
 * is what the contract with that payer says it will receive. The gap between
 * them is the contractual adjustment, and a practice that cannot see it before
 * the remittance arrives cannot tell an underpayment from a discount it already
 * agreed to.
 *
 * So `priceFor` answers both at once. The billed amount comes from the standard
 * schedule and never from the payer's; billing a payer its own contracted rate
 * is how a practice quietly forfeits the difference where the contract would
 * have paid more.
 *
 * ## Why a schedule is a list and not a formula
 *
 * Contracted rates are negotiated per code and are not derivable from anything.
 * A percentage of Medicare is how some contracts are *described*, and the
 * Medicare fee schedule is licensed data this repository cannot ship - so what
 * is stored is the resulting number, which the practice already has in the
 * contract it signed.
 */

/** Cents, always. A price in floating point is a price that drifts. */
export type Cents = number;

export interface FeeScheduleItem {
  /** CPT or HCPCS. */
  readonly code: string;
  /**
   * Modifiers this line applies to, in the order they appear on the claim.
   *
   * An entry with modifiers only matches a charge carrying the same ones. `26`
   * (professional component) and `TC` (technical component) are different
   * prices for the same code, and a schedule that ignored them would bill the
   * global rate for a reading somebody else's machine produced.
   */
  readonly modifiers?: readonly string[];
  readonly amountCents: Cents;
}

export interface FeeSchedule {
  readonly id: string;
  readonly name: string;
  /**
   * The payer this schedule is contracted with. Absent means the standard
   * schedule - what the practice bills before any contract is applied.
   */
  readonly payerId?: string;
  /** `YYYY-MM-DD`. Inclusive. */
  readonly effectiveFrom: string;
  /** `YYYY-MM-DD`. Exclusive, so a schedule ends the day its successor starts. */
  readonly effectiveTo?: string;
  readonly items: readonly FeeScheduleItem[];
}

/** The charge being priced. */
export interface ChargeLine {
  readonly code: string;
  readonly modifiers?: readonly string[];
  /** Fractional units are real: anaesthesia time, drug quantities. */
  readonly units: number;
}

export interface Price {
  /** What goes on the claim. Always the standard rate. */
  readonly billedCents: Cents;
  /**
   * What the contract says will be paid, when there is a contract that names
   * this code. Absent means no contracted rate was found - which is not the
   * same as a contracted rate of zero, and a caller must not treat it as one.
   */
  readonly allowedCents?: Cents;
  /** `billed - allowed`, when both are known. What the payer will write off. */
  readonly contractualAdjustmentCents?: Cents;
  /** Which schedule supplied each half, so a disputed price can be traced. */
  readonly billedFrom: string;
  readonly allowedFrom?: string;
}

/**
 * Whether a schedule covers a date.
 *
 * `effectiveTo` is exclusive so a schedule ends the day its successor begins.
 * Inclusive bounds are how two schedules come to both claim a day, and the
 * price on that day then depends on which one the code happened to check first.
 */
export function coversDate(schedule: FeeSchedule, isoDate: string): boolean {
  if (isoDate < schedule.effectiveFrom) return false;
  return schedule.effectiveTo === undefined || isoDate < schedule.effectiveTo;
}

/**
 * The best matching item, or undefined.
 *
 * An entry naming modifiers wins over one that does not, because it is the more
 * specific statement about this exact charge. An entry naming modifiers the
 * charge does not carry does not match at all: `26` is a different service from
 * the global code, not a variant of it.
 */
export function itemFor(schedule: FeeSchedule, line: ChargeLine): FeeScheduleItem | undefined {
  const candidates = schedule.items.filter((item) => item.code === line.code);
  const carried = new Set(line.modifiers ?? []);

  const specific = candidates.find(
    (item) =>
      (item.modifiers?.length ?? 0) > 0 &&
      (item.modifiers ?? []).every((modifier) => carried.has(modifier))
  );
  if (specific !== undefined) return specific;

  return candidates.find((item) => (item.modifiers?.length ?? 0) === 0);
}

/**
 * Prices one charge line.
 *
 * `standard` is what the practice bills. `contracted` is the payer's schedule
 * when one applies, and is used only to work out what will be paid - never to
 * set the billed amount. Billing a payer its own contracted rate forfeits the
 * difference wherever the contract would have paid more than the practice
 * expected, and it is invisible: the remittance balances perfectly.
 */
export function priceFor(
  line: ChargeLine,
  standard: FeeSchedule,
  contracted?: FeeSchedule
): Price | undefined {
  const standardItem = itemFor(standard, line);
  if (standardItem === undefined) return undefined;

  const billedCents = round(standardItem.amountCents * line.units);
  const contractedItem = contracted === undefined ? undefined : itemFor(contracted, line);

  if (contracted === undefined || contractedItem === undefined) {
    return { billedCents, billedFrom: standard.id };
  }

  const allowedCents = round(contractedItem.amountCents * line.units);
  return {
    billedCents,
    allowedCents,
    // A contract may allow more than the practice bills - a rate negotiated
    // upward, or a standard schedule nobody has updated. The adjustment is then
    // negative, and reporting it as zero would hide a fee schedule that is out
    // of date and losing money on every claim.
    contractualAdjustmentCents: billedCents - allowedCents,
    billedFrom: standard.id,
    allowedFrom: contracted.id,
  };
}

/**
 * The schedule in force on a date, from a practice's set.
 *
 * The latest-starting one that covers the date, so a schedule superseded
 * mid-year wins over the one it replaced even where both are still marked
 * effective. A practice that has both loaded is the normal case during a
 * contract change, and the newer one is what was agreed.
 */
export function scheduleOn(
  schedules: readonly FeeSchedule[],
  isoDate: string,
  payerId?: string
): FeeSchedule | undefined {
  return schedules
    .filter((schedule) => schedule.payerId === payerId && coversDate(schedule, isoDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/**
 * Money is integral. A fractional unit count produces a fractional cent, and
 * the only question is which way it goes - so it goes to the nearest, and it
 * goes there in one place rather than at every call site.
 */
function round(value: number): Cents {
  return Math.round(value);
}

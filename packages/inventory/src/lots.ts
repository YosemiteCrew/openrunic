/**
 * LOTS: THE UNIT OF TRUST IN A STOCKROOM.
 *
 * Stock is not fungible. Two boxes of the same vaccine are the same product and
 * different lots, and the difference is the whole reason this file exists: a
 * recall names a lot, an expiry belongs to a lot, and a patient who received a
 * recalled dose is found by asking which lot was administered to whom. A system
 * that tracked only "142 doses on hand" can answer none of those questions, and
 * the day it needs to answer them is the day it cannot.
 *
 * ## Everything here is asked "as of" a date
 *
 * No function in this package reads the clock. Expiry, beyond-use, usability -
 * each takes the date to judge against. Three reasons, in ascending order of how
 * much they matter:
 *
 * - A test that cannot fix the date tests a different thing every day it runs.
 * - A back-dated correction has to be judged against the date of the event, not
 *   the date somebody got round to entering it. A dose administered on the 3rd
 *   from a lot that expired on the 5th was not an expired dose, and the record
 *   has to be able to say so in June.
 * - A clock read deep inside a calculation is a dependency nothing declares.
 *
 * ## What this file does not decide
 *
 * Whether stock exists. A lot is a description of a batch; how much of it is
 * left is a question for the ledger, which derives it from movements. Keeping
 * the two apart is what stops a quantity being edited in place - see
 * `ledger.ts`, where the same reasoning is spelled out at length.
 */

/** An ISO date, `YYYY-MM-DD`. Stock dates are days, never instants. */
export type IsoDate = string;

/**
 * Why a lot is unavailable, when it is.
 *
 * Separate states rather than one `available: boolean`, because they call for
 * different actions and carry different urgency. Expired stock is waste to be
 * disposed of. Recalled stock is a patient-safety event with a notification
 * attached. Quarantined stock may well come back. A single flag would tell the
 * stockroom that something is wrong and not what.
 */
export type LotStatus =
  /** On the shelf and usable, subject to its dates. */
  | 'AVAILABLE'
  /** Held pending inspection - a cold-chain excursion, a damaged carton. */
  | 'QUARANTINED'
  /** Withdrawn by the manufacturer or a regulator. Never usable again. */
  | 'RECALLED'
  /** Disposed of, returned, or otherwise gone. Kept for the audit trail. */
  | 'RETIRED';

export interface Lot {
  readonly id: string;
  /** The stock item this is a batch of. */
  readonly itemId: string;
  /** The manufacturer's lot number, as printed on the carton. */
  readonly lotNumber: string;
  readonly status: LotStatus;
  /**
   * The last day the lot may be used, inclusive.
   *
   * Inclusive is the pharmacy convention and not an arbitrary choice: a carton
   * stamped with a date is good through the end of that date. Treating it as
   * exclusive discards a day of every lot in the building, which on a fridge
   * full of vaccine is real waste and looks like nothing in the code.
   *
   * Optional, because not everything expires. A box of tongue depressors has no
   * date on it, and giving it a sentinel far-future one would be a fact nobody
   * recorded.
   */
  readonly expiresOn?: IsoDate;
  /**
   * When the lot was first opened, for products whose clock starts then.
   *
   * A multi-dose vial has two deadlines: the manufacturer's expiry, and a much
   * shorter beyond-use window once the stopper is pierced. The second usually
   * runs out first, and it is the one a practice forgets, because it is not
   * printed on anything.
   */
  readonly openedOn?: IsoDate;
  /** Days after opening the lot remains usable. Meaningless without `openedOn`. */
  readonly beyondUseDays?: number;
  /** When it arrived, used to break ties between equal expiries. */
  readonly receivedOn: IsoDate;
}

/**
 * Adds days to an ISO date, in UTC.
 *
 * Through `Date.UTC` rather than string arithmetic, so month ends and leap days
 * are the platform's problem rather than this file's. UTC rather than local,
 * because a stockroom in a `UTC-5` zone would otherwise cross midnight five
 * hours early and retire a lot a day sooner than the carton says.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  // Matched rather than split-and-default. Splitting `'2026'` yields a year and
  // two undefineds, and defaulting those to January the 1st turns a truncated
  // date into a plausible one: `addDays('2026', 1)` came back '2026-01-02' and
  // looked like an answer. A shape this function cannot honestly interpret has
  // to say so, because every date in this package feeds an expiry decision.
  const parts = /^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})$/u.exec(date);
  if (parts?.groups === undefined) {
    throw new RangeError(`${date} is not a YYYY-MM-DD date.`);
  }
  const year = Number(parts.groups['y']);
  const month = Number(parts.groups['m']);
  const day = Number(parts.groups['d']);

  // The input is validated by round-trip rather than by range checks, because
  // `Date.UTC` rolls over rather than refusing: month 13 becomes next January
  // and the 30th of February becomes the 2nd of March, silently. That rollover
  // is exactly what makes the day arithmetic below work across a month end, so
  // it cannot be switched off - the input has to be proved real before the
  // offset is applied, while the two are still separable.
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`${date} is not a date that exists.`);
  }

  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The last day a lot may be used, from whichever of its two clocks runs out
 * first.
 *
 * `undefined` when neither applies: a lot with no expiry that has not been
 * opened has no last day, and that is different from having one in the past.
 */
export function lastUsableDay(lot: Lot): IsoDate | undefined {
  const beyondUse =
    lot.openedOn === undefined || lot.beyondUseDays === undefined
      ? undefined
      : addDays(lot.openedOn, lot.beyondUseDays);

  if (lot.expiresOn === undefined) return beyondUse;
  if (beyondUse === undefined) return lot.expiresOn;
  // The earlier of the two, because a vial opened three weeks before its
  // printed expiry stops being usable when the beyond-use window closes, not
  // when the carton says.
  return beyondUse < lot.expiresOn ? beyondUse : lot.expiresOn;
}

/** True when the lot's last usable day is behind `asOf`. Inclusive; see `Lot`. */
export function isExpired(lot: Lot, asOf: IsoDate): boolean {
  const last = lastUsableDay(lot);
  return last !== undefined && last < asOf;
}

/**
 * Why a lot cannot be drawn from, or `undefined` when it can.
 *
 * A reason rather than a boolean. The caller that refuses a dispense has to tell
 * somebody why, and "no stock available" in front of a fridge with four visible
 * cartons in it is the message that makes people stop trusting the system and
 * start keeping a paper book.
 */
export function unusableReason(lot: Lot, asOf: IsoDate): string | undefined {
  if (lot.status === 'RECALLED') {
    return `Lot ${lot.lotNumber} was recalled and must not be used.`;
  }
  if (lot.status === 'QUARANTINED') {
    return `Lot ${lot.lotNumber} is quarantined pending inspection.`;
  }
  if (lot.status === 'RETIRED') {
    return `Lot ${lot.lotNumber} has been retired from stock.`;
  }
  if (isExpired(lot, asOf)) {
    const last = lastUsableDay(lot);
    const opened = lot.openedOn !== undefined && last !== lot.expiresOn;
    return opened
      ? `Lot ${lot.lotNumber} passed its beyond-use date on ${String(last)}, ${String(lot.beyondUseDays)} days after it was opened.`
      : `Lot ${lot.lotNumber} expired on ${String(last)}.`;
  }
  return undefined;
}

export function isUsable(lot: Lot, asOf: IsoDate): boolean {
  return unusableReason(lot, asOf) === undefined;
}

/**
 * Usable lots, soonest to expire first.
 *
 * First-expired-first-out, not first-in-first-out. The two agree only when
 * stock arrives in the order it expires, which is exactly what does not happen:
 * a delivery of short-dated stock arrives after a long-dated one all the time,
 * and FIFO would hold the short-dated box behind it until it expired on the
 * shelf. The waste is invisible in the code and obvious in the bin.
 *
 * A lot with no expiry sorts last. It cannot go off, so there is never a reason
 * to spend it ahead of something that can.
 *
 * Ties break on `receivedOn`, then on `id`. The last of those decides nothing
 * clinically and exists so the order is total: two lots that tie on everything
 * else would otherwise come out in whatever order the caller's array happened to
 * be in, and an allocation that is not reproducible cannot be reconciled against
 * a second run of the same numbers.
 */
export function fefo(lots: readonly Lot[], asOf: IsoDate): readonly Lot[] {
  return lots
    .filter((lot) => isUsable(lot, asOf))
    .toSorted((a, b) => {
      const aLast = lastUsableDay(a);
      const bLast = lastUsableDay(b);
      if (aLast !== bLast) {
        if (aLast === undefined) return 1;
        if (bLast === undefined) return -1;
        return aLast < bLast ? -1 : 1;
      }
      if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
}

/**
 * Lots that will expire within `days` of `asOf` and are still usable.
 *
 * What a stockroom runs weekly to find what to use up or move. Already-expired
 * lots are excluded rather than included as the most urgent: they are waste to
 * dispose of, not stock to prioritise, and mixing the two into one list gives
 * the person reading it two different jobs under one heading.
 */
export function expiringWithin(lots: readonly Lot[], asOf: IsoDate, days: number): readonly Lot[] {
  const horizon = addDays(asOf, days);
  return fefo(lots, asOf).filter((lot) => {
    const last = lastUsableDay(lot);
    return last !== undefined && last <= horizon;
  });
}

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

const ISO_DATE = /^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})$/u;

/**
 * Refuses a date this package cannot compare, before anything compares it.
 *
 * Every date comparison here is lexicographic, which is correct for
 * `YYYY-MM-DD` and silently wrong for anything else. An unpadded month is the
 * dangerous case rather than obvious garbage: `'2026-8-01' < '2026-09-01'` is
 * false, because `'8'` sorts after `'0'`, so a lot that expired in August reads
 * as unexpired in September and `fefo` hands it to a patient. Nothing throws,
 * nothing logs, and the stock is administered.
 *
 * The type is an alias for `string`, so it stops nothing arriving from a form
 * or a column - which is exactly where a non-canonical date comes from. This is
 * checked at runtime for that reason: a compile-time brand would guarantee the
 * shape of dates written in this repository and say nothing about the ones that
 * matter.
 *
 * Validated once per lot at the head of the operation rather than inside the
 * comparator, so an n-lot sort costs n checks instead of n log n.
 */
export function assertIsoDate(
  date: IsoDate,
  what: string
): { year: number; month: number; day: number } {
  const parts = ISO_DATE.exec(date);
  if (parts?.groups === undefined) {
    throw new RangeError(`${what} must be a YYYY-MM-DD date, not ${JSON.stringify(date)}.`);
  }
  const year = Number(parts.groups['y']);
  const month = Number(parts.groups['m']);
  const day = Number(parts.groups['d']);
  // Round-trip rather than range checks: `Date.UTC` rolls over rather than
  // refusing, so the 30th of February would otherwise pass as the 2nd of March.
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`${what} is not a date that exists: ${JSON.stringify(date)}.`);
  }
  // Returned rather than discarded, so a caller does not re-parse what this has
  // already proved. `addDays` used to split the string again and default each
  // missing part - `year ?? 0`, `month ?? 1` - which was the original truncated
  // date bug, and the defaults survived the fix as unreachable code that read
  // as though a malformed date could still get past this function.
  return { year, month, day };
}

/**
 * Why a lot is unavailable, when it is.
 *
 * Separate states rather than one `available: boolean`, because they call for
 * different actions and carry different urgency. Expired stock is waste to be
 * disposed of. Recalled stock is a patient-safety event with a notification
 * attached. Quarantined stock may well come back. A single flag would tell the
 * stockroom that something is wrong and not what.
 */
const LOT_STATUSES = ['AVAILABLE', 'QUARANTINED', 'RECALLED', 'RETIRED'] as const;

const KNOWN_STATUSES: ReadonlySet<string> = new Set<string>(LOT_STATUSES);

export function isKnownLotStatus(status: string): status is LotStatus {
  return KNOWN_STATUSES.has(status);
}

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
  // Validated before the offset, because `Date.UTC` rolls over rather than
  // refusing and that rollover is exactly what makes the arithmetic work across
  // a month end. The input has to be proved real while the two are separable.
  const parts = assertIsoDate(date, 'date');
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * Refuses a beyond-use window that is not a whole number of days.
 *
 * The package took the value straight into `addDays`, so a negative one
 * produced a last-usable day before the vial was opened - a lot reported
 * expired earlier than its recorded shelf life - and `Date.UTC` silently
 * truncated a fractional one. The field is documented as a count of days, and
 * a stored value that is not one is bad data to surface rather than round.
 */
function assertWholeDays(days: number, lotNumber: string): void {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(
      `Lot ${lotNumber} has a beyond-use window of ${String(days)} days, which is not a whole number of days at or above zero.`
    );
  }
}

/**
 * The last day a lot may be used, from whichever of its two clocks runs out
 * first.
 *
 * `undefined` when neither applies: a lot with no expiry that has not been
 * opened has no last day, and that is different from having one in the past.
 */
export function lastUsableDay(lot: Lot, asOf: IsoDate): IsoDate | undefined {
  if (lot.expiresOn !== undefined) assertIsoDate(lot.expiresOn, `lot ${lot.lotNumber} expiresOn`);
  if (lot.openedOn !== undefined) assertIsoDate(lot.openedOn, `lot ${lot.lotNumber} openedOn`);
  assertIsoDate(asOf, 'asOf');

  // The beyond-use clock starts when the vial is pierced, so it does not exist
  // on any date before that. Applying it regardless made a lot opened on the
  // 10th carry an October deadline in a query asked about the 1st - a date
  // derived from something that had not happened, sorting the lot ahead of a
  // December expiry in a back-dated FEFO and appearing in that month's
  // expiring-soon report. The as-of contract this file opens with is exactly
  // the promise that was broken.
  const opened = lot.openedOn !== undefined && lot.openedOn <= asOf;
  // Validated only once the window is in force, which is the same rule as
  // applying it. Checking it unconditionally meant a back-dated report failed
  // on a bad value belonging to an event that had not happened on the date
  // asked about - the as-of fix, undone one line below itself by the guard
  // added with it.
  if (opened && lot.beyondUseDays !== undefined) {
    assertWholeDays(lot.beyondUseDays, lot.lotNumber);
  }
  const beyondUse =
    !opened || lot.openedOn === undefined || lot.beyondUseDays === undefined
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
  assertIsoDate(asOf, 'asOf');
  const last = lastUsableDay(lot, asOf);
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
  assertIsoDate(asOf, 'asOf');
  // Checked here rather than only inside `fefo`, because a caller asking about
  // one lot got a different answer from a caller asking about the shelf. Not
  // yet received is not on the shelf, and `isUsable(lot, before-it-arrived)`
  // answering true let a caller approve stock the practice did not have.
  //
  // After the status clauses below would be too late for the opposite reason a
  // status check has to come first, so the ordering is: status, then receipt,
  // then the dates. A held lot with a corrupt receipt date is still discarded
  // by its status without anyone reading the date.
  // Checked first, and failing closed. Without it an unrecognised status - a
  // misspelled `RECALLED` deserialised from a column - matches none of the
  // clauses below, falls through to the expiry check, and comes out usable.
  // Recalled stock reading as available is the one outcome in this file that
  // reaches a patient, so an unknown status is refused rather than assumed
  // benign. The type does not help here: the string arrives from a database.
  if (!isKnownLotStatus(lot.status)) {
    return `Lot ${lot.lotNumber} has status ${JSON.stringify(lot.status)}, which is not one this system knows, so it cannot be treated as available.`;
  }
  if (lot.status === 'RECALLED') {
    return `Lot ${lot.lotNumber} was recalled and must not be used.`;
  }
  if (lot.status === 'QUARANTINED') {
    return `Lot ${lot.lotNumber} is quarantined pending inspection.`;
  }
  if (lot.status === 'RETIRED') {
    return `Lot ${lot.lotNumber} has been retired from stock.`;
  }
  assertIsoDate(lot.receivedOn, `lot ${lot.lotNumber} receivedOn`);
  if (lot.receivedOn > asOf) {
    return `Lot ${lot.lotNumber} was not received until ${lot.receivedOn}.`;
  }
  if (isExpired(lot, asOf)) {
    const last = lastUsableDay(lot, asOf);
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
  assertIsoDate(asOf, 'asOf');
  // Deduped by id first. A join that returns a lot twice would otherwise put
  // two candidates on the shelf holding the same stock, and `allocate` would
  // hand out its balance once per copy - a lot with ten units satisfying a
  // request for twenty and going to -10 when the movements are posted, past a
  // guarantee that allocation never takes more than a lot holds.
  const unique = new Map<string, Lot>();
  for (const lot of lots) {
    const seen = unique.get(lot.id);
    if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(lot)) {
      throw new RangeError(
        `Lot ${lot.id} was supplied twice with different contents, so there is no one answer for its expiry or status.`
      );
    }
    unique.set(lot.id, lot);
  }

  return (
    [...unique.values()]
      // Not-yet-received is refused by `unusableReason` alongside the statuses and
      // the dates, so every caller gets the same answer whether it asks about one
      // lot or about the shelf.
      .filter((lot) => isUsable(lot, asOf))
      .toSorted((a, b) => {
        const aLast = lastUsableDay(a, asOf);
        const bLast = lastUsableDay(b, asOf);
        if (aLast !== bLast) {
          if (aLast === undefined) return 1;
          if (bLast === undefined) return -1;
          return aLast < bLast ? -1 : 1;
        }
        if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      })
  );
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
    const last = lastUsableDay(lot, asOf);
    return last !== undefined && last <= horizon;
  });
}

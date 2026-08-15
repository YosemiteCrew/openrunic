import { CcdaError } from './xml/errors.js';

/**
 * HL7 v3 timestamps, in both directions.
 *
 * CDA does not use ISO 8601. It uses `YYYYMMDDHHMMSS±ZZzz`, with any suffix
 * truncated away to express a lower precision: `2026`, `202608`, `20260814` and
 * `20260814093000+0000` are all valid and all mean different things.
 *
 * That truncation is the reason this file exists rather than a call to
 * `toISOString().replace(/\D/g, '')`. A date of birth is a date, and writing it
 * with a time turns "born on the 14th" into "born at midnight UTC on the 14th",
 * which is a different day in half the world. Precision is carried, not
 * normalised away.
 */

/** `20260814093000+0000` - a full instant, always in UTC. */
export function hl7Instant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new CcdaError(`Cannot write ${iso} as an HL7 timestamp: it is not a date.`);
  }
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+0000`
  );
}

/** `20260814` - a date with no time, from `YYYY-MM-DD`. */
export function hl7Date(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match === null) {
    throw new CcdaError(`Cannot write ${isoDate} as an HL7 date: expected YYYY-MM-DD.`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

/**
 * Reads an HL7 timestamp back, at whatever precision it was written.
 *
 * Returns `YYYY-MM-DD` for a value with no time on it and an ISO instant for one
 * that has a time, so the precision survives the round trip rather than being
 * invented in one direction and discarded in the other.
 */
export function fromHl7(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const raw = value.trim();

  const match = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4}|Z)?$/.exec(
    raw
  );
  if (match === null) {
    throw new CcdaError(`Cannot read ${value} as an HL7 timestamp.`);
  }

  const [, year, month = '01', day = '01', hour, minute = '00', second = '00', zone] = match;
  if (hour === undefined) return `${year}-${month}-${day}`;

  const offset =
    zone === undefined || zone === 'Z' ? '+00:00' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const instant = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  if (Number.isNaN(instant.getTime())) {
    throw new CcdaError(`Cannot read ${value} as an HL7 timestamp: the fields are out of range.`);
  }
  return instant.toISOString();
}

/** The two shapes this codec writes: a date, or an ISO instant. */
const READABLE = /^(\d{4}-\d{2}-\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * How a date is shown to a person reading the narrative.
 *
 * The narrative is what a clinician sees when the receiving system cannot map
 * the entries, so a value it cannot read is shown as it arrived: a reader can
 * make something of `sometime in 2019`, and nothing of a blank.
 *
 * Matched against the grammar rather than handed to `new Date`, which is
 * lenient in a way that is actively harmful here - it reads `sometime in 2019`
 * as the last day of 2018, and a narrative that shows a clinician a date nobody
 * recorded is worse than one that shows them the text somebody did.
 */
export function readableDate(value: string | undefined): string {
  if (value === undefined || value === '') return '';

  const match = READABLE.exec(value.trim());
  if (match === null) return value;

  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

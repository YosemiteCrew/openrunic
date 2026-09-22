import { Hl7Error } from './errors.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function isCalendarDate(year: string, month: string, day: string): boolean {
  const value = `${year}-${month}-${day}`;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * HL7 timestamps, in both directions.
 *
 * `YYYYMMDDHHMMSS[.S...][+/-ZZZZ]`, truncated from the right to express a lower
 * precision. `19940302` is a date and `199403020930` is a date and a time, and
 * the difference matters: a date of birth read as an instant moves a day for
 * anybody not on UTC, and a date of birth that moves is one that stops matching
 * the patient on the other side.
 *
 * So precision is carried rather than normalised. A value with no time comes
 * back as `YYYY-MM-DD`; one with a time comes back as an ISO instant.
 */

/** `20260814093000+0000` - a full instant, always written in UTC. */
export function hl7Instant(iso: string): string {
  const calendar = ISO_DATE_PREFIX.exec(iso);
  const date = new Date(iso);
  if (
    Number.isNaN(date.getTime()) ||
    (calendar !== null && !isCalendarDate(calendar[1]!, calendar[2]!, calendar[3]!))
  ) {
    throw new Hl7Error(`Cannot write ${iso} as an HL7 timestamp: it is not a date.`);
  }
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+0000`
  );
}

/** `20260814` - a date with no time, from `YYYY-MM-DD`. */
export function hl7Date(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) {
    throw new Hl7Error(`Cannot write ${isoDate} as an HL7 date: expected YYYY-MM-DD.`);
  }
  if (!isCalendarDate(match[1]!, match[2]!, match[3]!)) {
    throw new Hl7Error(`Cannot write ${isoDate} as an HL7 date: the fields are out of range.`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

/** Writes a date as a date and an instant as an instant. */
export function writeTime(value: string): string {
  return value.length === 10 ? hl7Date(value) : hl7Instant(value);
}

const TIMESTAMP = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4})?$/;

/** Reads an HL7 timestamp at whatever precision it was written, or undefined. */
export function fromHl7(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const match = TIMESTAMP.exec(value.trim());
  if (match === null) {
    throw new Hl7Error(`Cannot read ${value} as an HL7 timestamp.`);
  }

  const [, year, month = '01', day = '01', hour, minute = '00', second = '00', zone] = match;
  if (!isCalendarDate(year!, month, day)) {
    throw new Hl7Error(`Cannot read ${value} as an HL7 timestamp: the fields are out of range.`);
  }
  if (hour === undefined) return `${year}-${month}-${day}`;

  const offset = zone === undefined ? '+00:00' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const instant = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  if (Number.isNaN(instant.getTime())) {
    throw new Hl7Error(`Cannot read ${value} as an HL7 timestamp: the fields are out of range.`);
  }
  return instant.toISOString();
}

/** A date, from a timestamp of any precision. */
export function dateFromHl7(value: string | undefined): string | undefined {
  return fromHl7(value)?.slice(0, 10);
}

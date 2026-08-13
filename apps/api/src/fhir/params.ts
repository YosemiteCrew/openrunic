import { ApiError } from '../errors.js';
import { MAX_PAGE_SIZE } from '../schemas/pagination.js';

/**
 * Reading FHIR search parameters.
 *
 * Everything here refuses rather than guesses. FHIR permits a server to ignore
 * a parameter it does not understand, and that permission is a trap for a
 * clinical system: a client searching `?birthdate=1994-03-02&_has:Condition...`
 * would silently receive every patient in the practice and believe it had
 * received the filtered set. A refusal costs the client one round trip; a
 * silent widening costs somebody a privacy incident.
 */

export interface FhirPaging {
  count: number;
  offset: number;
}

/** The raw query string, as Hono hands it over. */
export type SearchParams = Record<string, string>;

export function rejectUnsupportedParams(
  resourceType: string,
  query: SearchParams,
  accepted: ReadonlySet<string>
): void {
  const unsupported = Object.keys(query).filter((name) => !accepted.has(name));
  if (unsupported.length === 0) return;

  throw ApiError.malformed(
    `Unsupported search ${unsupported.length === 1 ? 'parameter' : 'parameters'} for ${resourceType}: ${unsupported.join(', ')}. See /fhir/metadata for what this server supports.`,
    {
      fhirIssueCode: 'not-supported',
      issues: unsupported.map((name) => ({
        path: name,
        message: 'not a supported search parameter',
      })),
    }
  );
}

export function parsePaging(query: SearchParams): FhirPaging {
  const count = parseBoundedInt(query._count, 'count', 1, MAX_PAGE_SIZE, 25);
  const offset = parseBoundedInt(query._offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0);
  if (offset % count !== 0) {
    // FHIR paging is driven by the `next` link this server emits, and those are
    // always page-aligned. Serving a ragged offset would return a page that
    // silently starts somewhere other than where the client asked.
    throw ApiError.malformed('_offset must be a multiple of _count.', {
      issues: [{ path: '_offset', message: 'expected a page-aligned offset' }],
    });
  }
  return { count, offset };
}

/** Turns a page-aligned offset into the one-based page number repositories take. */
export function pageOf(paging: FhirPaging): { page: number; pageSize: number } {
  return { page: paging.offset / paging.count + 1, pageSize: paging.count };
}

function parseBoundedInt(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw ApiError.malformed(`_${name} must be an integer between ${min} and ${max}.`, {
      issues: [{ path: `_${name}`, message: `expected an integer in [${min}, ${max}]` }],
    });
  }
  return value;
}

/** Reads the value half of a `system|value` token, or the whole bare value. */
export function tokenValue(token: string): string {
  const separator = token.indexOf('|');
  return separator === -1 ? token : token.slice(separator + 1);
}

/**
 * Reads the id out of a reference parameter.
 *
 * `patient=Patient/123` and `patient=123` are both legal and mean the same
 * thing. A typed reference to a different resource type is a client error
 * rather than a miss, so it is refused: silently returning nothing would look
 * exactly like "this patient has no observations".
 */
export function referenceId(value: string, expectedType: string, param: string): string {
  const separator = value.indexOf('/');
  if (separator === -1) return value;
  const type = value.slice(0, separator);
  if (type !== expectedType) {
    throw ApiError.malformed(`${param} must reference a ${expectedType}.`, {
      issues: [{ path: param, message: `expected ${expectedType}/{id} or a bare id` }],
    });
  }
  return value.slice(separator + 1);
}

/** A half-open instant window, as a date search parameter expresses one. */
export interface DateWindow {
  from?: Date;
  to?: Date;
}

const PREFIXES = ['eq', 'ne', 'gt', 'lt', 'ge', 'le'] as const;

type DatePrefix = (typeof PREFIXES)[number];

function splitPrefix(value: string): { prefix: DatePrefix; rest: string } {
  const head = value.slice(0, 2);
  return PREFIXES.includes(head as DatePrefix)
    ? { prefix: head as DatePrefix, rest: value.slice(2) }
    : { prefix: 'eq', rest: value };
}

/**
 * Reads a date search parameter into a half-open window.
 *
 * `eq2026-08-14` is the whole of that day, not an instant, which is what makes
 * a day view expressible at all. `ne` is refused: it is the one prefix that
 * cannot be answered with a window, and answering it approximately would be
 * worse than answering it not at all.
 */
export function dateWindow(raw: string, param: string): DateWindow {
  const { prefix, rest } = splitPrefix(raw);
  if (prefix === 'ne') {
    throw ApiError.malformed(`${param} does not support the ne prefix.`, {
      fhirIssueCode: 'not-supported',
      issues: [{ path: param, message: 'use a range instead of a negation' }],
    });
  }

  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(rest);
  const start = new Date(dayOnly ? `${rest}T00:00:00.000Z` : rest);
  if (Number.isNaN(start.getTime())) {
    throw ApiError.malformed(`${param} must be an ISO 8601 date or instant.`, {
      issues: [{ path: param, message: 'expected YYYY-MM-DD or an ISO 8601 instant' }],
    });
  }
  const end = dayOnly ? new Date(start.getTime() + 86_400_000) : new Date(start.getTime() + 1);

  if (prefix === 'eq') return { from: start, to: end };
  if (prefix === 'ge') return { from: start };
  if (prefix === 'gt') return { from: end };
  if (prefix === 'le') return { to: end };
  return { to: start };
}

/** Reads a bare `YYYY-MM-DD` as UTC midnight, never as local midnight. */
export function parseDateOnly(value: string, param: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw ApiError.malformed(`${param} must be YYYY-MM-DD.`, {
      issues: [{ path: param, message: 'expected YYYY-MM-DD' }],
    });
  }
  return new Date(`${value}T00:00:00.000Z`);
}

/** Maps a token parameter onto a closed value set, refusing anything outside it. */
export function enumToken<T extends string>(raw: string, allowed: readonly T[], param: string): T {
  const value = tokenValue(raw);
  const match = allowed.find(
    (candidate) => candidate === value || candidate === value.toUpperCase()
  );
  if (match === undefined) {
    throw ApiError.malformed(`${param} must be one of ${allowed.join(', ')}.`, {
      issues: [{ path: param, message: `not a value ${param} accepts` }],
    });
  }
  return match;
}

/** Reads a `true`/`false` token parameter. */
export function booleanToken(raw: string, param: string): boolean {
  if (raw !== 'true' && raw !== 'false') {
    throw ApiError.malformed(`${param} must be true or false.`, {
      issues: [{ path: param, message: 'expected true or false' }],
    });
  }
  return raw === 'true';
}

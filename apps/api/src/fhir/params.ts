import { z } from 'zod';

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

/**
 * The same query string with its multiplicity intact, as `c.req.queries()`
 * gives it.
 *
 * `SearchParams` cannot express a repeated parameter: `c.req.query()` keeps the
 * first occurrence of each name and discards the rest. Every check below has to
 * run on this form instead, because a check that reads the flattened record
 * cannot see the occurrence it is meant to refuse.
 */
export type SearchOccurrences = Record<string, readonly string[]>;

/** No parameter may repeat unless a call site names one. */
const NONE_REPEATABLE: ReadonlySet<string> = new Set();

export function rejectUnsupportedParams(
  resourceType: string,
  query: SearchOccurrences,
  accepted: ReadonlySet<string>,
  repeatable: ReadonlySet<string> = NONE_REPEATABLE
): void {
  rejectUnknown(resourceType, query, accepted);
  rejectRepeated(resourceType, query, repeatable);
  rejectEmpty(resourceType, query);
}

/**
 * A parameter sent twice is refused, not answered with one of its values.
 *
 * FHIR reads `?code=A&code=B` as AND - resources carrying both - which for a
 * single-valued element is the empty set. This server applied the first value
 * and dropped the second, so the response was *wider* than the question, which
 * is the failure the header of this file exists to prevent. It was also
 * order-dependent: reversing the two changed the answer.
 *
 * The second value bypassed every guard as well as every filter. `?patient=
 * <uuid>&patient=nonsense` answered 200 while the reverse answered 400, so the
 * UUID check, the empty-value refusal and the value-set checks were reachable
 * only in the first position. Refusing here makes that unreachable rather than
 * merely unlikely - the guards below never see a second occurrence at all.
 *
 * Refusing rather than implementing AND, which is the other honest answer.
 * Every descriptor's query type takes a scalar where AND needs a set, so that
 * is a change to fifty-odd `toQuery` implementations and to both ports; and it
 * is the same change the comma form (`?code=A,B`, OR) would need, so the two
 * belong in one piece of work rather than half of one. Until then a refusal
 * costs the client one round trip and names the parameter, and a silent
 * widening costs somebody a privacy incident.
 *
 * `repeatable` is for the parameter that means a list on purpose. `$export`'s
 * `_type` is the only one: `?_type=Patient&_type=Encounter` is a legal way to
 * send a list and `parseTypeFilter` reads every occurrence.
 */
function rejectRepeated(
  resourceType: string,
  query: SearchOccurrences,
  repeatable: ReadonlySet<string>
): void {
  const repeated = Object.entries(query)
    .filter(([name, values]) => values.length > 1 && !repeatable.has(name))
    .map(([name]) => name);
  if (repeated.length === 0) return;

  throw ApiError.malformed(
    `Repeated search ${repeated.length === 1 ? 'parameter' : 'parameters'} for ${resourceType}: ${repeated.join(', ')}. Send each parameter once; this server does not combine two values for the same parameter.`,
    {
      fhirIssueCode: 'not-supported',
      issues: repeated.map((name) => ({
        path: name,
        message: 'sent more than once',
      })),
    }
  );
}

function rejectUnknown(
  resourceType: string,
  query: SearchOccurrences,
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

/**
 * A parameter that is present and empty is refused, not answered.
 *
 * A query string carries `?family=` as present-and-empty rather than as
 * absent, so every parameter on this boundary has a degenerate case. It is
 * refused in any position - `?_type=Patient&_type=` is refused too, on the one
 * parameter allowed to repeat, because a blank occurrence is a client sending
 * a blank field rather than asking for anything. Before this, they answered it
 * three different ways: thirteen date parameters and seven closed-value-set tokens
 * refused it, because an empty string is not a date and is not a member of a
 * value set; forty-one selected nothing, because an equality against an empty
 * string matches no row; and seven answered with EVERY row - `Patient?name=`,
 * `?family=`, `?given=`, `Practitioner?identifier=`, `Practitioner?name=`,
 * `Organization?name=` and `Location?name=`, because a contains-filter on an
 * empty needle is a tautology and a bare token with no value admits any.
 *
 * That last group is the reason this exists, and it is the failure the header
 * of this file describes: a client that filtered and received the whole
 * practice believes it received a slice.
 *
 * Refusing rather than selecting nothing, for three reasons.
 *
 * The forty-one decide nothing. They fall out of `{ mrn: '' }` matching no row,
 * not out of anybody choosing an answer, so "most of them already select
 * nothing" is a description of equality semantics rather than a precedent. The
 * twenty that refuse are the ones where a decision was actually taken.
 *
 * Selecting nothing is not expressible here for the string parameters without
 * changing `containsFold`, which is shared with the internal search where a
 * cleared search box sending an empty needle and getting everything back is
 * correct. One helper, two contracts; fixing FHIR there would break the other.
 *
 * And an empty bundle is itself a guess. `Patient?family=` answered with no
 * entries is indistinguishable from "no such patient", so a client sending a
 * blank form field is told nothing about the blank field. A refusal costs them
 * one round trip and names the parameter.
 *
 * `_count` and `_offset` need no exception: `Number('')` is 0, which is outside
 * both bounds, so they already refuse.
 */
function rejectEmpty(resourceType: string, query: SearchOccurrences): void {
  const empty = Object.entries(query)
    .filter(([, values]) => values.includes(''))
    .map(([name]) => name);
  if (empty.length === 0) return;

  throw ApiError.malformed(
    `Empty search ${empty.length === 1 ? 'parameter' : 'parameters'} for ${resourceType}: ${empty.join(', ')}. Omit a parameter rather than sending it with no value.`,
    {
      issues: empty.map((name) => ({ path: name, message: 'present but empty' })),
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

/** Reads the system half of a `system|value` token, or nothing for a bare one. */
export function tokenSystem(token: string): string | undefined {
  const separator = token.indexOf('|');
  return separator === -1 ? undefined : token.slice(0, separator);
}

/**
 * Whether a token matches a code in a known system.
 *
 * A bare token matches on the code alone, which is what FHIR says and what
 * every client that does not care about the vocabulary sends. A qualified token
 * has to agree about the system too: `urn:something-else|assess-plan` is a
 * different concept that happens to share a code, and answering it with this
 * server's concept is the same class of wrong answer as ignoring the parameter.
 *
 * An empty system, written `|code`, means "a code with no system at all". No
 * concept this server emits is systemless, so it matches nothing.
 */
export function tokenMatches(token: string, system: string, code: string): boolean {
  if (tokenValue(token) !== code) return false;
  const supplied = tokenSystem(token);
  return supplied === undefined || supplied === system;
}

/**
 * Reads the id out of a reference parameter.
 *
 * `patient=Patient/123` and `patient=123` are both legal and mean the same
 * thing. A typed reference to a different resource type is a client error
 * rather than a miss, so it is refused: silently returning nothing would look
 * exactly like "this patient has no observations".
 *
 * The id itself has to be a UUID, for the same reason and with the same
 * status. Every column these parameters land on is `@db.Uuid`; the one that is
 * not reads with `referenceText`.
 */
export function referenceId(value: string, expectedType: string, param: string): string {
  return uuidValue(referenceText(value, expectedType, param), param);
}

/**
 * The same reading, without requiring the id to be a UUID.
 *
 * Only for a parameter whose column is text rather than `@db.Uuid`. The audit
 * log's `actorId` is the case: it stores an OIDC `sub`, which is whatever the
 * issuer mints and is not a UUID on a real deployment. Requiring one here would
 * refuse the ordinary caller rather than the malformed one.
 *
 * Prefer `referenceId`. A parameter that lands on a UUID column and is read
 * with this instead reaches the driver unvalidated, which is a 500 and not a
 * 400 - see the note on `uuidValue`.
 */
export function referenceText(value: string, expectedType: string, param: string): string {
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

const uuidSchema = z.uuid();

/**
 * Refuses a search parameter that cannot be an id on a UUID column.
 *
 * Every `@db.Uuid` column in the schema is reached from this surface by a
 * parameter the caller supplies. Postgres refuses the cast, so a value that
 * gets this far surfaces as a 500 with an opaque body - the caller is told the
 * server failed when what happened is that they sent a bad id, and the same
 * value on the internal routes is already a 400 because those parse it with
 * `z.uuid()`. Two doors onto the same data should not disagree about the same
 * input.
 *
 * A well-formed id that matches nothing is not this: it stays a 200 and an
 * empty bundle, which is the honest answer to a search for something absent.
 */
export function uuidValue(value: string, param: string): string {
  if (!uuidSchema.safeParse(value).success) {
    throw ApiError.malformed(`${param} must be a UUID.`, {
      issues: [{ path: param, message: 'expected a UUID' }],
    });
  }
  return value;
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

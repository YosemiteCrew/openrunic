import { ApiError } from '../errors.js';
import type { PatientListQuery } from '../repositories/types.js';
import { MAX_PAGE_SIZE } from '../schemas/pagination.js';
import { parseLocalDate } from '../schemas/patients.js';

import { acceptedSearchParams } from './registry.js';
import { fromFhirGender } from './patient.js';

/**
 * FHIR search parameter handling.
 *
 * Unsupported parameters are rejected, not ignored. FHIR permits a server to
 * ignore what it does not understand, and that permission is a trap for a
 * clinical system: a client searching `?birthdate=1994-03-02&_has:Condition...`
 * would silently receive every patient in the practice, and believe it had
 * received the filtered set. The refusal is `not-supported`, which is exactly
 * what it is, and the CapabilityStatement lists what would have worked.
 *
 * `_include`, `_revinclude` and chained parameters are out of scope at v1
 * (scope section 5.2) and are refused by the same rule, since none of them
 * appear in the registry.
 */

export interface FhirPaging {
  count: number;
  offset: number;
}

export function rejectUnsupportedParams(resourceType: string, query: Record<string, string>): void {
  const accepted = acceptedSearchParams(resourceType);
  const unsupported = Object.keys(query).filter((name) => !accepted.has(name));
  if (unsupported.length > 0) {
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
}

export function parsePaging(query: Record<string, string>): FhirPaging {
  return {
    count: parseBoundedInt(query._count, 'count', 1, MAX_PAGE_SIZE, 25),
    offset: parseBoundedInt(query._offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0),
  };
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

/**
 * Translates a FHIR Patient search into the repository query.
 *
 * The offset is converted into a page number, which requires the offset to sit
 * on a page boundary. Refusing a ragged offset is better than serving a page
 * that silently starts somewhere else: FHIR paging is driven by the `next`
 * link this server emits, and those links are always page-aligned.
 */
export function toPatientSearchQuery(
  query: Record<string, string>,
  paging: FhirPaging
): PatientListQuery {
  if (paging.offset % paging.count !== 0) {
    throw ApiError.malformed('_offset must be a multiple of _count.', {
      issues: [{ path: '_offset', message: 'expected a page-aligned offset' }],
    });
  }

  const gender = query.gender === undefined ? undefined : fromFhirGender(query.gender);
  if (query.gender !== undefined && gender === undefined) {
    throw ApiError.malformed('gender must be one of male, female, other, unknown.', {
      issues: [{ path: 'gender', message: 'not an administrative gender' }],
    });
  }

  if (query.birthdate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(query.birthdate)) {
    throw ApiError.malformed('birthdate must be YYYY-MM-DD.', {
      issues: [{ path: 'birthdate', message: 'expected YYYY-MM-DD' }],
    });
  }

  if (query.active !== undefined && query.active !== 'true' && query.active !== 'false') {
    throw ApiError.malformed('active must be true or false.', {
      issues: [{ path: 'active', message: 'expected true or false' }],
    });
  }

  return {
    page: paging.offset / paging.count + 1,
    pageSize: paging.count,
    ...(query._id === undefined ? {} : { id: query._id }),
    // `identifier` is a token: `system|value` or a bare value. The value half is
    // the MRN, the only identifier this search is implemented against.
    ...(query.identifier === undefined ? {} : { mrn: tokenValue(query.identifier) }),
    ...(gender === undefined ? {} : { sexAtBirth: gender }),
    ...(query.family === undefined ? {} : { family: query.family }),
    ...(query.given === undefined ? {} : { given: query.given }),
    ...(query.name === undefined ? {} : { q: query.name }),
    ...(query.birthdate === undefined ? {} : { birthDate: parseLocalDate(query.birthdate) }),
    ...(query.active === undefined ? {} : { active: query.active === 'true' }),
    sort: 'familyName',
    order: 'asc',
  };
}

/** Reads the value half of a `system|value` token, or the whole bare value. */
export function tokenValue(token: string): string {
  const separator = token.indexOf('|');
  return separator === -1 ? token : token.slice(separator + 1);
}

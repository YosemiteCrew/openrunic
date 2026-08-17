import {
  FORM_BINDINGS,
  FORM_COMPLETED_BY_TYPES,
  FORM_STATUSES,
  FORM_SUBMISSION_STATUSES,
  USER_STATUSES,
  timestamp,
  type AuditChainVerification,
} from '@openrunic/database';
import { z } from 'zod';

import { readJsonObject } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import type {
  FacilityListQuery,
  FormDefinitionListQuery,
  FormSubmissionListQuery,
  RoleAssignmentListQuery,
  RoleListQuery,
  TerminologyListQuery,
  UserListQuery,
} from '../repositories/specs/platform.js';
import type { AuditEventRow, AuditQuery } from '../repositories/types.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';

/**
 * The wire contract for the platform aggregates.
 *
 * Same two rules as the patient contract next door. Every list query is a
 * `strictObject`, so `?stauts=DRAFT` is a 400 rather than an unfiltered search
 * of the whole table. Every DTO is a zod schema with its TypeScript type
 * inferred from it, so the published OpenAPI document and the handler's return
 * type cannot describe different objects.
 *
 * Write contracts that already exist in `@openrunic/database` are imported by
 * the router rather than restated here. The four aggregates that have none -
 * users, roles, role assignments and facilities - get theirs below, following
 * the same conventions: `strictObject`, never accepting `id`, `tenantId`,
 * `createdAt` or `updatedAt`, and closed value sets taken from that package's
 * exported tuples.
 */

/** A JSON column as the wire carries it. */
const jsonObjectField = z.record(z.string(), z.unknown());

/** The same, for a column that may hold nothing at all. */
const nullableJsonField = jsonObjectField.nullable();

function toJsonObject(value: unknown): Record<string, unknown> {
  return readJsonObject(value) ?? {};
}

function toNullableJsonObject(value: unknown): Record<string, unknown> | null {
  return readJsonObject(value) ?? null;
}

/* -------------------------------------------------------- form definitions */

export const formDefinitionListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  key: z.string().min(1).max(64).optional(),
  status: z.enum(FORM_STATUSES).optional(),
  bindTo: z.enum(FORM_BINDINGS).optional(),
  sort: z.enum(['key', 'version', 'createdAt']).default('key'),
  order: sortOrderField,
});

export type FormDefinitionListQueryInput = z.infer<typeof formDefinitionListQuerySchema>;

export function toFormDefinitionListQuery(
  input: FormDefinitionListQueryInput
): FormDefinitionListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.bindTo === undefined ? {} : { bindTo: input.bindTo }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The definition patch contract.
 *
 * `status`, `publishedAt` and `retiredAt` are absent because publishing and
 * retiring are transitions with their own endpoints, and a status a client
 * could set through a patch would be a status set without its stamps.
 */
export const formDefinitionPatchSchema = z
  .strictObject({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, 'key must be lowercase kebab-case')
      .optional(),
    title: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(256).optional(),
    bindTo: z.enum(FORM_BINDINGS).optional(),
    definition: jsonObjectField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type FormDefinitionPatchBody = z.infer<typeof formDefinitionPatchSchema>;

export const formDefinitionRetireSchema = z.strictObject({
  retiredAt: timestamp.optional(),
});

export type FormDefinitionRetireBody = z.infer<typeof formDefinitionRetireSchema>;

export const formDefinitionDtoSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  version: z.int(),
  status: z.enum(FORM_STATUSES),
  title: z.string(),
  description: z.string().nullable(),
  bindTo: z.enum(FORM_BINDINGS),
  definition: jsonObjectField,
  /** Publish-time artefacts: validator, render tree, print layout, mapping. */
  compiled: nullableJsonField,
  promotionManifest: nullableJsonField,
  publishedAt: z.string().nullable(),
  publishedById: z.uuid().nullable(),
  retiredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FormDefinitionDto = z.infer<typeof formDefinitionDtoSchema>;

export function toFormDefinitionDto(row: ScopedRow<'FormDefinition'>): FormDefinitionDto {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    status: row.status,
    title: row.title,
    description: row.description,
    bindTo: row.bindTo,
    definition: toJsonObject(row.definition),
    compiled: toNullableJsonObject(row.compiled),
    promotionManifest: toNullableJsonObject(row.promotionManifest),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedById: row.publishedById,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------- form submissions */

export const formSubmissionListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  formDefinitionId: z.uuid().optional(),
  status: z.enum(FORM_SUBMISSION_STATUSES).optional(),
  /** Inclusive lower bound on `effectiveAt`. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Exclusive upper bound on `effectiveAt`. */
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.enum(['effectiveAt', 'createdAt']).default('effectiveAt'),
  order: sortOrderField,
});

export type FormSubmissionListQueryInput = z.infer<typeof formSubmissionListQuerySchema>;

export function toFormSubmissionListQuery(
  input: FormSubmissionListQueryInput
): FormSubmissionListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.formDefinitionId === undefined ? {} : { formDefinitionId: input.formDefinitionId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The submission patch contract.
 *
 * The only status a patch may set is `ENTERED_IN_ERROR`, because a correction
 * is a status transition and never a delete; every other move has its own
 * endpoint so that the instant it happened is stamped in the same write.
 */
export const formSubmissionPatchSchema = z
  .strictObject({
    status: z.literal('ENTERED_IN_ERROR').optional(),
    values: jsonObjectField.optional(),
    encounterId: z.uuid().optional(),
    completedByType: z.enum(FORM_COMPLETED_BY_TYPES).optional(),
    completedByUserId: z.uuid().optional(),
    effectiveAt: timestamp.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  })
  .refine((value) => value.completedByType !== 'USER' || value.completedByUserId !== undefined, {
    message: 'a staff-completed submission must name the user',
    path: ['completedByUserId'],
  });

export type FormSubmissionPatchBody = z.infer<typeof formSubmissionPatchSchema>;

/** The replacement answer set an amendment carries. */
export const formSubmissionAmendSchema = z.strictObject({
  values: jsonObjectField,
  effectiveAt: timestamp.optional(),
});

export type FormSubmissionAmendBody = z.infer<typeof formSubmissionAmendSchema>;

/**
 * Completion carries the same refinement as the write contract: a submission
 * completed by staff has to name which member of staff, because "a clinician
 * filled this in" is not an answer anyone can follow up on.
 */
export const formSubmissionCompleteSchema = z
  .strictObject({
    completedAt: timestamp.optional(),
    completedByType: z.enum(FORM_COMPLETED_BY_TYPES).optional(),
    completedByUserId: z.uuid().optional(),
  })
  .refine((value) => value.completedByType !== 'USER' || value.completedByUserId !== undefined, {
    message: 'a staff-completed submission must name the user',
    path: ['completedByUserId'],
  });

export type FormSubmissionCompleteBody = z.infer<typeof formSubmissionCompleteSchema>;

export const formSubmissionSignSchema = z.strictObject({
  signedAt: timestamp.optional(),
});

export type FormSubmissionSignBody = z.infer<typeof formSubmissionSignSchema>;

export const formSubmissionDtoSchema = z.strictObject({
  id: z.uuid(),
  formDefinitionId: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().nullable(),
  status: z.enum(FORM_SUBMISSION_STATUSES),
  values: jsonObjectField,
  completedByType: z.enum(FORM_COMPLETED_BY_TYPES),
  completedByUserId: z.uuid().nullable(),
  completedAt: z.string().nullable(),
  signedAt: z.string().nullable(),
  signedById: z.uuid().nullable(),
  effectiveAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FormSubmissionDto = z.infer<typeof formSubmissionDtoSchema>;

export function toFormSubmissionDto(row: ScopedRow<'FormSubmission'>): FormSubmissionDto {
  return {
    id: row.id,
    formDefinitionId: row.formDefinitionId,
    patientId: row.patientId,
    encounterId: row.encounterId,
    status: row.status,
    values: toJsonObject(row.values),
    completedByType: row.completedByType,
    completedByUserId: row.completedByUserId,
    completedAt: row.completedAt?.toISOString() ?? null,
    signedAt: row.signedAt?.toISOString() ?? null,
    signedById: row.signedById,
    effectiveAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------- users */

export const userListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  status: z.enum(USER_STATUSES).optional(),
  isProvider: z.enum(['true', 'false']).optional(),
  /** Free text over given name, family name and email. */
  q: z.string().min(1).max(128).optional(),
  sort: z.enum(['familyName', 'email', 'createdAt']).default('familyName'),
  order: sortOrderField,
});

export type UserListQueryInput = z.infer<typeof userListQuerySchema>;

export function toUserListQuery(input: UserListQueryInput): UserListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.isProvider === undefined ? {} : { isProvider: input.isProvider === 'true' }),
    ...(input.q === undefined ? {} : { q: input.q }),
    sort: input.sort,
    order: input.order,
  };
}

export const userCreateSchema = z.strictObject({
  email: z.email().max(320),
  givenName: z.string().min(1).max(128),
  familyName: z.string().min(1).max(128),
  /** Display credential suffix, e.g. "MD". Free text by design. */
  credential: z.string().min(1).max(32).optional(),
  npi: z.string().min(1).max(32).optional(),
  /** Registration number for controlled substances. Written, never published. */
  dea: z.string().min(1).max(32).optional(),
  taxonomyCode: z.string().min(1).max(64).optional(),
  isProvider: z.boolean().optional(),
  locale: z.string().min(2).max(16).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export type UserCreateBody = z.infer<typeof userCreateSchema>;

/**
 * The user patch contract. `email` is absent: it is the natural key, and
 * reassigning it would move every audit event that named the old address.
 */
export const userPatchSchema = z
  .strictObject({
    givenName: z.string().min(1).max(128).optional(),
    familyName: z.string().min(1).max(128).optional(),
    credential: z.string().min(1).max(32).optional(),
    npi: z.string().min(1).max(32).optional(),
    dea: z.string().min(1).max(32).optional(),
    taxonomyCode: z.string().min(1).max(64).optional(),
    isProvider: z.boolean().optional(),
    locale: z.string().min(2).max(16).optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type UserPatchBody = z.infer<typeof userPatchSchema>;

/**
 * The directory entry, as everyone inside the practice may see it.
 *
 * `dea` is deliberately absent. A DEA registration number is a prescribing
 * credential rather than a contact detail, no directory screen needs it, and a
 * field that is never published cannot be leaked by a screen that forgot to
 * hide it. `lastLoginAt` is here because "is this account in use" is exactly
 * the question an administrator deactivating a leaver has to answer.
 */
export const userDtoSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  credential: z.string().nullable(),
  npi: z.string().nullable(),
  taxonomyCode: z.string().nullable(),
  isProvider: z.boolean(),
  locale: z.string(),
  status: z.enum(USER_STATUSES),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type UserDto = z.infer<typeof userDtoSchema>;

export function toUserDto(row: ScopedRow<'User'>): UserDto {
  return {
    id: row.id,
    email: row.email,
    givenName: row.givenName,
    familyName: row.familyName,
    credential: row.credential,
    npi: row.npi,
    taxonomyCode: row.taxonomyCode,
    isProvider: row.isProvider,
    locale: row.locale,
    status: row.status,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------- roles */

export const roleListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  isSystem: z.enum(['true', 'false']).optional(),
  sort: z.enum(['key', 'name', 'createdAt']).default('key'),
  order: sortOrderField,
});

export type RoleListQueryInput = z.infer<typeof roleListQuerySchema>;

export function toRoleListQuery(input: RoleListQueryInput): RoleListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.isSystem === undefined ? {} : { isSystem: input.isSystem === 'true' }),
    sort: input.sort,
    order: input.order,
  };
}

export const roleCreateSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, 'key must be lowercase kebab-case'),
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(256).optional(),
  isSystem: z.boolean().optional(),
});

export type RoleCreateBody = z.infer<typeof roleCreateSchema>;

/** The key is what permissions are granted against, so it is not reassignable. */
export const rolePatchSchema = z
  .strictObject({
    name: z.string().min(1).max(128).optional(),
    description: z.string().min(1).max(256).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type RolePatchBody = z.infer<typeof rolePatchSchema>;

export const roleDtoSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoleDto = z.infer<typeof roleDtoSchema>;

export function toRoleDto(row: ScopedRow<'Role'>): RoleDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------- role assignments */

/**
 * The nested list contract. `userId` is absent because it comes from the path:
 * a query parameter that could name a different user than the URL did would be
 * two answers to one question.
 */
export const userRoleListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  roleId: z.uuid().optional(),
  facilityId: z.uuid().optional(),
  sort: z.enum(['createdAt']).default('createdAt'),
  order: sortOrderField,
});

export type UserRoleListQueryInput = z.infer<typeof userRoleListQuerySchema>;

export function toRoleAssignmentListQuery(
  input: UserRoleListQueryInput,
  userId: string
): RoleAssignmentListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    userId,
    ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
    ...(input.facilityId === undefined ? {} : { facilityId: input.facilityId }),
    sort: input.sort,
    order: input.order,
  };
}

export const roleAssignmentCreateSchema = z.strictObject({
  roleId: z.uuid(),
  /** Absent means the grant is organisation-wide. */
  facilityId: z.uuid().optional(),
});

export type RoleAssignmentCreateBody = z.infer<typeof roleAssignmentCreateSchema>;

export const roleAssignmentDtoSchema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  roleId: z.uuid(),
  facilityId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoleAssignmentDto = z.infer<typeof roleAssignmentDtoSchema>;

export function toRoleAssignmentDto(row: ScopedRow<'RoleAssignment'>): RoleAssignmentDto {
  return {
    id: row.id,
    userId: row.userId,
    roleId: row.roleId,
    facilityId: row.facilityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------- facilities */

export const facilityListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  active: z.enum(['true', 'false']).optional(),
  /** Free text over the name and the short code. */
  q: z.string().min(1).max(128).optional(),
  sort: z.enum(['name', 'code', 'createdAt']).default('name'),
  order: sortOrderField,
});

export type FacilityListQueryInput = z.infer<typeof facilityListQuerySchema>;

export function toFacilityListQuery(input: FacilityListQueryInput): FacilityListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.active === undefined ? {} : { active: input.active === 'true' }),
    ...(input.q === undefined ? {} : { q: input.q }),
    sort: input.sort,
    order: input.order,
  };
}

const facilityAddressFields = {
  addressLine1: z.string().min(1).max(256).optional(),
  addressLine2: z.string().min(1).max(256).optional(),
  city: z.string().min(1).max(128).optional(),
  state: z.string().min(1).max(64).optional(),
  postalCode: z.string().min(1).max(16).optional(),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2).optional(),
};

/**
 * An IANA zone name the platform can actually resolve.
 *
 * Checked by asking `Intl` rather than by matching a shape, because the value
 * is only ever used by handing it to `Intl` - a name that looks right and that
 * this runtime does not know is the same failure as a typo.
 *
 * It was a free string, described in a comment as an IANA zone name and checked
 * as nothing. The inventory reads derive today from it, so `PST` or a
 * misspelling turned three endpoints into bare 500s for that site, with nothing
 * in the error pointing at the facility record that caused it.
 */
const ianaZone = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be an IANA time zone name, such as America/New_York' }
  );

export const facilityCreateSchema = z.strictObject({
  name: z.string().min(1).max(256),
  /** Short code shown in the UI and printed on documents. */
  code: z.string().min(1).max(32),
  npi: z.string().min(1).max(32).optional(),
  /** CMS place-of-service code, e.g. "11" for office. Coded, so a string. */
  posCode: z.string().min(1).max(8).optional(),
  /** IANA zone name; the schedule renders every instant through it. */
  timezone: ianaZone.optional(),
  ...facilityAddressFields,
  phone: z.string().min(3).max(32).optional(),
  active: z.boolean().optional(),
});

export type FacilityCreateBody = z.infer<typeof facilityCreateSchema>;

/** `code` is absent: it is the natural key and it is printed on past documents. */
export const facilityPatchSchema = z
  .strictObject({
    name: z.string().min(1).max(256).optional(),
    npi: z.string().min(1).max(32).optional(),
    posCode: z.string().min(1).max(8).optional(),
    timezone: ianaZone.optional(),
    ...facilityAddressFields,
    phone: z.string().min(3).max(32).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type FacilityPatchBody = z.infer<typeof facilityPatchSchema>;

export const facilityDtoSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  npi: z.string().nullable(),
  posCode: z.string().nullable(),
  timezone: z.string(),
  address: z.strictObject({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string(),
  }),
  phone: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FacilityDto = z.infer<typeof facilityDtoSchema>;

export function toFacilityDto(row: ScopedRow<'Facility'>): FacilityDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    npi: row.npi,
    posCode: row.posCode,
    timezone: row.timezone,
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
    },
    phone: row.phone,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------- terminology */

export const terminologyListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  /** Canonical system URI, e.g. `http://loinc.org`. */
  system: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(64).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  /** Free text over the cached display. */
  q: z.string().min(1).max(128).optional(),
  sort: z.enum(['display', 'code', 'createdAt']).default('display'),
  order: sortOrderField,
});

export type TerminologyListQueryInput = z.infer<typeof terminologyListQuerySchema>;

export function toTerminologyListQuery(input: TerminologyListQueryInput): TerminologyListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.system === undefined ? {} : { system: input.system }),
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive === 'true' }),
    ...(input.q === undefined ? {} : { q: input.q }),
    sort: input.sort,
    order: input.order,
  };
}

export const terminologyLookupQuerySchema = z.strictObject({
  system: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
});

export type TerminologyLookupQueryInput = z.infer<typeof terminologyLookupQuerySchema>;

export function toTerminologyLookupQuery(input: TerminologyLookupQueryInput): TerminologyListQuery {
  return {
    page: 1,
    // One row is the whole answer: the natural key admits several versions of
    // the same code, and a lookup wants the one the deployment loaded first
    // rather than a page of near-identical displays.
    pageSize: 1,
    system: input.system,
    code: input.code,
    sort: 'code',
    order: 'asc',
  };
}

/** Everything a code is loaded to answer: what it is called, and whether it still applies. */
export const terminologyLookupDtoSchema = z.strictObject({
  system: z.string(),
  code: z.string(),
  display: z.string(),
  version: z.string(),
  isActive: z.boolean(),
});

export type TerminologyLookupDto = z.infer<typeof terminologyLookupDtoSchema>;

export const terminologyCodeDtoSchema = z.strictObject({
  id: z.uuid(),
  system: z.string(),
  code: z.string(),
  display: z.string(),
  version: z.string(),
  parentCode: z.string().nullable(),
  isActive: z.boolean(),
  properties: nullableJsonField,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TerminologyCodeDto = z.infer<typeof terminologyCodeDtoSchema>;

export function toTerminologyCodeDto(row: ScopedRow<'TerminologyCode'>): TerminologyCodeDto {
  return {
    id: row.id,
    system: row.system,
    code: row.code,
    display: row.display,
    version: row.version,
    parentCode: row.parentCode,
    isActive: row.isActive,
    properties: toNullableJsonObject(row.properties),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTerminologyLookupDto(row: ScopedRow<'TerminologyCode'>): TerminologyLookupDto {
  return {
    system: row.system,
    code: row.code,
    display: row.display,
    version: row.version,
    isActive: row.isActive,
  };
}

/**
 * The terminology patch contract. `system` and `code` are absent: together they
 * are what every clinical row stored, and repointing them would rewrite the
 * meaning of records nobody touched.
 */
export const terminologyPatchSchema = z
  .strictObject({
    display: z.string().min(1).max(256).optional(),
    parentCode: z.string().min(1).max(64).optional(),
    isActive: z.boolean().optional(),
    properties: jsonObjectField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type TerminologyPatchBody = z.infer<typeof terminologyPatchSchema>;

/* ------------------------------------------------------------------- audit */

export const auditQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  actorId: z.string().min(1).max(128).optional(),
  action: z.string().min(1).max(128).optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(128).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  breakglass: z.enum(['true', 'false']).optional(),
  /** Inclusive lower bound on `occurredAt`. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Exclusive upper bound on `occurredAt`. */
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.enum(['occurredAt', 'seq']).default('occurredAt'),
  // The one list on this surface whose default order is descending. An
  // investigation starts at what just happened and reads backwards, and a
  // default of `asc` would open every audit screen on the oldest event the
  // organisation ever recorded.
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

export function toAuditQuery(input: AuditQueryInput): AuditQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.action === undefined ? {} : { action: input.action }),
    ...(input.targetType === undefined ? {} : { targetType: input.targetType }),
    ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.breakglass === undefined ? {} : { breakglass: input.breakglass === 'true' }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

export const auditEventDtoSchema = z.strictObject({
  id: z.uuid(),
  /**
   * The chain position, as a decimal string. It is a `BigInt` column:
   * `JSON.stringify` refuses one outright, and narrowing it to a number would
   * start losing precision past 2^53 - which is to say, it would silently break
   * the chain rather than loudly refuse to serialize it.
   */
  seq: z.string(),
  occurredAt: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  actorDisplay: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  patientId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
  facilityId: z.uuid().nullable(),
  purposeOfUse: z.string().nullable(),
  breakglass: z.boolean(),
  outcome: z.string(),
  sourceIp: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: nullableJsonField,
  prevHash: z.string(),
  hash: z.string(),
});

export type AuditEventDto = z.infer<typeof auditEventDtoSchema>;

export function toAuditEventDto(row: AuditEventRow): AuditEventDto {
  return {
    id: row.id,
    seq: row.seq.toString(),
    occurredAt: row.occurredAt.toISOString(),
    actorType: row.actorType,
    actorId: row.actorId,
    actorDisplay: row.actorDisplay,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    patientId: row.patientId,
    encounterId: row.encounterId,
    facilityId: row.facilityId,
    purposeOfUse: row.purposeOfUse,
    breakglass: row.breakglass,
    outcome: row.outcome,
    sourceIp: row.sourceIp,
    userAgent: row.userAgent,
    metadata: toNullableJsonObject(row.metadata),
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

/**
 * The verification report, flattened.
 *
 * The domain result is a discriminated union, and a union would publish as a
 * `oneOf` that every generated client would have to narrow before it could
 * render "intact" or "broken at 41". Four nullable fields say the same thing
 * and read the same in every language.
 */
export const auditVerificationDtoSchema = z.strictObject({
  valid: z.boolean(),
  /** How many events this pass covered. */
  checked: z.int().min(0),
  /** Sequence number of the last verified event, as a decimal string. */
  tailSeq: z.string().nullable(),
  /** Where tampering began, not merely where it was noticed. */
  brokenAtSeq: z.string().nullable(),
  reason: z.string().nullable(),
});

export type AuditVerificationDto = z.infer<typeof auditVerificationDtoSchema>;

export function toAuditVerificationDto(result: AuditChainVerification): AuditVerificationDto {
  if (!result.valid) {
    return {
      valid: false,
      checked: result.checked,
      tailSeq: null,
      brokenAtSeq: result.brokenAtSeq.toString(),
      reason: result.reason,
    };
  }
  return {
    valid: true,
    checked: result.checked,
    tailSeq: result.tail === null ? null : result.tail.seq.toString(),
    brokenAtSeq: null,
    reason: null,
  };
}

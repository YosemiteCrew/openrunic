import type {
  FormDefinitionCreateInput,
  FormSubmissionInput,
  TerminologyCodeInput,
} from '@openrunic/database';

import {
  containsFold,
  inWindow,
  jsonColumn,
  windowFilter,
  type BaseQuery,
  type CollectionSpec,
  type RowContext,
  type Writable,
} from '../collection.js';
import type { Row, ScopedRow } from '../rows.js';

/**
 * The platform aggregates: the form engine, the staff directory, the places of
 * service and the terminology cache.
 *
 * They share nothing clinically and one property structurally, which is why
 * they are one file: none of them is a chart. That makes the compartment
 * decision the interesting part of every spec below, and it is spelled out at
 * each one rather than inherited, because "what may a patient-scoped token see
 * of the provider directory" has a different answer from "what may it see of
 * the facility list" and both answers have to be deliberate.
 */

export type FormStatus = Row<'FormDefinition'>['status'];
export type FormBinding = Row<'FormDefinition'>['bindTo'];
export type FormSubmissionStatus = Row<'FormSubmission'>['status'];
export type FormCompletedByType = Row<'FormSubmission'>['completedByType'];
export type UserStatus = Row<'User'>['status'];

/**
 * Column defaults, mirrored by hand from `schema.prisma`, exactly as
 * `repositories/defaults.ts` mirrors the registration ones.
 *
 * Postgres applies these at runtime and the in-memory store has no Postgres, so
 * one hand-kept copy is what stops the suite from passing against defaults the
 * database does not actually have. A `@default(...)` changed in the schema and
 * not changed here is a divergence, not a nuance.
 */
const FORM_DEFINITION_DEFAULTS: { status: FormStatus; bindTo: FormBinding } = {
  status: 'DRAFT',
  bindTo: 'ENCOUNTER',
};

const FORM_SUBMISSION_DEFAULTS: {
  status: FormSubmissionStatus;
  completedByType: FormCompletedByType;
} = {
  status: 'IN_PROGRESS',
  completedByType: 'USER',
};

const USER_DEFAULTS: { isProvider: boolean; locale: string; status: UserStatus } = {
  isProvider: false,
  locale: 'en-US',
  status: 'INVITED',
};

const ROLE_DEFAULTS: { isSystem: boolean } = { isSystem: false };

const FACILITY_DEFAULTS: { timezone: string; country: string; active: boolean } = {
  timezone: 'UTC',
  country: 'US',
  active: true,
};

/**
 * `version` defaults to the empty string rather than to NULL so that it takes
 * part in the natural key: Postgres treats NULLs as distinct, so a nullable
 * version column would let the same code be loaded twice.
 */
const TERMINOLOGY_DEFAULTS: { version: string; isActive: boolean } = {
  version: '',
  isActive: true,
};

/* -------------------------------------------------------- form definitions */

export interface FormDefinitionListQuery extends BaseQuery {
  key?: string;
  status?: FormStatus;
  bindTo?: FormBinding;
  sort: 'key' | 'version' | 'createdAt';
}

/**
 * What a definition write may change.
 *
 * It is wider than the PATCH body on purpose: publishing and retiring are the
 * only writers of `status`, `publishedAt`, `publishedById` and `retiredAt`, and
 * they reach the repository through the same patch as an ordinary edit rather
 * than through a second write path that could forget the audit event.
 */
export interface FormDefinitionUpdateInput {
  key?: string;
  title?: string;
  description?: string;
  bindTo?: FormBinding;
  definition?: Record<string, unknown>;
  status?: FormStatus;
  compiled?: Record<string, unknown>;
  promotionManifest?: Record<string, unknown>;
  publishedAt?: Date;
  publishedById?: string;
  retiredAt?: Date;
}

export const formDefinitionSpec: CollectionSpec<
  'FormDefinition',
  FormDefinitionCreateInput,
  FormDefinitionUpdateInput,
  FormDefinitionListQuery
> = {
  model: 'FormDefinition',
  targetType: 'FormDefinition',
  action: 'form.definition',
  // A definition is a blank template. It carries no chart, and a portal user
  // filling in an intake form has to be able to read the definition they are
  // filling in, so this is open by decision rather than by omission.
  compartment: 'open',

  newRow(input: FormDefinitionCreateInput): Writable<'FormDefinition'> {
    return {
      key: input.key,
      version: input.version,
      status: input.status ?? FORM_DEFINITION_DEFAULTS.status,
      title: input.title,
      description: input.description ?? null,
      bindTo: input.bindTo,
      definition: jsonColumn(input.definition),
      compiled: jsonColumn(input.compiled),
      promotionManifest: jsonColumn(input.promotionManifest),
      publishedAt: null,
      publishedById: null,
      retiredAt: null,
    };
  },

  patchData(
    patch: FormDefinitionUpdateInput,
    before: ScopedRow<'FormDefinition'>,
    context: RowContext
  ): Partial<Writable<'FormDefinition'>> {
    const data: Partial<Writable<'FormDefinition'>> = {
      ...(patch.key === undefined ? {} : { key: patch.key }),
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.bindTo === undefined ? {} : { bindTo: patch.bindTo }),
      ...(patch.definition === undefined ? {} : { definition: jsonColumn(patch.definition) }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.compiled === undefined ? {} : { compiled: jsonColumn(patch.compiled) }),
      ...(patch.promotionManifest === undefined
        ? {}
        : { promotionManifest: jsonColumn(patch.promotionManifest) }),
      ...(patch.publishedAt === undefined ? {} : { publishedAt: patch.publishedAt }),
      ...(patch.publishedById === undefined ? {} : { publishedById: patch.publishedById }),
      ...(patch.retiredAt === undefined ? {} : { retiredAt: patch.retiredAt }),
    };
    // Publishing and retiring stamp their instant here rather than in the
    // handler, so a version's `publishedAt` is the same instant as the
    // `updatedAt` of the write that set it and not a second reading of the wall
    // clock. A caller who names the instant keeps it: a form published in a
    // release is dated by the release, not by the request that recorded it.
    if (patch.status === 'PUBLISHED' && patch.publishedAt === undefined) {
      data.publishedAt = context.now;
    }
    if (patch.status === 'RETIRED' && patch.retiredAt === undefined) {
      data.retiredAt = context.now;
    }
    return data;
  },

  matches(row: ScopedRow<'FormDefinition'>, query: FormDefinitionListQuery): boolean {
    if (query.key !== undefined && row.key !== query.key) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    return query.bindTo === undefined || row.bindTo === query.bindTo;
  },

  where(query: FormDefinitionListQuery) {
    return {
      ...(query.key === undefined ? {} : { key: query.key }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.bindTo === undefined ? {} : { bindTo: query.bindTo }),
    };
  },

  sortValue(
    row: ScopedRow<'FormDefinition'>,
    sort: FormDefinitionListQuery['sort']
  ): number | string {
    if (sort === 'version') return row.version;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.key;
  },

  orderBy(query: FormDefinitionListQuery) {
    const { order } = query;
    if (query.sort === 'version') return [{ version: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    // A key without its version is half an answer: the list screen groups the
    // versions of one form together and shows them in order.
    return [{ key: order }, { version: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'FormDefinition'>,
    before: ScopedRow<'FormDefinition'> | null
  ): Record<string, unknown> {
    if (before === null) return { key: row.key, version: row.version, status: row.status };
    return before.status === row.status ? {} : { statusFrom: before.status, statusTo: row.status };
  },

  uniqueBy: {
    where: (input: FormDefinitionCreateInput) => ({ key: input.key, version: input.version }),
    matches: (row: ScopedRow<'FormDefinition'>, input: FormDefinitionCreateInput) =>
      row.key === input.key && row.version === input.version,
    message: (input: FormDefinitionCreateInput) =>
      `Version ${input.version} of the form ${input.key} already exists.`,
  },
};

/* -------------------------------------------------------- form submissions */

export interface FormSubmissionListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  formDefinitionId?: string;
  status?: FormSubmissionStatus;
  /** Inclusive lower bound on `effectiveAt`. */
  from?: Date;
  /** Exclusive upper bound on `effectiveAt`. */
  to?: Date;
  sort: 'effectiveAt' | 'createdAt';
}

/**
 * What a submission write may change.
 *
 * A signed submission is never edited in place, so `values` reaches this type
 * only through the amend transition, which moves the status in the same write.
 */
export interface FormSubmissionUpdateInput {
  status?: FormSubmissionStatus;
  values?: Record<string, unknown>;
  encounterId?: string;
  completedByType?: FormCompletedByType;
  completedByUserId?: string;
  completedAt?: Date;
  signedAt?: Date;
  signedById?: string;
  effectiveAt?: Date;
}

export const formSubmissionSpec: CollectionSpec<
  'FormSubmission',
  FormSubmissionInput,
  FormSubmissionUpdateInput,
  FormSubmissionListQuery
> = {
  model: 'FormSubmission',
  targetType: 'FormSubmission',
  action: 'form.submission',
  patientColumn: 'patientId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: FormSubmissionInput, context: RowContext): Writable<'FormSubmission'> {
    return {
      formDefinitionId: input.formDefinitionId,
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      status: input.status ?? FORM_SUBMISSION_DEFAULTS.status,
      values: jsonColumn(input.values),
      completedByType: input.completedByType ?? FORM_SUBMISSION_DEFAULTS.completedByType,
      completedByUserId: input.completedByUserId ?? null,
      completedAt: input.completedAt ?? null,
      signedAt: null,
      signedById: null,
      // Mirrors `@default(now())`, taken from the request's clock rather than
      // from a second `new Date()`, so every row one request writes carries the
      // same instant.
      effectiveAt: input.effectiveAt ?? context.now,
    };
  },

  patchData(
    patch: FormSubmissionUpdateInput,
    before: ScopedRow<'FormSubmission'>,
    context: RowContext
  ): Partial<Writable<'FormSubmission'>> {
    const data: Partial<Writable<'FormSubmission'>> = {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.values === undefined ? {} : { values: jsonColumn(patch.values) }),
      ...(patch.encounterId === undefined ? {} : { encounterId: patch.encounterId }),
      ...(patch.completedByType === undefined ? {} : { completedByType: patch.completedByType }),
      ...(patch.completedByUserId === undefined
        ? {}
        : { completedByUserId: patch.completedByUserId }),
      ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
      ...(patch.signedAt === undefined ? {} : { signedAt: patch.signedAt }),
      ...(patch.signedById === undefined ? {} : { signedById: patch.signedById }),
      ...(patch.effectiveAt === undefined ? {} : { effectiveAt: patch.effectiveAt }),
    };
    // The write contract refines that a completed submission must record when
    // it was completed, so the column is stamped in the same write that moves
    // the status rather than by whoever remembers. The signature is the same
    // rule one state later.
    if (patch.status === 'COMPLETED' && patch.completedAt === undefined) {
      data.completedAt = context.now;
    }
    if (patch.status === 'SIGNED' && patch.signedAt === undefined) {
      data.signedAt = context.now;
    }
    return data;
  },

  matches(row: ScopedRow<'FormSubmission'>, query: FormSubmissionListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.formDefinitionId !== undefined && row.formDefinitionId !== query.formDefinitionId) {
      return false;
    }
    if (query.status !== undefined && row.status !== query.status) return false;
    return inWindow(row.effectiveAt, query.from, query.to);
  },

  where(query: FormSubmissionListQuery) {
    const effectiveAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.formDefinitionId === undefined ? {} : { formDefinitionId: query.formDefinitionId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(effectiveAt === undefined ? {} : { effectiveAt }),
    };
  },

  sortValue(row: ScopedRow<'FormSubmission'>, sort: FormSubmissionListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.effectiveAt.getTime();
  },

  orderBy(query: FormSubmissionListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ effectiveAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'FormSubmission'>,
    before: ScopedRow<'FormSubmission'> | null
  ): Record<string, unknown> {
    if (before === null) return { formDefinitionId: row.formDefinitionId, status: row.status };
    return before.status === row.status ? {} : { statusFrom: before.status, statusTo: row.status };
  },
};

/* ------------------------------------------------------------------- users */

export interface UserListQuery extends BaseQuery {
  status?: UserStatus;
  isProvider?: boolean;
  /** Free text over given name, family name and email. */
  q?: string;
  sort: 'familyName' | 'email' | 'createdAt';
}

export interface UserCreateInput {
  email: string;
  givenName: string;
  familyName: string;
  credential?: string;
  npi?: string;
  dea?: string;
  taxonomyCode?: string;
  isProvider?: boolean;
  locale?: string;
  status?: UserStatus;
}

/** The email is the natural key, so it is not reassignable through a patch. */
export interface UserUpdateInput {
  givenName?: string;
  familyName?: string;
  credential?: string;
  npi?: string;
  dea?: string;
  taxonomyCode?: string;
  isProvider?: boolean;
  locale?: string;
  status?: UserStatus;
}

export const userSpec: CollectionSpec<'User', UserCreateInput, UserUpdateInput, UserListQuery> = {
  model: 'User',
  targetType: 'User',
  action: 'user',
  // The staff directory carries no chart, and it is still closed to a
  // patient-scoped token: "every clinician in the practice and the credentials
  // they hold" is not a portal user's business, and the absence of a patient
  // column is not a reason to hand it over.
  compartment: 'closed',

  newRow(input: UserCreateInput): Writable<'User'> {
    return {
      email: input.email,
      givenName: input.givenName,
      familyName: input.familyName,
      credential: input.credential ?? null,
      npi: input.npi ?? null,
      dea: input.dea ?? null,
      taxonomyCode: input.taxonomyCode ?? null,
      isProvider: input.isProvider ?? USER_DEFAULTS.isProvider,
      locale: input.locale ?? USER_DEFAULTS.locale,
      status: input.status ?? USER_DEFAULTS.status,
      // Set by the sign-in path, never by a directory write.
      lastLoginAt: null,
    };
  },

  patchData(patch: UserUpdateInput): Partial<Writable<'User'>> {
    return {
      ...(patch.givenName === undefined ? {} : { givenName: patch.givenName }),
      ...(patch.familyName === undefined ? {} : { familyName: patch.familyName }),
      ...(patch.credential === undefined ? {} : { credential: patch.credential }),
      ...(patch.npi === undefined ? {} : { npi: patch.npi }),
      ...(patch.dea === undefined ? {} : { dea: patch.dea }),
      ...(patch.taxonomyCode === undefined ? {} : { taxonomyCode: patch.taxonomyCode }),
      ...(patch.isProvider === undefined ? {} : { isProvider: patch.isProvider }),
      ...(patch.locale === undefined ? {} : { locale: patch.locale }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
    };
  },

  matches(row: ScopedRow<'User'>, query: UserListQuery): boolean {
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.isProvider !== undefined && row.isProvider !== query.isProvider) return false;
    return (
      query.q === undefined || containsFold([row.givenName, row.familyName, row.email], query.q)
    );
  },

  where(query: UserListQuery) {
    return {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.isProvider === undefined ? {} : { isProvider: query.isProvider }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { givenName: { contains: query.q, mode: 'insensitive' as const } },
              { familyName: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }),
    };
  },

  sortValue(row: ScopedRow<'User'>, sort: UserListQuery['sort']): number | string {
    if (sort === 'email') return row.email;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return `${row.familyName} ${row.givenName}`;
  },

  orderBy(query: UserListQuery) {
    const { order } = query;
    if (query.sort === 'email') return [{ email: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ familyName: order }, { givenName: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'User'>): Record<string, unknown> {
    return { status: row.status, isProvider: row.isProvider };
  },

  uniqueBy: {
    where: (input: UserCreateInput) => ({ email: input.email }),
    matches: (row: ScopedRow<'User'>, input: UserCreateInput) => row.email === input.email,
    message: (input: UserCreateInput) => `A user with the email ${input.email} already exists.`,
  },
};

/* ------------------------------------------------------------------- roles */

export interface RoleListQuery extends BaseQuery {
  isSystem?: boolean;
  sort: 'key' | 'name' | 'createdAt';
}

export interface RoleCreateInput {
  key: string;
  name: string;
  description?: string;
  isSystem?: boolean;
}

/** The key is the natural key and the thing permissions are granted against. */
export interface RoleUpdateInput {
  name?: string;
  description?: string;
}

export const roleSpec: CollectionSpec<'Role', RoleCreateInput, RoleUpdateInput, RoleListQuery> = {
  model: 'Role',
  targetType: 'Role',
  action: 'role',
  // Closed for the same reason as the user directory: the shape of a practice's
  // authorisation model is an organisational fact, not a patient's.
  compartment: 'closed',

  newRow(input: RoleCreateInput): Writable<'Role'> {
    return {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      isSystem: input.isSystem ?? ROLE_DEFAULTS.isSystem,
    };
  },

  patchData(patch: RoleUpdateInput): Partial<Writable<'Role'>> {
    return {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
    };
  },

  matches(row: ScopedRow<'Role'>, query: RoleListQuery): boolean {
    return query.isSystem === undefined || row.isSystem === query.isSystem;
  },

  where(query: RoleListQuery) {
    return { ...(query.isSystem === undefined ? {} : { isSystem: query.isSystem }) };
  },

  sortValue(row: ScopedRow<'Role'>, sort: RoleListQuery['sort']): number | string {
    if (sort === 'name') return row.name;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.key;
  },

  orderBy(query: RoleListQuery) {
    const { order } = query;
    if (query.sort === 'name') return [{ name: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ key: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'Role'>): Record<string, unknown> {
    return { key: row.key, isSystem: row.isSystem };
  },

  uniqueBy: {
    where: (input: RoleCreateInput) => ({ key: input.key }),
    matches: (row: ScopedRow<'Role'>, input: RoleCreateInput) => row.key === input.key,
    message: (input: RoleCreateInput) => `A role with the key ${input.key} already exists.`,
  },
};

/* -------------------------------------------------------- role assignments */

export interface RoleAssignmentListQuery extends BaseQuery {
  userId?: string;
  roleId?: string;
  facilityId?: string;
  sort: 'createdAt';
}

export interface RoleAssignmentCreateInput {
  userId: string;
  roleId: string;
  /** Absent means organisation-wide. */
  facilityId?: string;
}

/**
 * Nothing about an assignment is amendable.
 *
 * Narrowing a grant from organisation-wide to one facility, or moving it to
 * another role, is a revocation and a new grant, and the audit log has to be
 * able to show it as two events rather than as one silent edit.
 */
export type RoleAssignmentUpdateInput = Record<string, never>;

export const roleAssignmentSpec: CollectionSpec<
  'RoleAssignment',
  RoleAssignmentCreateInput,
  RoleAssignmentUpdateInput,
  RoleAssignmentListQuery
> = {
  model: 'RoleAssignment',
  targetType: 'RoleAssignment',
  action: 'role.assignment',
  facilityColumn: 'facilityId',
  facilityScoped: true,
  // Who holds which capability, and where, is the other half of the staff
  // directory and is closed for the same reason.
  compartment: 'closed',

  newRow(input: RoleAssignmentCreateInput): Writable<'RoleAssignment'> {
    return {
      userId: input.userId,
      roleId: input.roleId,
      facilityId: input.facilityId ?? null,
    };
  },

  patchData(): Partial<Writable<'RoleAssignment'>> {
    return {};
  },

  matches(row: ScopedRow<'RoleAssignment'>, query: RoleAssignmentListQuery): boolean {
    if (query.userId !== undefined && row.userId !== query.userId) return false;
    if (query.roleId !== undefined && row.roleId !== query.roleId) return false;
    return query.facilityId === undefined || row.facilityId === query.facilityId;
  },

  where(query: RoleAssignmentListQuery) {
    return {
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.roleId === undefined ? {} : { roleId: query.roleId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
    };
  },

  sortValue(row: ScopedRow<'RoleAssignment'>): number {
    return row.createdAt.getTime();
  },

  orderBy(query: RoleAssignmentListQuery) {
    return [{ createdAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'RoleAssignment'>): Record<string, unknown> {
    return { roleId: row.roleId, facilityId: row.facilityId };
  },
};

/* --------------------------------------------------- user facility grants */

export interface UserFacilityListQuery extends BaseQuery {
  userId?: string;
  facilityId?: string;
  sort: 'createdAt';
}

export interface UserFacilityCreateInput {
  userId: string;
  facilityId: string;
  isPrimary?: boolean;
}

/** Only which site is the primary one is amendable; the rest is grant or revoke. */
export interface UserFacilityUpdateInput {
  isPrimary?: boolean;
}

/**
 * Where a member of staff actually works.
 *
 * Distinct from `RoleAssignment.facilityId`, and the distinction is the reason
 * this collection exists rather than the two being conflated. A role assignment
 * narrowed to a facility is an authorisation statement - this permission
 * applies here and not there. A `UserFacility` row is a directory statement -
 * this person works here. They coincide often enough to be mistaken for each
 * other and answer different questions: a nurse may hold one organisation-wide
 * grant and work at three sites, and asking the grant where she works returns
 * nothing at all.
 *
 * Closed to the patient compartment for the same reason the staff directory is:
 * which sites a named member of staff works at is not something a portal
 * session has any business enumerating.
 */
export const userFacilitySpec: CollectionSpec<
  'UserFacility',
  UserFacilityCreateInput,
  UserFacilityUpdateInput,
  UserFacilityListQuery
> = {
  model: 'UserFacility',
  targetType: 'UserFacility',
  action: 'user.facility',
  facilityColumn: 'facilityId',
  compartment: 'closed',

  newRow(input: UserFacilityCreateInput): Writable<'UserFacility'> {
    return {
      userId: input.userId,
      facilityId: input.facilityId,
      isPrimary: input.isPrimary ?? false,
    };
  },

  patchData(patch: UserFacilityUpdateInput): Partial<Writable<'UserFacility'>> {
    return patch.isPrimary === undefined ? {} : { isPrimary: patch.isPrimary };
  },

  matches(row: ScopedRow<'UserFacility'>, query: UserFacilityListQuery): boolean {
    if (query.userId !== undefined && row.userId !== query.userId) return false;
    return query.facilityId === undefined || row.facilityId === query.facilityId;
  },

  where(query: UserFacilityListQuery) {
    return {
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
    };
  },

  sortValue(row: ScopedRow<'UserFacility'>): number {
    return row.createdAt.getTime();
  },

  orderBy(query: UserFacilityListQuery) {
    return [{ createdAt: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'UserFacility'>): Record<string, unknown> {
    return { facilityId: row.facilityId, isPrimary: row.isPrimary };
  },

  /**
   * The natural key the database already enforces.
   *
   * `@@unique([userId, facilityId])` is on the model, so Postgres refuses a
   * second grant. Without this the in-memory store accepted one, and the two
   * implementations of the same collection contract disagreed: the suite passed
   * against memory and the deployed system failed at the database boundary with
   * a driver error rather than the 409 every other collection returns. Declared
   * before a write path exists, because the first route to use it would
   * otherwise inherit the divergence and pass its own tests.
   */
  uniqueBy: {
    where: (input: UserFacilityCreateInput) => ({
      userId: input.userId,
      facilityId: input.facilityId,
    }),
    matches: (row: ScopedRow<'UserFacility'>, input: UserFacilityCreateInput) =>
      row.userId === input.userId && row.facilityId === input.facilityId,
    message: () => 'That member of staff is already attached to that facility.',
  },
};

/* -------------------------------------------------------------- facilities */

export interface FacilityListQuery extends BaseQuery {
  active?: boolean;
  /** Free text over the name and the short code. */
  q?: string;
  sort: 'name' | 'code' | 'createdAt';
}

export interface FacilityCreateInput {
  name: string;
  code: string;
  npi?: string;
  posCode?: string;
  timezone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  active?: boolean;
}

/** The code appears on printed documents and is the natural key, so it is fixed. */
export interface FacilityUpdateInput {
  name?: string;
  npi?: string;
  posCode?: string;
  timezone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  active?: boolean;
}

export const facilitySpec: CollectionSpec<
  'Facility',
  FacilityCreateInput,
  FacilityUpdateInput,
  FacilityListQuery
> = {
  model: 'Facility',
  targetType: 'Facility',
  action: 'facility',
  // A place of service carries no chart, and a portal appointment picker has to
  // be able to name the site it is booking at. Open by decision.
  compartment: 'open',

  newRow(input: FacilityCreateInput): Writable<'Facility'> {
    return {
      name: input.name,
      code: input.code,
      npi: input.npi ?? null,
      posCode: input.posCode ?? null,
      timezone: input.timezone ?? FACILITY_DEFAULTS.timezone,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? FACILITY_DEFAULTS.country,
      phone: input.phone ?? null,
      active: input.active ?? FACILITY_DEFAULTS.active,
    };
  },

  patchData(patch: FacilityUpdateInput): Partial<Writable<'Facility'>> {
    return {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.npi === undefined ? {} : { npi: patch.npi }),
      ...(patch.posCode === undefined ? {} : { posCode: patch.posCode }),
      ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
      ...(patch.addressLine1 === undefined ? {} : { addressLine1: patch.addressLine1 }),
      ...(patch.addressLine2 === undefined ? {} : { addressLine2: patch.addressLine2 }),
      ...(patch.city === undefined ? {} : { city: patch.city }),
      ...(patch.state === undefined ? {} : { state: patch.state }),
      ...(patch.postalCode === undefined ? {} : { postalCode: patch.postalCode }),
      ...(patch.country === undefined ? {} : { country: patch.country }),
      ...(patch.phone === undefined ? {} : { phone: patch.phone }),
      ...(patch.active === undefined ? {} : { active: patch.active }),
    };
  },

  matches(row: ScopedRow<'Facility'>, query: FacilityListQuery): boolean {
    if (query.active !== undefined && row.active !== query.active) return false;
    return query.q === undefined || containsFold([row.name, row.code], query.q);
  },

  where(query: FacilityListQuery) {
    return {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }),
    };
  },

  sortValue(row: ScopedRow<'Facility'>, sort: FacilityListQuery['sort']): number | string {
    if (sort === 'code') return row.code;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.name;
  },

  orderBy(query: FacilityListQuery) {
    const { order } = query;
    if (query.sort === 'code') return [{ code: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ name: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'Facility'>): Record<string, unknown> {
    return { code: row.code, active: row.active };
  },

  uniqueBy: {
    where: (input: FacilityCreateInput) => ({ code: input.code }),
    matches: (row: ScopedRow<'Facility'>, input: FacilityCreateInput) => row.code === input.code,
    message: (input: FacilityCreateInput) =>
      `A facility with the code ${input.code} already exists.`,
  },
};

/* ------------------------------------------------------------- terminology */

export interface TerminologyListQuery extends BaseQuery {
  system?: string;
  code?: string;
  isActive?: boolean;
  /** Free text over the cached display. */
  q?: string;
  sort: 'display' | 'code' | 'createdAt';
}

/**
 * A loaded code's system and code are its identity, so neither is patchable:
 * changing either would silently repoint every clinical row that stored the old
 * pair. Reloading a code set writes new rows instead.
 */
export interface TerminologyCodeUpdateInput {
  display?: string;
  parentCode?: string;
  isActive?: boolean;
  properties?: Record<string, unknown>;
}

export const terminologyCodeSpec: CollectionSpec<
  'TerminologyCode',
  TerminologyCodeInput,
  TerminologyCodeUpdateInput,
  TerminologyListQuery
> = {
  model: 'TerminologyCode',
  targetType: 'TerminologyCode',
  action: 'terminology.code',
  // Cached display text for a code somebody's deployment is licensed for. It
  // names no patient and every screen resolves codes through it, so it is open
  // by decision.
  compartment: 'open',

  newRow(input: TerminologyCodeInput): Writable<'TerminologyCode'> {
    return {
      system: input.system,
      code: input.code,
      display: input.display,
      version: input.version ?? TERMINOLOGY_DEFAULTS.version,
      parentCode: input.parentCode ?? null,
      isActive: input.isActive ?? TERMINOLOGY_DEFAULTS.isActive,
      properties: jsonColumn(input.properties),
    };
  },

  patchData(patch: TerminologyCodeUpdateInput): Partial<Writable<'TerminologyCode'>> {
    return {
      ...(patch.display === undefined ? {} : { display: patch.display }),
      ...(patch.parentCode === undefined ? {} : { parentCode: patch.parentCode }),
      ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
      ...(patch.properties === undefined ? {} : { properties: jsonColumn(patch.properties) }),
    };
  },

  matches(row: ScopedRow<'TerminologyCode'>, query: TerminologyListQuery): boolean {
    if (query.system !== undefined && row.system !== query.system) return false;
    if (query.code !== undefined && row.code !== query.code) return false;
    if (query.isActive !== undefined && row.isActive !== query.isActive) return false;
    return query.q === undefined || containsFold([row.display], query.q);
  },

  where(query: TerminologyListQuery) {
    return {
      ...(query.system === undefined ? {} : { system: query.system }),
      ...(query.code === undefined ? {} : { code: query.code }),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.q === undefined
        ? {}
        : { display: { contains: query.q, mode: 'insensitive' as const } }),
    };
  },

  sortValue(
    row: ScopedRow<'TerminologyCode'>,
    sort: TerminologyListQuery['sort']
  ): number | string {
    if (sort === 'code') return row.code;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.display;
  },

  orderBy(query: TerminologyListQuery) {
    const { order } = query;
    if (query.sort === 'code') return [{ code: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ display: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'TerminologyCode'>): Record<string, unknown> {
    return { system: row.system, code: row.code };
  },

  uniqueBy: {
    where: (input: TerminologyCodeInput) => ({
      system: input.system,
      code: input.code,
      version: input.version ?? TERMINOLOGY_DEFAULTS.version,
    }),
    matches: (row: ScopedRow<'TerminologyCode'>, input: TerminologyCodeInput) =>
      row.system === input.system &&
      row.code === input.code &&
      row.version === (input.version ?? TERMINOLOGY_DEFAULTS.version),
    message: (input: TerminologyCodeInput) =>
      `The code ${input.code} is already loaded from ${input.system}.`,
  },
};

export const platformSpecs = {
  formDefinitions: formDefinitionSpec,
  formSubmissions: formSubmissionSpec,
  users: userSpec,
  roles: roleSpec,
  roleAssignments: roleAssignmentSpec,
  userFacilities: userFacilitySpec,
  facilities: facilitySpec,
  terminology: terminologyCodeSpec,
} as const;

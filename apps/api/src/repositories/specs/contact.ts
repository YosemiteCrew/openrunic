import type { CollectionSpec, BaseQuery, RowContext } from '../collection.js';
import type { ScopedRow } from '../rows.js';
import { equalsIfSet, matchesIfSet } from '../collection.js';

export interface ContactIntakeListQuery extends BaseQuery {
  type?: 'GENERAL_ENQUIRY' | 'FEATURE_REQUEST' | 'DSAR' | 'COMPLAINT';
  source?: 'PMS_WEB' | 'MARKETING_SITE';
  receivedAtFrom?: Date;
  receivedAtTo?: Date;
}

export interface ContactIntakeCreateInput {
  sourceRequestId: string;
  type: 'GENERAL_ENQUIRY' | 'FEATURE_REQUEST' | 'DSAR' | 'COMPLAINT';
  source: 'PMS_WEB' | 'MARKETING_SITE';
  message: string;
  fullName: string;
  email: string;
  phone?: string | null;
  organisationId?: string | null;
  dsarDetails?: unknown;
  attachments?: unknown;
  sourceCreatedAt: Date;
}

export type ContactIntakePatchInput = never;

export const contactIntakeSpec: CollectionSpec<
  'ContactIntake',
  ContactIntakeCreateInput,
  ContactIntakePatchInput,
  ContactIntakeListQuery
> = {
  model: 'ContactIntake',
  targetType: 'ContactIntake',
  action: 'contactIntake',
  compartment: 'closed',
  uniqueBy: {
    where: (input) => ({ sourceRequestId: input.sourceRequestId }),
    matches: (row, input) => row.sourceRequestId === input.sourceRequestId,
    message: () => 'A contact submission with this sourceRequestId already exists',
  },

  newRow(input: ContactIntakeCreateInput, context: RowContext): ScopedRow<'ContactIntake'> {
    const now = new Date();
    return {
      id: input.sourceRequestId,
      tenantId: context.tenantId,
      sourceRequestId: input.sourceRequestId,
      type: input.type,
      source: input.source,
      message: input.message,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      organisationId: input.organisationId ?? null,
      dsarDetails: input.dsarDetails ?? null,
      attachments: input.attachments ?? null,
      receivedAt: now,
      sourceCreatedAt: input.sourceCreatedAt,
      createdAt: now,
      updatedAt: now,
    };
  },

  patchData(): Partial<ScopedRow<'ContactIntake'>> {
    return {};
  },

  matches(row: ScopedRow<'ContactIntake'>, query: ContactIntakeListQuery): boolean {
    return (
      equalsIfSet(query.type, row.type) &&
      equalsIfSet(query.source, row.source) &&
      matchesIfSet(query.receivedAtFrom, (from) => row.receivedAt >= from) &&
      matchesIfSet(query.receivedAtTo, (to) => row.receivedAt < to)
    );
  },

  where(query: ContactIntakeListQuery) {
    return {
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.receivedAtFrom === undefined && query.receivedAtTo === undefined
        ? {}
        : {
            receivedAt: {
              ...(query.receivedAtFrom === undefined ? {} : { gte: query.receivedAtFrom }),
              ...(query.receivedAtTo === undefined ? {} : { lt: query.receivedAtTo }),
            },
          }),
    };
  },

  sortValue(
    row: ScopedRow<'ContactIntake'>,
    sort: ContactIntakeListQuery['sort']
  ): number | string {
    switch (sort) {
      case 'sourceCreatedAt':
        return row.sourceCreatedAt.getTime();
      case 'type':
        return row.type;
      case 'source':
        return row.source;
      default:
        return row.receivedAt.getTime();
    }
  },

  orderBy(query: ContactIntakeListQuery) {
    const sort = query.sort ?? 'receivedAt';
    const order = query.order ?? 'desc';
    const field =
      sort === 'sourceCreatedAt'
        ? 'sourceCreatedAt'
        : sort === 'type'
          ? 'type'
          : sort === 'source'
            ? 'source'
            : 'receivedAt';
    return [{ [field]: order }, { id: 'asc' }];
  },

  writeMetadata(row: ScopedRow<'ContactIntake'>, before: ScopedRow<'ContactIntake'> | null) {
    if (before === null) return { type: row.type, source: row.source };
    return {};
  },
};

// Outbox spec
export interface ContactIntakeOutboxListQuery extends BaseQuery {
  type?: 'GENERAL_ENQUIRY' | 'FEATURE_REQUEST' | 'DSAR' | 'COMPLAINT';
  source?: 'PMS_WEB' | 'MARKETING_SITE';
  processed?: boolean;
  tenantId?: string;
  receivedAtFrom?: Date;
  receivedAtTo?: Date;
}

export interface ContactIntakeOutboxCreateInput {
  sourceRequestId: string;
  type: 'GENERAL_ENQUIRY' | 'FEATURE_REQUEST' | 'DSAR' | 'COMPLAINT';
  source: 'PMS_WEB' | 'MARKETING_SITE';
  message: string;
  fullName: string;
  email: string;
  phone?: string | null;
  organisationId?: string | null;
  dsarDetails?: unknown;
  attachments?: unknown;
  sourceCreatedAt: Date;
  lastError?: string | null;
  attempts?: number;
  maxAttempts?: number;
  lastAttemptAt?: Date | null;
  processedAt?: Date | null;
}

export interface ContactIntakeOutboxPatchInput {
  attempts?: number;
  lastError?: string | null;
  lastAttemptAt?: Date | null;
  processedAt?: Date | null;
}

export const contactIntakeOutboxSpec: CollectionSpec<
  'ContactIntakeOutbox',
  ContactIntakeOutboxCreateInput,
  ContactIntakeOutboxPatchInput,
  ContactIntakeOutboxListQuery
> = {
  model: 'ContactIntakeOutbox',
  targetType: 'ContactIntakeOutbox',
  action: 'contactIntakeOutbox',
  compartment: 'closed',
  uniqueBy: {
    where: (input) => ({ sourceRequestId: input.sourceRequestId }),
    matches: (row, input) => row.sourceRequestId === input.sourceRequestId,
    message: () => 'An outbox entry with this sourceRequestId already exists',
  },

  newRow(
    input: ContactIntakeOutboxCreateInput,
    context: RowContext
  ): ScopedRow<'ContactIntakeOutbox'> {
    const now = new Date();
    return {
      id: input.sourceRequestId,
      tenantId: context.tenantId,
      sourceRequestId: input.sourceRequestId,
      type: input.type,
      source: input.source,
      message: input.message,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      organisationId: input.organisationId ?? null,
      dsarDetails: input.dsarDetails ?? null,
      attachments: input.attachments ?? null,
      sourceCreatedAt: input.sourceCreatedAt,
      lastError: input.lastError ?? null,
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? 5,
      receivedAt: now,
      lastAttemptAt: input.lastAttemptAt ?? null,
      processedAt: input.processedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
  },

  patchData(patch: ContactIntakeOutboxPatchInput): Partial<ScopedRow<'ContactIntakeOutbox'>> {
    const data: Partial<ScopedRow<'ContactIntakeOutbox'>> = {};
    if (patch.attempts !== undefined) data.attempts = patch.attempts;
    if (patch.lastError !== undefined) data.lastError = patch.lastError;
    if (patch.lastAttemptAt !== undefined) data.lastAttemptAt = patch.lastAttemptAt;
    if (patch.processedAt !== undefined) data.processedAt = patch.processedAt;
    return data;
  },

  matches(row: ScopedRow<'ContactIntakeOutbox'>, query: ContactIntakeOutboxListQuery): boolean {
    return (
      equalsIfSet(query.type, row.type) &&
      equalsIfSet(query.source, row.source) &&
      matchesIfSet(query.processed, (processed) =>
        processed ? row.processedAt !== null : row.processedAt === null
      ) &&
      matchesIfSet(query.receivedAtFrom, (from) => row.receivedAt >= from) &&
      matchesIfSet(query.receivedAtTo, (to) => row.receivedAt < to)
    );
  },

  where(query: ContactIntakeOutboxListQuery) {
    return {
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.processed === undefined
        ? {}
        : query.processed
          ? { processedAt: { not: null } }
          : { processedAt: null }),
      ...(query.receivedAtFrom === undefined && query.receivedAtTo === undefined
        ? {}
        : {
            receivedAt: {
              ...(query.receivedAtFrom === undefined ? {} : { gte: query.receivedAtFrom }),
              ...(query.receivedAtTo === undefined ? {} : { lt: query.receivedAtTo }),
            },
          }),
    };
  },

  sortValue(
    row: ScopedRow<'ContactIntakeOutbox'>,
    sort: ContactIntakeOutboxListQuery['sort']
  ): number | string {
    switch (sort) {
      case 'sourceCreatedAt':
        return row.sourceCreatedAt.getTime();
      case 'type':
        return row.type;
      case 'source':
        return row.source;
      case 'attempts':
        return row.attempts;
      case 'processedAt':
        return row.processedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      default:
        return row.receivedAt.getTime();
    }
  },

  orderBy(query: ContactIntakeOutboxListQuery) {
    const sort = query.sort ?? 'receivedAt';
    const order = query.order ?? 'desc';
    const fieldMap: Record<string, string> = {
      sourceCreatedAt: 'sourceCreatedAt',
      type: 'type',
      source: 'source',
      attempts: 'attempts',
      processedAt: 'processedAt',
    };
    const field = fieldMap[sort] ?? 'receivedAt';
    return [{ [field]: order }, { id: 'asc' }];
  },

  writeMetadata(
    row: ScopedRow<'ContactIntakeOutbox'>,
    before: ScopedRow<'ContactIntakeOutbox'> | null
  ) {
    if (before === null) return { type: row.type, source: row.source };
    return {};
  },
};

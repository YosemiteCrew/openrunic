import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

export const contactIntakeDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sourceRequestId: z.string().uuid(),
  type: z.enum(['GENERAL_ENQUIRY', 'FEATURE_REQUEST', 'DSAR', 'COMPLAINT']),
  source: z.enum(['PMS_WEB', 'MARKETING_SITE']),
  message: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  organisationId: z.string().uuid().nullable(),
  dsarDetails: z.unknown(),
  attachments: z.unknown(),
  receivedAt: z.string().datetime(),
  sourceCreatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ContactIntakeDto = z.infer<typeof contactIntakeDtoSchema>;

export const contactIntakeListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['GENERAL_ENQUIRY', 'FEATURE_REQUEST', 'DSAR', 'COMPLAINT']).optional(),
  source: z.enum(['PMS_WEB', 'MARKETING_SITE']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type ContactIntakeListQuery = z.infer<typeof contactIntakeListQuerySchema>;

export function toContactIntakeListQuery(input: ContactIntakeListQuery, tenantId: string) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort ?? 'receivedAt',
    order: input.order ?? 'desc',
    tenantId,
    type: input.type,
    source: input.source,
    receivedAtFrom: input.from ? new Date(input.from) : undefined,
    receivedAtTo: input.to ? new Date(input.to) : undefined,
  };
}

export function toContactIntakeDto(row: {
  id: string;
  tenantId: string;
  sourceRequestId: string;
  type: string;
  source: string;
  message: string;
  fullName: string;
  email: string;
  phone: string | null;
  organisationId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  dsarDetails: unknown | null;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  attachments: unknown | null;
  receivedAt: Date;
  sourceCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ContactIntakeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceRequestId: row.sourceRequestId,
    type: row.type as ContactIntakeDto['type'],
    source: row.source as ContactIntakeDto['source'],
    message: row.message,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    organisationId: row.organisationId,
    dsarDetails: row.dsarDetails,
    attachments: row.attachments,
    receivedAt: row.receivedAt.toISOString(),
    sourceCreatedAt: row.sourceCreatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Outbox schemas
export const contactIntakeOutboxDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sourceRequestId: z.string().uuid(),
  type: z.enum(['GENERAL_ENQUIRY', 'FEATURE_REQUEST', 'DSAR', 'COMPLAINT']),
  source: z.enum(['PMS_WEB', 'MARKETING_SITE']),
  message: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  organisationId: z.string().uuid().nullable(),
  dsarDetails: z.unknown(),
  attachments: z.unknown(),
  sourceCreatedAt: z.string().datetime(),
  lastError: z.string().nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  receivedAt: z.string().datetime(),
  lastAttemptAt: z.string().datetime().nullable(),
  processedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ContactIntakeOutboxDto = z.infer<typeof contactIntakeOutboxDtoSchema>;

export const contactIntakeOutboxListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['GENERAL_ENQUIRY', 'FEATURE_REQUEST', 'DSAR', 'COMPLAINT']).optional(),
  source: z.enum(['PMS_WEB', 'MARKETING_SITE']).optional(),
  processed: z.boolean().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type ContactIntakeOutboxListQuery = z.infer<typeof contactIntakeOutboxListQuerySchema>;

export function toContactIntakeOutboxListQuery(
  input: ContactIntakeOutboxListQuery,
  tenantId: string
) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort ?? 'receivedAt',
    order: input.order ?? 'desc',
    tenantId,
    type: input.type,
    source: input.source,
    processedAt: input.processed ? { not: null } : null,
    receivedAtFrom: input.from ? new Date(input.from) : undefined,
    receivedAtTo: input.to ? new Date(input.to) : undefined,
  };
}

export function toContactIntakeOutboxDto(row: {
  id: string;
  tenantId: string;
  sourceRequestId: string;
  type: string;
  source: string;
  message: string;
  fullName: string;
  email: string;
  phone: string | null;
  organisationId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  dsarDetails: unknown | null;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  attachments: unknown | null;
  sourceCreatedAt: Date;
  lastError: string | null;
  attempts: number;
  maxAttempts: number;
  receivedAt: Date;
  lastAttemptAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ContactIntakeOutboxDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceRequestId: row.sourceRequestId,
    type: row.type as ContactIntakeOutboxDto['type'],
    source: row.source as ContactIntakeOutboxDto['source'],
    message: row.message,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    organisationId: row.organisationId,
    dsarDetails: row.dsarDetails,
    attachments: row.attachments,
    sourceCreatedAt: row.sourceCreatedAt.toISOString(),
    lastError: row.lastError,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    receivedAt: row.receivedAt.toISOString(),
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    processedAt: row.processedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

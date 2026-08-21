import type { MeasureDefinition } from '@openrunic/quality';
import { z } from 'zod';

import type { ValueSetListQuery } from '../repositories/specs/platform.js';
import type { ScopedRow } from '../repositories/rows.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';

/**
 * What a quality measure looks like on the wire.
 *
 * `computable` and `missingValueSets` are the fields that matter to an
 * operator. The specifications are public; the code lists behind them are
 * licensed content this project does not redistribute, so a fresh deployment
 * can compute none of these until it has loaded the value sets, and this is how
 * it finds out which.
 */
export const measureListSchema = z.strictObject({
  id: z.string().regex(/^CMS\d{2,4}$/u),
  title: z.string(),
  version: z.string(),
  /** False when a lower rate is the better practice. See CMS122. */
  higherIsBetter: z.boolean(),
  computable: z.boolean(),
  /** Canonical URLs the measure reads that this deployment has not defined. */
  missingValueSets: z.array(z.string()),
});

export type MeasureSummaryDto = z.infer<typeof measureListSchema>;

export function toMeasureSummary(
  measure: MeasureDefinition,
  loaded: ReadonlySet<string>
): MeasureSummaryDto {
  const missingValueSets = measure.valueSets.filter((url) => !loaded.has(url));
  return {
    id: measure.id,
    title: measure.title,
    version: measure.version,
    higherIsBetter: measure.higherIsBetter,
    computable: missingValueSets.length === 0,
    missingValueSets,
  };
}

export const measureReportSchema = z.strictObject({
  measureId: z.string(),
  title: z.string(),
  /**
   * The specification version the numbers were computed to.
   *
   * On the wire because these change annually, and a report labelled with this
   * year and computed to last year's rules is worse than no report.
   */
  version: z.string(),
  higherIsBetter: z.boolean(),
  periodStart: z.string(),
  periodEnd: z.string(),
  initialPopulation: z.int(),
  denominator: z.int(),
  denominatorExclusion: z.int(),
  denominatorException: z.int(),
  numerator: z.int(),
  /**
   * Patients in the denominator whose record does not contain what the
   * numerator needs.
   *
   * They count against the rate, because an unrecorded result is not a result.
   * Reported separately because care that did not happen and care that was not
   * written down are different problems with different fixes.
   */
  numeratorUnknown: z.int(),
  /** Null when nothing remains to divide by. Not zero: an empty denominator has no rate. */
  performanceRate: z.number().nullable(),
});

export type MeasureReportDto = z.infer<typeof measureReportSchema>;

export const qualityReportQuerySchema = z.strictObject({
  /** Inclusive. */
  periodStart: z.iso.datetime({ offset: true }),
  /** Exclusive, so a calendar year is 1 January to 1 January. */
  periodEnd: z.iso.datetime({ offset: true }),
});

export type QualityReportQuery = z.infer<typeof qualityReportQuerySchema>;

/* ---------------------------------------------------------------- value sets */

/**
 * A value set definition on the wire.
 *
 * `definition` is validated by the terminology package's own schema on the way
 * in, at the route, rather than restated here. Two schemas for one shape is two
 * places to change when a rule field is added, and one of them is always the
 * one nobody remembers.
 */
export const valueSetDtoSchema = z.strictObject({
  id: z.uuid(),
  url: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  definition: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ValueSetDto = z.infer<typeof valueSetDtoSchema>;

export const valueSetCreateSchema = z.strictObject({
  url: z.string().min(1).max(512),
  name: z.string().min(1).max(256).optional(),
  description: z.string().min(1).max(1024).optional(),
  /** Checked against the terminology package's schema by the route. */
  definition: z.record(z.string(), z.unknown()),
});

export type ValueSetCreateBody = z.infer<typeof valueSetCreateSchema>;

export const valueSetPatchSchema = z
  .strictObject({
    name: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(1024).optional(),
    definition: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type ValueSetPatchBody = z.infer<typeof valueSetPatchSchema>;

export const valueSetListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  url: z.string().min(1).max(512).optional(),
  sort: z.enum(['url', 'createdAt']).default('url'),
  order: sortOrderField,
});

export type ValueSetListQueryInput = z.infer<typeof valueSetListQuerySchema>;

export function toValueSetListQuery(input: ValueSetListQueryInput): ValueSetListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.url === undefined ? {} : { url: input.url }),
    sort: input.sort,
    order: input.order,
  };
}

export function toValueSetDto(row: ScopedRow<'ValueSet'>): ValueSetDto {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    description: row.description,
    definition: row.definition,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

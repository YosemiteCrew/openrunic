import { z } from 'zod';

import {
  FORM_BINDINGS,
  FORM_COMPLETED_BY_TYPES,
  FORM_STATUSES,
  FORM_SUBMISSION_STATUSES,
} from '../enums.js';
import { PROMOTED_FIELD_TYPES } from '../forms.js';
import { code, codeSystem, jsonObject, shortText, timestamp, uuid } from './common.js';

/**
 * Form aggregate: the versioned definition, its promotion manifest, and the
 * submissions written against a pinned version.
 *
 * `definition` and `values` are validated here only for shape - that they are
 * JSON objects of a sane size. Their contents are validated by the zod schema
 * the form compiler generates at publish time from the definition itself, which
 * is the whole point of the engine: field-level validation is data, not code.
 */

export const promotedFieldSpecInput = z
  .strictObject({
    fieldKey: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'fieldKey must be an identifier'),
    type: z.enum(PROMOTED_FIELD_TYPES),
    /** Required for coded fields unless every answer carries its own system. */
    codeSystem: codeSystem.optional(),
    /** Default UCUM unit for quantity fields whose answers omit one. */
    unit: z.string().min(1).max(32).optional(),
    repeating: z.boolean().optional(),
  })
  .refine((value) => value.type !== 'quantity' || value.unit !== undefined, {
    message: 'a promoted quantity field must declare a default unit',
    path: ['unit'],
  });

export const promotionManifestInput = z
  .strictObject({
    definitionKey: z.string().min(1).max(64),
    definitionVersion: z.int().positive(),
    fields: z.array(promotedFieldSpecInput).max(200),
  })
  .refine(
    (value) => new Set(value.fields.map((field) => field.fieldKey)).size === value.fields.length,
    { message: 'a field may appear in the promotion manifest only once', path: ['fields'] }
  );

export const formDefinitionCreateInput = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, 'key must be lowercase kebab-case'),
  version: z.int().positive(),
  status: z.enum(FORM_STATUSES).optional(),
  title: shortText,
  description: shortText.optional(),
  bindTo: z.enum(FORM_BINDINGS),
  definition: jsonObject,
  /** Publish-time artefacts: validator, render tree, print layout, FHIR mapping. */
  compiled: jsonObject.optional(),
  promotionManifest: promotionManifestInput.optional(),
});

/**
 * Publishing a definition freezes it. There is deliberately no update input:
 * changing a published form means creating the next version, so an in-flight
 * submission always keeps the definition it was authored against.
 */
export const formDefinitionPublishInput = z.strictObject({
  formDefinitionId: uuid,
  compiled: jsonObject,
  promotionManifest: promotionManifestInput.optional(),
  publishedAt: timestamp.optional(),
});

export const formSubmissionInput = z
  .strictObject({
    /** Pins the exact definition version this answer set was authored against. */
    formDefinitionId: uuid,
    patientId: uuid,
    encounterId: uuid.optional(),
    status: z.enum(FORM_SUBMISSION_STATUSES).optional(),
    values: jsonObject,
    completedByType: z.enum(FORM_COMPLETED_BY_TYPES).optional(),
    completedByUserId: uuid.optional(),
    completedAt: timestamp.optional(),
    /** Clinically effective instant; what promoted values are graphed against. */
    effectiveAt: timestamp.optional(),
  })
  .refine((value) => value.completedByType !== 'USER' || value.completedByUserId !== undefined, {
    message: 'a staff-completed submission must name the user',
    path: ['completedByUserId'],
  })
  .refine((value) => value.status !== 'COMPLETED' || value.completedAt !== undefined, {
    message: 'a completed submission must record when it was completed',
    path: ['completedAt'],
  });

export const formPromotedValueQuery = z
  .strictObject({
    patientId: uuid.optional(),
    definitionKey: z.string().min(1).max(64).optional(),
    fieldKey: z.string().min(1).max(64),
    from: timestamp.optional(),
    to: timestamp.optional(),
    limit: z.int().positive().max(1000).optional(),
  })
  .refine((value) => value.patientId !== undefined || value.definitionKey !== undefined, {
    message: 'promoted-value queries must be scoped to a patient or a definition',
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: 'to must not precede from',
    path: ['to'],
  });

export const terminologyCodeInput = z.strictObject({
  system: codeSystem,
  code,
  display: shortText,
  version: z.string().max(32).optional(),
  parentCode: code.optional(),
  isActive: z.boolean().optional(),
  properties: jsonObject.optional(),
});

export type PromotedFieldSpecInput = z.infer<typeof promotedFieldSpecInput>;
export type PromotionManifestInput = z.infer<typeof promotionManifestInput>;
export type FormDefinitionCreateInput = z.infer<typeof formDefinitionCreateInput>;
export type FormDefinitionPublishInput = z.infer<typeof formDefinitionPublishInput>;
export type FormSubmissionInput = z.infer<typeof formSubmissionInput>;
export type FormPromotedValueQuery = z.infer<typeof formPromotedValueQuery>;
export type TerminologyCodeInput = z.infer<typeof terminologyCodeInput>;

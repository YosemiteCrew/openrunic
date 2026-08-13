import { z } from 'zod';

import type { CompiledField, FormValuesSchema } from './compiled.js';

/**
 * The generated zod validator for a submission's `values` document.
 *
 * One schema, generated once at publish time, is the reason the browser and the
 * server can never disagree about whether a submission is well formed: they run
 * the same compiled artifact rather than two hand-written checks that drift.
 *
 * What the schema does and does not assert is a deliberate split:
 *
 *   1. It asserts shape. Types, bounds, option membership, string lengths, ISO
 *      date formats. These are properties of the definition alone, so a static
 *      schema can settle them without seeing another answer.
 *   2. It asserts the base `required` flag, with one carve-out. A field that a
 *      `show` or `hide` rule can remove from the page may legitimately be
 *      absent, so the schema declines to demand it and {@link validateResponse}
 *      demands it only when the field is actually visible. Encoding the
 *      condition into zod instead would mean regenerating the schema per
 *      request, which is exactly what compiling at publish time avoids.
 *   3. It asserts nothing about conditional requirement. A `require` or
 *      `optional` rule depends on other answers, so it is enforced by
 *      {@link validateResponse}, which is the only stage that has them.
 *   4. Inside a repeating group it asserts element shape only. How many
 *      repetitions exist is a runtime fact about the answers, so per-repetition
 *      requiredness is settled in the same conditional pass.
 *
 * The document is strict: an unrecognized key means the submission was written
 * against a different definition version, which is a data-integrity problem
 * worth surfacing rather than a stray field worth stripping.
 */

function elementSchema(field: CompiledField): z.ZodType | undefined {
  const source = field.field;
  switch (source.type) {
    case 'shortText':
    case 'longText': {
      let schema = z.string();
      if (source.maxLength !== undefined) {
        schema = schema.max(source.maxLength);
      }
      return schema;
    }
    case 'number': {
      let schema = source.integer === true ? z.number().int() : z.number();
      if (source.min !== undefined) {
        schema = schema.min(source.min);
      }
      if (source.max !== undefined) {
        schema = schema.max(source.max);
      }
      return schema;
    }
    case 'date':
      return z.iso.date();
    case 'datetime':
      return z.iso.datetime({ offset: true });
    case 'singleSelect':
      return z.enum(source.options.map((option) => option.value));
    case 'multiSelect': {
      let schema = z.array(z.enum(source.options.map((option) => option.value)));
      if (source.minSelected !== undefined) {
        schema = schema.min(source.minSelected);
      }
      if (source.maxSelected !== undefined) {
        schema = schema.max(source.maxSelected);
      }
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'scale':
      return z.number().int().min(source.min).max(source.max);
    case 'signature':
    case 'fileReference':
      return z.string();
    case 'codedValue':
      return z.strictObject({
        code: z.string().min(1),
        system: z.string().min(1).optional(),
        display: z.string().optional(),
      });
    default:
      // Headings, static text and the group container carry no answer, so they
      // contribute no key at all. Absence is the signal; there is no "empty"
      // element that would still let them into a strict document.
      return undefined;
  }
}

/** True when a rule can take this field off the page, so absence is legitimate. */
function canBeHidden(field: CompiledField): boolean {
  return field.conditions.some((rule) => rule.effect === 'show' || rule.effect === 'hide');
}

/** Builds the strict object schema for one compiled definition. */
export function buildValuesSchema(fields: readonly CompiledField[]): FormValuesSchema {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const element = elementSchema(field);
    if (element === undefined) {
      continue;
    }
    if (field.groupKey !== undefined) {
      // Columnar: one entry per repetition, `null` where that repetition left
      // the field blank. See FormValues for why the document is shaped this way.
      shape[field.key] = z.array(element.nullable()).optional();
      continue;
    }
    shape[field.key] = field.required && !canBeHidden(field) ? element : element.optional();
  }
  return z.strictObject(shape);
}

import { z } from 'zod';

import type { JsonObject } from '../json.js';
import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { authoredText } from './shared.js';

/**
 * Tool 5. Form-builder assistance, at design time.
 *
 * The safest genuinely useful task in the product: it operates on a form
 * definition rather than on a patient, an administrator reviews it before
 * publish, and nothing it produces is clinical content about anyone. It ships
 * as a draft definition in `pending`, and publishing stays a human act.
 */

const fieldSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z][a-zA-Z0-9]*$/, 'Field keys are lower camel case.'),
  label: authoredText(120),
  type: z.enum(['text', 'longText', 'number', 'date', 'boolean', 'choice']),
  required: z.boolean(),
  /** Present only for `choice`. Validated below rather than left to the renderer. */
  options: z.array(authoredText(80)).max(24).optional(),
});

export const formsDraftDefinition = defineTool({
  id: 'forms.draftDefinition',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['form.write'],
  surfaces: ['staff'],
  summary: 'Drafts a form definition for an administrator to review before it is published.',
  activityLabel: 'Drafting a form definition',
  maxResultRows: 1,
  compartmentBound: false,
  input: z
    .strictObject({
      title: authoredText(120),
      purpose: authoredText(400),
      fields: z.array(fieldSchema).min(1).max(60),
    })
    .refine(
      (value) =>
        value.fields.every((field) => field.type !== 'choice' || (field.options ?? []).length >= 2),
      { message: 'A choice field needs at least two options.', path: ['fields'] }
    )
    .refine(
      (value) => new Set(value.fields.map((field) => field.key)).size === value.fields.length,
      { message: 'Field keys must be unique.', path: ['fields'] }
    ),
  output: proposalResultSchema,

  execute(input) {
    const body: JsonObject = {
      kind: 'definition',
      status: 'draft',
      title: input.title,
      purpose: input.purpose,
      fields: input.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.options === undefined ? {} : { options: [...field.options] }),
      })),
    };

    return Promise.resolve(
      pending({
        kind: 'form.definition',
        effect: [
          { label: 'Title', value: input.title },
          { label: 'Fields', value: String(input.fields.length) },
          {
            label: 'Required fields',
            value: String(input.fields.filter((field) => field.required).length),
          },
        ],
        affects: [],
        commit: { method: 'POST', path: '/bff/v0/forms', body },
        derivedFromUntrusted: false,
      })
    );
  },
});

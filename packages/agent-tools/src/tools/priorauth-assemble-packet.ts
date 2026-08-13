import { z } from 'zod';

import type { JsonObject } from '../json.js';
import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { authoredText, codedValueSchema } from './shared.js';

/**
 * Tool 4. Builds the prior-authorisation packet.
 *
 * The split is the whole point. **The form is assembled deterministically** from
 * the payer field specification below and the coded values the caller supplies;
 * the model writes **only** the narrative justification and never produces the
 * document. Published evaluations of model-written authorisation letters find
 * strong clinical content and weak administrative scaffolding, so content and
 * scaffolding are separated in code rather than hoped about in a prompt.
 */

const MAX_JUSTIFICATION = 3000;

/**
 * The field specification, in code. A payer profile is data a deployer edits;
 * what is not negotiable is that the fields come from here and the values come
 * from the record, never from the model.
 */
export const PRIOR_AUTH_FIELDS: readonly string[] = [
  'payer',
  'memberId',
  'serviceCode',
  'diagnosisCodes',
  'requestedUnits',
  'startDate',
  'renderingProviderId',
  'justification',
];

export const priorauthAssemblePacket = defineTool({
  id: 'priorauth.assemblePacket',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['form.write'],
  surfaces: ['staff'],
  summary:
    'Assembles a prior-authorisation packet from the record and drafts the justification section.',
  activityLabel: 'Assembling a prior-authorisation packet',
  maxResultRows: 1,
  compartmentBound: false,
  input: z.strictObject({
    payer: codedValueSchema,
    memberId: z.string().min(1).max(64),
    serviceCode: codedValueSchema,
    diagnosisCodes: z.array(codedValueSchema).min(1).max(12),
    requestedUnits: z.int().min(1).max(999),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.'),
    renderingProviderId: z.uuid(),
    /** The only field the model authors. Everything else above is a coded value. */
    justification: authoredText(MAX_JUSTIFICATION),
  }),
  output: proposalResultSchema,

  execute(input) {
    const body: JsonObject = {
      kind: 'prior-authorisation',
      status: 'draft',
      payer: { ...input.payer },
      memberId: input.memberId,
      serviceCode: { ...input.serviceCode },
      diagnosisCodes: input.diagnosisCodes.map((code) => ({ ...code })),
      requestedUnits: input.requestedUnits,
      startDate: input.startDate,
      renderingProviderId: input.renderingProviderId,
      justification: input.justification,
    };

    return Promise.resolve(
      pending({
        kind: 'form.priorAuthorisation',
        effect: [
          { label: 'Payer', value: input.payer.display ?? input.payer.code },
          { label: 'Service', value: input.serviceCode.code },
          { label: 'Units requested', value: String(input.requestedUnits) },
          { label: 'Start date', value: input.startDate },
        ],
        affects: [],
        commit: { method: 'POST', path: '/bff/v0/forms', body },
        derivedFromUntrusted: false,
      })
    );
  },
});

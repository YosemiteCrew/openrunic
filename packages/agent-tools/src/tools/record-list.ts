import { z } from 'zod';

import { defineTool } from '../registry.js';
import type { ToolContext } from '../registry.js';

import {
  assertChartBound,
  dayOf,
  ownedRetrieval,
  ownedRetrievalSchema,
  parseOwnedPage,
  plainStatus,
  type OwnedRecord,
} from './patient-shared.js';

/**
 * Patient tool 1. Lists what the record already says, one part at a time.
 *
 * It returns rows, never a statement about them. That is the property that
 * makes it the safest useful thing a patient-facing assistant can do, and the
 * reason it ships first: its failure mode is a visible empty list, which the
 * reader can check against the same screen in the portal.
 *
 * What it leaves out is as deliberate as what it returns.
 *
 * **No severity and no criticality.** The stored record grades an allergy
 * `HIGH` or `LOW` and a problem by a severity code. Those are clinical
 * gradings, and a model choosing which rows to list while attaching a grade to
 * each is one short step from ordering them by how bad they are, which
 * ADR-0004 rule 3 forbids outright. The portal's health-record screen shows the
 * grading with the practice's own plain label beside it; every citation from
 * here opens that screen, so the information is one tap away by a path that
 * does not run through a model.
 *
 * **No free text from the chart.** Clinician notes on a row are not projected -
 * not the dose line on a medicine, not the recorded reaction on an allergy. A
 * patient may read both in the portal; routing them through a model turns
 * clinician-authored prose into model-authored prose the first time it is
 * paraphrased, and the reader cannot tell which one they got.
 *
 * The rule was written here first and then broken by the implementation, which
 * projected both. Two things made that worse than an ordinary miss. The agent
 * loop appends this tool's complete output to the model conversation, so on a
 * remote endpoint the prose left the deployment as well as the practice. And
 * both fields are free text somebody else composed - a member of staff, or a
 * document imported from another organisation - so a hostile sentence in an
 * allergy reaction or a dose line arrived in the model's context as instructions
 * it had no way to tell from the surrounding retrieval.
 *
 * The fields are absent from the row schemas rather than merely absent from the
 * projection, so the free text is dropped at the parse and cannot be reinstated
 * by an edit to the mapping alone.
 *
 * **No results.** Explaining what a measured value means is interpretation
 * rather than retrieval, and ADR-0005 records patient-facing result
 * interpretation as out of scope. Retrieval of a result row is arguably not
 * interpretation, but the argument is close enough that this tool does not have
 * to win it.
 */

const MAX_ROWS = 40;

/**
 * The parts of the record, named the way a patient would name them.
 *
 * `medicines` rather than medications and `vaccinations` rather than
 * immunisations: the enum is what the model is shown and what appears in the
 * step label, so it is written in the reader's vocabulary and not in the
 * schema's.
 */
const PARTS = ['conditions', 'medicines', 'allergies', 'vaccinations'] as const;

type Part = (typeof PARTS)[number];

const inputSchema = z.strictObject({
  part: z.enum(PARTS),
});

/**
 * Note what no branch below sends: a patient identifier. The API narrows every
 * repository it hands a portal request to the chart on the token, so the
 * scoping is done by middleware that the browser path already exercises. A
 * filter added here would be a second implementation of the same rule, and the
 * second one is always the one that goes wrong.
 */
const PATHS: Readonly<Record<Part, string>> = {
  conditions: '/bff/v0/problems',
  medicines: '/bff/v0/medications/statements',
  allergies: '/bff/v0/allergies',
  vaccinations: '/bff/v0/immunisations',
};

const conditionRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  display: z.string(),
  clinicalStatus: z.string(),
  recordedAt: z.string(),
});

/**
 * `sigText` and `reactionText` are deliberately absent from these two schemas.
 *
 * Zod strips what it is not told about, so the chart's free text is dropped at
 * the parse rather than merely left out of the projection below - which means it
 * cannot be reinstated by a later edit to the mapping without somebody first
 * putting the field back here, next to this note.
 */
const medicineRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  display: z.string(),
  status: z.string(),
  effectiveStart: z.string().nullable(),
});

const allergyRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  substanceDisplay: z.string(),
  clinicalStatus: z.string(),
  recordedAt: z.string(),
});

const vaccinationRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  display: z.string(),
  administeredAt: z.string(),
});

export const recordList = defineTool({
  id: 'record.list',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['encounter.read'],
  surfaces: ['patient'],
  summary:
    'Lists one part of your own health record: conditions, medicines, allergies or vaccinations.',
  activityLabel: 'Reading your health record',
  maxResultRows: MAX_ROWS,
  compartmentBound: true,
  input: inputSchema,
  output: ownedRetrievalSchema,

  async execute(input, context) {
    /* Before the request, not after it: a turn with no chart bound never
       reaches the API at all, so there is no read to un-read. */
    assertChartBound(context, 'record.list');
    const body = await read(context, PATHS[input.part]);

    if (input.part === 'conditions') {
      const page = parseOwnedPage('record.list', conditionRowSchema, body);
      return ownedRetrieval(
        'record.list',
        'conditions',
        page.total,
        page.data.map((row): OwnedRecord => ({
          patientId: row.patientId,
          type: 'Condition',
          id: row.id,
          label: row.display,
          fields: [
            { name: 'Status', value: plainStatus(row.clinicalStatus) },
            { name: 'Written down on', value: dayOf(row.recordedAt) },
          ],
          source: { resourceType: 'Condition', resourceId: row.id, field: 'display' },
        })),
        MAX_ROWS
      );
    }

    if (input.part === 'medicines') {
      const page = parseOwnedPage('record.list', medicineRowSchema, body);
      return ownedRetrieval(
        'record.list',
        'medicines',
        page.total,
        page.data.map((row): OwnedRecord => ({
          patientId: row.patientId,
          type: 'Medicine',
          id: row.id,
          label: row.display,
          fields: [
            /* The dose line is NOT here. It is the practice's own words and the
                 one field a reader acts on, which is exactly why it must not
                 pass through a model: the loop appends this tool's whole output
                 to the conversation, so "copied across unchanged" describes the
                 projection and not what happens afterwards. The citation opens
                 the portal screen that shows it, one tap away by a path with no
                 model in it. */
            { name: 'Status', value: plainStatus(row.status) },
            ...(row.effectiveStart === null
              ? []
              : [{ name: 'Started on', value: dayOf(row.effectiveStart) }]),
          ],
          source: { resourceType: 'Medicine', resourceId: row.id, field: 'display' },
        })),
        MAX_ROWS
      );
    }

    if (input.part === 'allergies') {
      const page = parseOwnedPage('record.list', allergyRowSchema, body);
      return ownedRetrieval(
        'record.list',
        'allergies',
        page.total,
        page.data.map((row): OwnedRecord => ({
          patientId: row.patientId,
          type: 'Allergy',
          id: row.id,
          label: row.substanceDisplay,
          fields: [
            /* The recorded reaction is not projected either, and for a second
                 reason on top of the first: it is free text a member of staff or
                 an inbound document import wrote, so forwarding it verbatim into
                 the conversation is a prompt-injection path into a
                 patient-facing answer. */
            { name: 'Status', value: plainStatus(row.clinicalStatus) },
            { name: 'Written down on', value: dayOf(row.recordedAt) },
          ],
          source: { resourceType: 'Allergy', resourceId: row.id, field: 'substanceDisplay' },
        })),
        MAX_ROWS
      );
    }

    const page = parseOwnedPage('record.list', vaccinationRowSchema, body);
    return ownedRetrieval(
      'record.list',
      'vaccinations',
      page.total,
      page.data.map((row): OwnedRecord => ({
        patientId: row.patientId,
        type: 'Vaccination',
        id: row.id,
        label: row.display,
        fields: [{ name: 'Given on', value: dayOf(row.administeredAt) }],
        source: { resourceType: 'Vaccination', resourceId: row.id, field: 'display' },
      })),
      MAX_ROWS
    );
  },
});

/** One page of a collection, asked for by path alone. No filter, no identifier. */
function read(context: ToolContext, path: string): Promise<unknown> {
  return context.api.call({ method: 'GET', path, query: { pageSize: MAX_ROWS } }, context);
}

export { PARTS as RECORD_PARTS };

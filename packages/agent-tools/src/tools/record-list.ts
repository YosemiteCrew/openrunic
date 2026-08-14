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
 * **No free text from the chart.** Clinician notes on a row are not projected.
 * A patient may read them in the portal; routing them through a model turns
 * clinician-authored prose into model-authored prose the first time it is
 * paraphrased, and the reader cannot tell which one they got.
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

const medicineRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  display: z.string(),
  sigText: z.string().nullable(),
  status: z.string(),
  effectiveStart: z.string().nullable(),
});

const allergyRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  substanceDisplay: z.string(),
  reactionText: z.string().nullable(),
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
            /* The dose line is the practice's own words, copied across
                 unchanged. It is the one field here a reader acts on, so it is
                 never reworded. */
            ...(row.sigText === null ? [] : [{ name: 'How to take it', value: row.sigText }]),
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
            ...(row.reactionText === null
              ? []
              : [{ name: 'What happened', value: row.reactionText }]),
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

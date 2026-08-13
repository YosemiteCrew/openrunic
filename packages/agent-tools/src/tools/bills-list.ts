import { z } from 'zod';

import { defineTool } from '../registry.js';

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
 * Patient tool 3. Lists the reader's own statements and what is left to pay.
 *
 * "How much do I owe, and what for?" is a question people are afraid to ask a
 * receptionist, and it has no clinical content at all: no grading, no
 * interpretation, nothing that could be mistaken for advice. On a surface whose
 * whole design problem is that there is no clinician between the reader and the
 * answer, a purely financial capability is the easiest one to be sure of.
 *
 * It reads. Paying stays on the portal's own screen, where the amount, the
 * currency and the card are shown together by code that no model has touched.
 */

const MAX_ROWS = 12;

const inputSchema = z.strictObject({
  /** `unpaid` is the question people actually ask; `all` is the statement history. */
  which: z.enum(['unpaid', 'all']),
});

const statementRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  status: z.string(),
  balanceCents: z.number(),
  generatedAt: z.string(),
  paidAt: z.string().nullable(),
});

export const billsList = defineTool({
  id: 'bills.list',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['payment.read'],
  surfaces: ['patient'],
  summary: 'Lists your own bills and what is still to pay on each one.',
  activityLabel: 'Reading your bills',
  maxResultRows: MAX_ROWS,
  compartmentBound: true,
  input: inputSchema,
  output: ownedRetrievalSchema,

  async execute(input, context) {
    assertChartBound(context, 'bills.list');

    const body = await context.api.call(
      {
        method: 'GET',
        path: '/bff/v0/statements',
        query: {
          pageSize: MAX_ROWS,
          sort: 'generatedAt',
          order: 'desc',
          /* Asking the API to filter beats filtering the page here: a filter
             applied after paging would answer "you have no unpaid bills" from a
             page that simply did not reach them. */
          ...(input.which === 'unpaid' ? { status: 'SENT' } : {}),
        },
      },
      context
    );

    const page = parseOwnedPage('bills.list', statementRowSchema, body);

    return ownedRetrieval(
      'bills.list',
      input.which,
      page.total,
      page.data.map((row): OwnedRecord => ({
        patientId: row.patientId,
        type: 'Bill',
        id: row.id,
        label: `Bill dated ${dayOf(row.generatedAt)}`,
        fields: [
          { name: 'Still to pay', value: amountOf(row.balanceCents) },
          { name: 'Status', value: plainStatus(row.status) },
          ...(row.paidAt === null ? [] : [{ name: 'Paid on', value: dayOf(row.paidAt) }]),
        ],
        source: { resourceType: 'Bill', resourceId: row.id, field: 'balanceCents' },
      })),
      MAX_ROWS
    );
  },
});

/**
 * The balance as a figure, with no currency symbol on it.
 *
 * The stored statement carries minor units and no currency code, so a symbol
 * here would be one this code invented. The portal's bills screen holds the
 * practice's currency and renders it beside the same figure; a citation from
 * this tool opens exactly that screen. Naming an amount without a currency is a
 * gap, and it is a smaller one than naming the wrong currency.
 */
function amountOf(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

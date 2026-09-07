import { describe, expect, it } from 'vitest';

import { createMockClient } from '@/lib/api/mock/client';
import { MOCK_CHARTS } from '@/lib/api/mock/chart';
import { MEDICATION_STATUS_LABELS } from '@/components/chart/labels';
import type { MedicationStatus } from '@/lib/api/chart/types';

/**
 * The demo build's `medicationStatements.list`, against the contract the live
 * route answers.
 *
 * The chart screen reads through this door in fixture mode and through
 * `apps/api` in live mode, so a query this one accepts and drops is a screen
 * that renders correctly in both and disagrees with itself. Every case here is
 * a difference that was real: the door returned an empty page for a query with
 * no `patientId`, ignored `encounterId`, `status`, `sort` and `order`, and put
 * a date with no time into three fields the live DTO serialises as instants.
 */

const withMedications = MOCK_CHARTS.filter((chart) => chart.medications.length > 0);

describe('the medication statement mock', () => {
  it('lists every accessible statement when no patient is named', async () => {
    // The live route lists what the principal can see. An empty page here says
    // this deployment records no medications at all.
    const page = await createMockClient().medicationStatements.list({ pageSize: 200 });

    const expected = withMedications.reduce((n, chart) => n + chart.medications.length, 0);
    expect(expected).toBeGreaterThan(0);
    expect(page.data).toHaveLength(expected);
    expect(new Set(page.data.map((row) => row.patientId)).size).toBe(withMedications.length);
  });

  it('narrows to one patient when one is named', async () => {
    const chart = withMedications[0];
    expect(chart).toBeDefined();
    if (chart === undefined) return;

    const page = await createMockClient().medicationStatements.list({
      patientId: chart.patientId,
      pageSize: 200,
    });

    expect(page.data).toHaveLength(chart.medications.length);
    expect(page.data.every((row) => row.patientId === chart.patientId)).toBe(true);
  });

  it('applies the status filter rather than accepting and dropping it', async () => {
    const client = createMockClient();
    const all = await client.medicationStatements.list({ pageSize: 200 });
    const active = await client.medicationStatements.list({ status: 'ACTIVE', pageSize: 200 });

    expect(all.data.length).toBeGreaterThan(active.data.length);
    expect(active.data.every((row) => row.status === 'ACTIVE')).toBe(true);
  });

  /**
   * Every fixture statement carries `encounterId: null`, so a query naming one
   * must come back empty. Asserted because the parameter used to be accepted
   * and dropped, which answered the whole list instead.
   */
  it('applies the encounter filter rather than accepting and dropping it', async () => {
    const page = await createMockClient().medicationStatements.list({
      encounterId: '019f0000-0000-7000-8000-0000000000ff',
      pageSize: 200,
    });

    expect(page.data).toEqual([]);
  });

  /**
   * `readMedications` in `chart/live.ts` sends exactly this on every call. When
   * the door ignored it, demo mode rendered fixture order and live mode
   * rendered newest-first - the same screen disagreeing with itself about which
   * medication is at the top.
   */
  it('honours the sort and order readMedications actually sends', async () => {
    const page = await createMockClient().medicationStatements.list({
      sort: 'reportedAt',
      order: 'desc',
      pageSize: 200,
    });

    const reported = page.data.map((row) => row.reportedAt);
    expect(reported.length).toBeGreaterThan(1);
    expect(reported).toEqual([...reported].sort().reverse());

    const ascending = await createMockClient().medicationStatements.list({
      sort: 'reportedAt',
      order: 'asc',
      pageSize: 200,
    });
    expect(ascending.data.map((row) => row.reportedAt)).toEqual([...reported].reverse());
  });

  /**
   * The live DTO serialises all three with `toISOString()`. These used to be
   * `startedOn ?? MOCK_NOW`, so a date-only `2022-02-18` reached a consumer
   * formatting an instant, which renders midnight UTC or the day before it.
   */
  it('returns instants for reportedAt, createdAt and updatedAt', async () => {
    const page = await createMockClient().medicationStatements.list({ pageSize: 200 });

    const dated = page.data.filter((row) => row.effectiveStart !== null);
    expect(dated.length).toBeGreaterThan(0);

    for (const row of page.data) {
      for (const value of [row.reportedAt, row.createdAt, row.updatedAt]) {
        expect(value).toBe(new Date(value).toISOString());
        expect(value).not.toBe(row.effectiveStart);
      }
    }
  });
});

/**
 * THE COUNT IN `chart/types.ts`, PINNED.
 *
 * That docblock argues the union exists because an active/discontinued pair
 * gets some states wrong, and it names how many. It said FOUR and the answer is
 * FIVE - it omitted `UNKNOWN`, which is the strongest example it had, since a
 * pair has to answer "nobody knows" as one or the other and is wrong either
 * way. Codex found it; nothing in the suite could have.
 *
 * A number in prose beside a union is the cheapest place to put a claim nothing
 * checks, so it is checked here: add a ninth state and this goes red at the
 * count the sentence quotes, rather than the sentence quietly becoming false.
 */
describe('the medication status partition the chart/types.ts docblock describes', () => {
  it('leaves exactly five states outside the old active/discontinued pair', () => {
    const all: MedicationStatus[] = [
      'ACTIVE',
      'COMPLETED',
      'ENTERED_IN_ERROR',
      'INTENDED',
      'NOT_TAKEN',
      'ON_HOLD',
      'STOPPED',
      'UNKNOWN',
    ];
    // Exhaustive by construction: `Record<MedicationStatus, ...>` in
    // `components/chart/labels.ts` fails to compile when a member is added, and
    // this list is checked against its keys rather than trusted.
    expect([...all].sort()).toEqual(Object.keys(MEDICATION_STATUS_LABELS).sort());

    const pair: MedicationStatus[] = ['ACTIVE', 'STOPPED', 'COMPLETED'];
    expect(all.filter((status) => !pair.includes(status))).toHaveLength(5);
  });
});

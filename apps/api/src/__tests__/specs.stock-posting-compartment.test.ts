import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';
import { stockPostingSpec, type StockPostingListQuery } from '../repositories/specs/inventory.js';

import { DEMO_FACILITY_A, FIXED_NOW, testId } from './support.js';

/**
 * What a patient-scoped token may see of the stock ledger.
 *
 * `stockPostingSpec` was `compartment: 'closed'`, refusing such a principal the
 * whole table, and serving `MedicationDispense` changed it to an equality on
 * `patientId`. That is a widening of a security boundary, and the claim written
 * next to it is that the operational postings stay out because they carry no
 * chart. This file is that claim, checked.
 *
 * It matters because the failure is silent and the wrong way round: a receipt
 * or a cycle count reaching a patient's app leaks what a practice stocks, how
 * much of it, and when it counted, to somebody entitled to none of it.
 */

const TENANT = testId(1);
const PATIENT = testId(200);
const OTHER_PATIENT = testId(201);

function posting(overrides: Partial<ScopedRow<'StockPosting'>> = {}): ScopedRow<'StockPosting'> {
  return {
    id: testId(300),
    tenantId: TENANT,
    kind: 'DISPENSE',
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT,
    encounterId: null,
    prescriptionId: null,
    immunizationId: null,
    occurredOn: FIXED_NOW,
    postedById: testId(400),
    witnessedById: null,
    reference: null,
    note: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function query(overrides: Partial<StockPostingListQuery> = {}): StockPostingListQuery {
  return { page: 1, pageSize: 25, sort: 'occurredOn', order: 'desc', ...overrides };
}

describe('the compartment rule', () => {
  it('narrows on the chart column rather than refusing the table', () => {
    expect(stockPostingSpec.compartment).toEqual({ column: 'patientId' });
  });

  it('is the column the postings that belong to a chart actually carry', () => {
    /* A rule naming a column the model does not have would compile and then
       narrow on undefined, which matches nothing and looks like an empty
       ledger rather than a misconfiguration. */
    expect(Object.keys(posting())).toContain('patientId');
  });
});

describe('the patient filter, which the compartment leans on', () => {
  const OPERATIONAL: readonly ScopedRow<'StockPosting'>[] = [
    posting({ id: testId(301), kind: 'RECEIPT', patientId: null }),
    posting({ id: testId(302), kind: 'COUNT', patientId: null }),
    posting({ id: testId(303), kind: 'WASTAGE', patientId: null }),
    posting({ id: testId(304), kind: 'CORRECTION', patientId: null }),
  ];

  it('excludes every posting that belongs to no chart', () => {
    /*
     * The whole safety of the widening. `patientId` is null on a receipt, a
     * count, a wastage and a correction, and an equality never matches null in
     * either storage implementation, so none of them is reachable by a token
     * bound to a patient.
     */
    for (const row of OPERATIONAL) {
      expect(
        stockPostingSpec.matches(row, query({ patientId: PATIENT })),
        `${row.kind} must not match a chart`
      ).toBe(false);
    }
  });

  it('excludes another patient dispense', () => {
    expect(
      stockPostingSpec.matches(posting({ patientId: OTHER_PATIENT }), query({ patientId: PATIENT }))
    ).toBe(false);
  });

  it('includes the chart it was asked for', () => {
    /* The control. Without it every assertion above passes for a filter that
       matches nothing at all. */
    expect(stockPostingSpec.matches(posting(), query({ patientId: PATIENT }))).toBe(true);
  });

  it('leaves the operational postings visible when no chart is asked for', () => {
    /* Staff reading the ledger are not compartment-restricted, and a receipt
       has to stay readable by them. */
    for (const row of OPERATIONAL) {
      expect(stockPostingSpec.matches(row, query())).toBe(true);
    }
  });
});

describe('matches and where agree about the chart', () => {
  it('describes the same set through both storage paths', () => {
    const rows = [
      posting(),
      posting({ id: testId(305), patientId: OTHER_PATIENT }),
      posting({ id: testId(306), patientId: null, kind: 'RECEIPT' }),
    ];

    for (const q of [query(), query({ patientId: PATIENT }), query({ kind: 'DISPENSE' })]) {
      const where = stockPostingSpec.where(q) as Record<string, unknown>;
      for (const row of rows) {
        const byWhere = Object.entries(where).every(
          ([column, value]) => (row as unknown as Record<string, unknown>)[column] === value
        );

        expect(stockPostingSpec.matches(row, q), `${row.id} under ${JSON.stringify(q)}`).toBe(
          byWhere
        );
      }
    }
  });
});

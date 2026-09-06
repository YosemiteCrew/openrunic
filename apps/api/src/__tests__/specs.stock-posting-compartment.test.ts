import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';
import { stockPostingSpec, type StockPostingListQuery } from '../repositories/specs/inventory.js';

import { matchesWhere } from './fake-port.js';
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

describe('the charted filter, which the clinical route leans on', () => {
  /*
   * A dispense that belongs to no chart.
   *
   * `kind` does not imply a chart: `patientId` is nullable on every posting,
   * and a dose drawn against ward stock rather than against a person is a
   * DISPENSE with a null one. `MedicationDispense` narrowed its read by id on
   * `kind === 'DISPENSE' && patientId !== null` and its search on `kind` alone,
   * so this row answered 404 through one door and appeared in the bundle
   * through the other. `charted` is what lets the search say the same thing the
   * read already said.
   */
  const WARD_STOCK = posting({ id: testId(307), kind: 'DISPENSE', patientId: null });

  it('excludes a dispense that belongs to no chart', () => {
    expect(stockPostingSpec.matches(WARD_STOCK, query({ charted: true }))).toBe(false);
  });

  it('includes a dispense that belongs to one', () => {
    /* The control. Without it the assertion above passes for a filter that
       selects nothing at all. */
    expect(stockPostingSpec.matches(posting(), query({ charted: true }))).toBe(true);
  });

  it('selects exactly the uncharted postings when asked the other way', () => {
    expect(stockPostingSpec.matches(WARD_STOCK, query({ charted: false }))).toBe(true);
    expect(stockPostingSpec.matches(posting(), query({ charted: false }))).toBe(false);
  });

  it('leaves every posting visible when it is not asked at all', () => {
    /* Staff reading the ledger ask for neither, and a receipt has to stay
       readable by them. An absent filter must not behave like `charted: true`. */
    expect(stockPostingSpec.matches(WARD_STOCK, query())).toBe(true);
    expect(stockPostingSpec.matches(posting(), query())).toBe(true);
  });

  it('does not let a named chart and the charted filter overwrite each other', () => {
    /*
     * The failure this filter would otherwise have introduced, asserted at the
     * emitted object rather than only through the port-agreement suite.
     *
     * `patientId` and `charted` both write the `patientId` column. Spread side
     * by side into one literal they are the same key twice, the later wins, and
     * a search for one person's dispenses silently becomes a search for
     * everybody's - the exact shape the promotion review found. Under `AND`
     * both survive, so the emitted filter still names the chart it was given.
     */
    const emitted = stockPostingSpec.where(query({ patientId: PATIENT, charted: true }));

    expect(JSON.stringify(emitted)).toContain(PATIENT);
    expect(
      stockPostingSpec.matches(
        posting({ patientId: OTHER_PATIENT }),
        query({ patientId: PATIENT, charted: true })
      )
    ).toBe(false);
  });
});

describe('matches and where agree about the chart', () => {
  it('describes the same set through both storage paths', () => {
    const rows = [
      posting(),
      posting({ id: testId(305), patientId: OTHER_PATIENT }),
      posting({ id: testId(306), patientId: null, kind: 'RECEIPT' }),
      posting({ id: testId(307), patientId: null, kind: 'DISPENSE' }),
    ];

    /*
     * `matchesWhere` rather than a scalar comparison, because the chart filters
     * are no longer all scalars: `charted` emits `{ not: null }` and composes
     * with `patientId` under an `AND`, neither of which a `row[column] ===
     * value` loop can read. It is the same interpreter the fake Prisma port
     * answers with, so the two sides compared here are the two sides in
     * production.
     */
    const queries = [
      query(),
      query({ patientId: PATIENT }),
      query({ kind: 'DISPENSE' }),
      query({ charted: true }),
      query({ charted: false }),
      query({ kind: 'DISPENSE', charted: true }),
      query({ patientId: PATIENT, charted: true }),
    ];

    for (const q of queries) {
      const where = stockPostingSpec.where(q) as Record<string, unknown>;
      for (const row of rows) {
        expect(stockPostingSpec.matches(row, q), `${row.id} under ${JSON.stringify(q)}`).toBe(
          matchesWhere(row as unknown as Record<string, unknown>, where)
        );
      }
    }
  });
});

import { describe, expect, it } from 'vitest';

import type { RowContext } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import { prescriptionFillSpec } from '../repositories/specs/clinical.js';

import { DEMO_TENANT_A, FIXED_NOW, storageColumns, testId } from './support.js';

const PATIENT = testId(1);
const OTHER_PATIENT = testId(2);
const PRESCRIPTION = testId(3);
const OTHER_PRESCRIPTION = testId(4);

const CONTEXT: RowContext = {
  tenantId: DEMO_TENANT_A,
  now: FIXED_NOW,
  nextId: () => testId(5),
};

function fill(
  overrides: Partial<ScopedRow<'PrescriptionFill'>> = {}
): ScopedRow<'PrescriptionFill'> {
  return {
    ...storageColumns(testId(6)),
    patientId: PATIENT,
    prescriptionId: PRESCRIPTION,
    stockPostingId: testId(7),
    filledOn: new Date('2026-08-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('prescriptionFillSpec', () => {
  it('refuses standalone creates and amendments', () => {
    expect(() => prescriptionFillSpec.newRow(undefined as never, CONTEXT)).toThrow(
      'only with its stock posting'
    );
    expect(() => prescriptionFillSpec.patchData({}, fill(), CONTEXT)).toThrow('append-only');
  });

  it('filters one chart and prescription without a facility predicate', () => {
    const query = {
      page: 1,
      pageSize: 25,
      sort: 'filledOn' as const,
      order: 'asc' as const,
      patientId: PATIENT,
      prescriptionId: PRESCRIPTION,
    };

    expect(prescriptionFillSpec.matches(fill(), query)).toBe(true);
    expect(prescriptionFillSpec.matches(fill({ patientId: OTHER_PATIENT }), query)).toBe(false);
    expect(prescriptionFillSpec.matches(fill({ prescriptionId: OTHER_PRESCRIPTION }), query)).toBe(
      false
    );
    expect(prescriptionFillSpec.where(query)).toEqual({
      patientId: PATIENT,
      prescriptionId: PRESCRIPTION,
    });
    expect('facilityColumn' in prescriptionFillSpec).toBe(false);
  });

  it('supports an unfiltered count and both stable orderings', () => {
    const row = fill({
      filledOn: new Date('2026-08-18T00:00:00.000Z'),
      createdAt: new Date('2026-08-19T00:00:00.000Z'),
    });
    const base = { page: 1, pageSize: 25, order: 'desc' as const };

    expect(prescriptionFillSpec.matches(row, { ...base, sort: 'filledOn' })).toBe(true);
    expect(prescriptionFillSpec.where({ ...base, sort: 'filledOn' })).toEqual({});
    expect(prescriptionFillSpec.sortValue(row, 'filledOn')).toBe(
      new Date('2026-08-18T00:00:00.000Z').getTime()
    );
    expect(prescriptionFillSpec.sortValue(row, 'createdAt')).toBe(
      new Date('2026-08-19T00:00:00.000Z').getTime()
    );
    expect(prescriptionFillSpec.orderBy({ ...base, sort: 'filledOn' })).toEqual([
      { filledOn: 'desc' },
      { id: 'asc' },
    ]);
    expect(prescriptionFillSpec.orderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { FormPromotionError, promoteSubmission } from './forms.js';
import type { PromotableSubmission, PromotionManifest } from './forms.js';

/** Sequential ids so assertions do not depend on randomness. */
function counterIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `01920000-0000-7000-8000-${String(next).padStart(12, '0')}`;
  };
}

const manifest: PromotionManifest = {
  definitionKey: 'intake-vitals',
  definitionVersion: 3,
  fields: [
    { fieldKey: 'painScore', type: 'number' },
    { fieldKey: 'smokingStatus', type: 'code', codeSystem: 'http://snomed.info/sct' },
    { fieldKey: 'weight', type: 'quantity', unit: 'kg' },
    { fieldKey: 'lastPeriod', type: 'date' },
    { fieldKey: 'consentsToSms', type: 'boolean' },
    { fieldKey: 'chiefComplaint', type: 'text' },
    { fieldKey: 'medicationsTried', type: 'text', repeating: true },
  ],
};

const submission: PromotableSubmission = {
  id: '01920000-0000-7000-8000-00000000aaaa',
  tenantId: '01920000-0000-7000-8000-00000000bbbb',
  formDefinitionId: '01920000-0000-7000-8000-00000000cccc',
  patientId: '01920000-0000-7000-8000-00000000dddd',
  effectiveAt: new Date('2026-08-13T09:30:00.000Z'),
  values: {},
};

function promote(values: Record<string, unknown>) {
  return promoteSubmission(manifest, { ...submission, values }, { generateId: counterIds() });
}

describe('promoteSubmission', () => {
  it('promotes only fields listed in the manifest', () => {
    const rows = promote({ painScore: 4, notPromoted: 'ignored' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fieldKey).toBe('painScore');
  });

  it('copies the submission identity and effective instant onto every row', () => {
    const rows = promote({ painScore: 4, consentsToSms: true });
    for (const row of rows) {
      expect(row).toMatchObject({
        tenantId: submission.tenantId,
        formSubmissionId: submission.id,
        formDefinitionId: submission.formDefinitionId,
        patientId: submission.patientId,
        definitionKey: 'intake-vitals',
        definitionVersion: 3,
        effectiveAt: submission.effectiveAt,
      });
    }
  });

  it('returns rows in manifest order', () => {
    const rows = promote({ chiefComplaint: 'cough', painScore: 2, consentsToSms: false });
    expect(rows.map((row) => row.fieldKey)).toStrictEqual([
      'painScore',
      'consentsToSms',
      'chiefComplaint',
    ]);
  });

  it('is pure: the same inputs produce the same rows', () => {
    const values = { painScore: 4, weight: 71.2, chiefComplaint: 'cough' };
    expect(promote(values)).toStrictEqual(promote(values));
  });

  it('populates exactly one typed column per row', () => {
    const rows = promote({
      painScore: 4,
      smokingStatus: '266919005',
      weight: 71.2,
      lastPeriod: '2026-07-30',
      consentsToSms: true,
      chiefComplaint: 'persistent cough',
    });
    const populated = (row: (typeof rows)[number]) =>
      [
        row.valueText,
        row.valueNumber,
        row.valueDate,
        row.valueBoolean,
        row.valueCode,
        row.valueQuantity,
      ].filter((value) => value !== null).length;
    expect(rows.map(populated)).toStrictEqual([1, 1, 1, 1, 1, 1]);
  });

  it('routes each type to its own column', () => {
    const [pain, smoking, weight, period, consent, complaint] = promote({
      painScore: 4,
      smokingStatus: '266919005',
      weight: 71.2,
      lastPeriod: '2026-07-30',
      consentsToSms: true,
      chiefComplaint: 'persistent cough',
    });
    expect(pain?.valueNumber).toBe(4);
    expect(smoking).toMatchObject({
      valueCode: '266919005',
      valueCodeSystem: 'http://snomed.info/sct',
    });
    expect(weight).toMatchObject({ valueQuantity: 71.2, valueUnit: 'kg' });
    expect(period?.valueDate).toStrictEqual(new Date('2026-07-30'));
    expect(consent?.valueBoolean).toBe(true);
    expect(complaint?.valueText).toBe('persistent cough');
  });

  it('accepts a coded answer that carries its own system', () => {
    const [row] = promote({
      smokingStatus: { code: 'LA18976-3', system: 'http://loinc.org' },
    });
    expect(row).toMatchObject({ valueCode: 'LA18976-3', valueCodeSystem: 'http://loinc.org' });
  });

  it('accepts a quantity answer that carries its own unit', () => {
    const [row] = promote({ weight: { value: 157, unit: '[lb_av]' } });
    expect(row).toMatchObject({ valueQuantity: 157, valueUnit: '[lb_av]' });
  });

  it('accepts a Date instance for a date field', () => {
    const date = new Date('2026-07-30T00:00:00.000Z');
    const [row] = promote({ lastPeriod: date });
    expect(row?.valueDate).toStrictEqual(date);
  });

  it('keeps false and zero, which are answers, not blanks', () => {
    const rows = promote({ consentsToSms: false, painScore: 0 });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.fieldKey === 'consentsToSms')?.valueBoolean).toBe(false);
    expect(rows.find((row) => row.fieldKey === 'painScore')?.valueNumber).toBe(0);
  });

  it.each([
    ['missing', {}],
    ['null', { painScore: null }],
    ['undefined', { painScore: undefined }],
    ['empty string', { chiefComplaint: '' }],
  ])('emits no row for a %s answer', (_label, values) => {
    expect(promote(values)).toStrictEqual([]);
  });

  it('emits one row per repetition, indexed from zero', () => {
    const rows = promote({ medicationsTried: ['ibuprofen', 'paracetamol'] });
    expect(rows.map((row) => [row.repeatIndex, row.valueText])).toStrictEqual([
      [0, 'ibuprofen'],
      [1, 'paracetamol'],
    ]);
  });

  it('keeps repeat indices stable when a repetition is blank', () => {
    const rows = promote({ medicationsTried: ['ibuprofen', '', 'paracetamol'] });
    expect(rows.map((row) => [row.repeatIndex, row.valueText])).toStrictEqual([
      [0, 'ibuprofen'],
      [2, 'paracetamol'],
    ]);
  });

  it('accepts a bare value for a repeating field', () => {
    const rows = promote({ medicationsTried: 'ibuprofen' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repeatIndex).toBe(0);
  });

  it('gives every row a distinct id and repeatIndex 0 by default', () => {
    const rows = promote({ painScore: 4, chiefComplaint: 'cough' });
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.every((row) => row.repeatIndex === 0)).toBe(true);
  });

  it('rejects a list for a field that is not marked repeating', () => {
    expect(() => promote({ chiefComplaint: ['a', 'b'] })).toThrow(FormPromotionError);
  });

  it('rejects a duplicated field in the manifest', () => {
    const duplicated: PromotionManifest = {
      ...manifest,
      fields: [
        { fieldKey: 'painScore', type: 'number' },
        { fieldKey: 'painScore', type: 'text' },
      ],
    };
    expect(() =>
      promoteSubmission(duplicated, { ...submission, values: { painScore: 1 } })
    ).toThrow(/appears twice/);
  });

  it.each([
    ['a string for a number field', { painScore: 'four' }],
    ['NaN for a number field', { painScore: Number.NaN }],
    ['Infinity for a number field', { painScore: Number.POSITIVE_INFINITY }],
    ['a number for a text field', { chiefComplaint: 42 }],
    ['a string for a boolean field', { consentsToSms: 'yes' }],
    ['an unparsable date', { lastPeriod: 'last tuesday' }],
    ['an object without a code', { smokingStatus: { display: 'never smoked' } }],
    ['a non-string coded system', { smokingStatus: { code: 'x', system: 7 } }],
    ['a quantity without a numeric value', { weight: { value: 'heavy', unit: 'kg' } }],
    ['a non-string quantity unit', { weight: { value: 71, unit: 12 } }],
    ['a boolean for a quantity field', { weight: true }],
  ])('rejects %s rather than dropping it silently', (_label, values) => {
    expect(() => promote(values)).toThrow(FormPromotionError);
  });

  it('names the offending field and repetition in the error', () => {
    expect(() => promote({ medicationsTried: ['ibuprofen', 5] })).toThrow(/medicationsTried\[1\]/);
  });
});

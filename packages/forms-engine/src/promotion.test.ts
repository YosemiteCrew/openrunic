import { describe, expect, it } from 'vitest';

import type { CompiledField } from './compiled.js';
import type { FormValues } from './definition.js';
import type { PromotedValue } from './promotion.js';
import { isPromoted, promote, promotedFieldTypeFor, toPromotionManifest } from './promotion.js';
import { branchingForm, compileOrThrow, formOf, intakeForm } from './test-support/forms.js';

const intake = compileOrThrow(intakeForm);

function fieldFor(key: string): CompiledField {
  const field = intake.fields.find((candidate) => candidate.key === key);
  if (field === undefined) {
    throw new Error(`fixture has no field ${key}`);
  }
  return field;
}

function rowsFor(values: FormValues): readonly PromotedValue[] {
  const result = promote(intake, values);
  if (!result.ok) {
    throw new Error(`expected promotion to succeed, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const VALUE_SLOTS = [
  'valueText',
  'valueNumber',
  'valueDate',
  'valueBoolean',
  'valueCode',
  'valueQuantity',
] as const;

function populatedSlots(row: PromotedValue): string[] {
  return VALUE_SLOTS.filter((slot) => row[slot] !== null);
}

/**
 * The inverse of the projection: reads a promoted row back into the answer the
 * document holds. Written here rather than shipped, because a promoted row is a
 * lossy index of an answer (a coded display text is not indexed) and offering
 * an inverse in the API would invite somebody to rebuild a chart from it.
 */
function restore(field: CompiledField, row: PromotedValue): unknown {
  const source = field.field;
  switch (source.type) {
    case 'shortText':
    case 'longText':
    case 'singleSelect':
    case 'multiSelect':
      return row.valueText;
    case 'number':
      return source.unit === undefined ? row.valueNumber : row.valueQuantity;
    case 'scale':
      return row.valueNumber;
    case 'date':
      return row.valueDate?.toISOString().slice(0, 10);
    case 'datetime':
      return row.valueDate?.toISOString();
    case 'boolean':
      return row.valueBoolean;
    case 'codedValue':
      return { code: row.valueCode, system: row.valueCodeSystem };
    default:
      return undefined;
  }
}

/** Every promotable field in the fixture, with several answers each. */
const ANSWER_MATRIX: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ['preferred_name', ['Testina Patientsson', 'Q', 'a name with spaces']],
  ['weight', [0, 71.5, 400]],
  ['children', [0, 2, 20]],
  ['last_tetanus', ['2019-04-12', '2026-01-01']],
  ['symptom_onset', ['2026-08-01T09:30:00.000Z', '2026-12-31T23:59:59.000Z']],
  ['smoking', ['never', 'former', 'current']],
  ['symptoms', [['cough'], ['cough', 'fever'], ['cough', 'fever', 'breathless']]],
  ['pregnant', [true, false]],
  ['pain', [0, 7, 10]],
  [
    'primary_problem',
    [
      { code: 'E11.9', system: 'http://hl7.org/fhir/sid/icd-10-cm' },
      { code: 'J45.909', system: 'http://hl7.org/fhir/sid/icd-10-cm' },
    ],
  ],
  ['med_name', [['Cardiozine'], ['Cardiozine', 'Pulmovex']]],
  ['med_dose', [[500], [500, 250]]],
];

describe('toPromotionManifest', () => {
  it('emits exactly the shape the database package consumes', () => {
    expect(intake.promotionManifest).toStrictEqual({
      definitionKey: 'adult_intake',
      definitionVersion: 3,
      fields: [
        { fieldKey: 'preferred_name', type: 'text' },
        { fieldKey: 'weight', type: 'quantity', unit: 'kg' },
        { fieldKey: 'children', type: 'number' },
        { fieldKey: 'last_tetanus', type: 'date' },
        { fieldKey: 'symptom_onset', type: 'date' },
        { fieldKey: 'smoking', type: 'text' },
        { fieldKey: 'symptoms', type: 'text', repeating: true },
        { fieldKey: 'pregnant', type: 'boolean' },
        { fieldKey: 'pain', type: 'number' },
        {
          fieldKey: 'primary_problem',
          type: 'code',
          codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
        },
        { fieldKey: 'med_name', type: 'text', repeating: true },
        { fieldKey: 'med_dose', type: 'quantity', unit: 'mg', repeating: true },
      ],
    });
  });

  it('returns the same manifest the compiler cached', () => {
    expect(toPromotionManifest(intake)).toStrictEqual(intake.promotionManifest);
  });

  it('promotes nothing that nobody opted into', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'shortText', key: 'note', label: 'Note' },
        { type: 'boolean', key: 'flag', label: 'Flag' },
      ])
    );
    expect(compiled.promotionManifest.fields).toStrictEqual([]);
  });

  it('maps each catalogue type to its indexed column, or to none at all', () => {
    const typeOf = (key: string): string | undefined => promotedFieldTypeFor(fieldFor(key).field);
    expect(typeOf('preferred_name')).toBe('text');
    expect(typeOf('reason_for_visit')).toBe('text');
    expect(typeOf('weight')).toBe('quantity');
    expect(typeOf('children')).toBe('number');
    expect(typeOf('pain')).toBe('number');
    expect(typeOf('last_tetanus')).toBe('date');
    expect(typeOf('symptom_onset')).toBe('date');
    expect(typeOf('smoking')).toBe('text');
    expect(typeOf('symptoms')).toBe('text');
    expect(typeOf('pregnant')).toBe('boolean');
    expect(typeOf('primary_problem')).toBe('code');
    expect(typeOf('consent_signature')).toBeUndefined();
    expect(typeOf('insurance_card')).toBeUndefined();
    expect(typeOf('about_you')).toBeUndefined();
    expect(typeOf('intro')).toBeUndefined();
    expect(typeOf('medications')).toBeUndefined();
  });

  it('treats presentation fields and group containers as never promoted', () => {
    expect(isPromoted(fieldFor('about_you').field)).toBe(false);
    expect(isPromoted(fieldFor('intro').field)).toBe(false);
    expect(isPromoted(fieldFor('medications').field)).toBe(false);
    expect(isPromoted(fieldFor('reason_for_visit').field)).toBe(false);
    expect(isPromoted(fieldFor('preferred_name').field)).toBe(true);
  });
});

describe('promote round trips every promotable answer', () => {
  it.each(ANSWER_MATRIX.map(([key, answers]) => [key, answers] as const))(
    '%s survives the projection unchanged',
    (key, answers) => {
      const field = fieldFor(key);
      for (const answer of answers) {
        const rows = rowsFor({ [key]: answer });
        for (const row of rows) {
          expect(populatedSlots(row)).toHaveLength(1);
          expect(row.fieldKey).toBe(key);
        }
        if (Array.isArray(answer)) {
          expect(rows.map((row) => row.repeatIndex)).toStrictEqual(answer.map((_, index) => index));
          expect(rows.map((row) => restore(field, row))).toStrictEqual(answer);
          continue;
        }
        expect(rows).toHaveLength(1);
        expect(rows[0]?.repeatIndex).toBe(0);
        expect(restore(field, rows[0] as PromotedValue)).toStrictEqual(answer);
      }
    }
  );

  it('holds when every promotable field is answered at once', () => {
    const values: Record<string, unknown> = {};
    for (const [key, answers] of ANSWER_MATRIX) {
      values[key] = answers[0];
    }
    const rows = rowsFor(values);
    for (const row of rows) {
      const field = fieldFor(row.fieldKey);
      const stored = values[row.fieldKey];
      const expected = Array.isArray(stored) ? stored[row.repeatIndex] : stored;
      expect(restore(field, row)).toStrictEqual(expected);
    }
    // Twelve fields, two of which contribute one row per entry in their list.
    expect(rows).toHaveLength(12);
  });

  it('populates the companion columns only alongside their own value', () => {
    const rows = rowsFor({
      weight: 71.5,
      children: 2,
      primary_problem: { code: 'E11.9', system: 'http://hl7.org/fhir/sid/icd-10-cm' },
      smoking: 'never',
    });
    for (const row of rows) {
      expect(row.valueUnit === null).toBe(row.valueQuantity === null);
      expect(row.valueCodeSystem === null).toBe(row.valueCode === null);
    }
  });

  it('numbers repetitions from zero, one row per entry', () => {
    const rows = rowsFor({ med_name: ['Cardiozine', 'Pulmovex', 'Neurolyn'] });
    expect(rows.map((row) => [row.fieldKey, row.repeatIndex, row.valueText])).toStrictEqual([
      ['med_name', 0, 'Cardiozine'],
      ['med_name', 1, 'Pulmovex'],
      ['med_name', 2, 'Neurolyn'],
    ]);
  });
});

describe('promote edge cases', () => {
  it('produces no row for an unanswered field, so the table stays sparse', () => {
    expect(rowsFor({})).toStrictEqual([]);
    expect(rowsFor({ preferred_name: '', pain: null, symptoms: [] })).toStrictEqual([]);
  });

  it('skips a blank entry inside a repetition without shifting the others', () => {
    const rows = rowsFor({ med_name: ['Cardiozine', null, 'Neurolyn'] });
    expect(rows.map((row) => row.repeatIndex)).toStrictEqual([0, 2]);
  });

  it('accepts a bare code and inherits the field binding', () => {
    const rows = rowsFor({ primary_problem: 'E11.9' });
    expect(rows[0]).toMatchObject({
      valueCode: 'E11.9',
      valueCodeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
    });
  });

  it('accepts a coded answer that overrides the bound system', () => {
    const rows = rowsFor({
      primary_problem: { code: '73211009', system: 'http://snomed.info/sct' },
    });
    expect(rows[0]?.valueCodeSystem).toBe('http://snomed.info/sct');
  });

  it('accepts a quantity written as a value and unit pair', () => {
    const rows = rowsFor({ weight: { value: 71.5, unit: 'g' } });
    expect(rows[0]).toMatchObject({ valueQuantity: 71.5, valueUnit: 'g' });
  });

  it('accepts a Date object where a date string would do', () => {
    const rows = rowsFor({ last_tetanus: new Date('2019-04-12T00:00:00.000Z') });
    expect(rows[0]?.valueDate?.toISOString()).toBe('2019-04-12T00:00:00.000Z');
  });

  it('never promotes an answer the conditions have hidden', () => {
    const compiled = compileOrThrow({
      ...branchingForm,
      fields: branchingForm.fields.map((field) =>
        field.key === 'due_date_note' ? { ...field, promote: { searchable: true } } : field
      ),
    });
    const hidden = promote(compiled, { pregnant: false, due_date_note: 'Mid October' });
    expect(hidden.ok && hidden.value).toStrictEqual([]);

    const shown = promote(compiled, { pregnant: true, due_date_note: 'Mid October' });
    expect(shown.ok && shown.value).toHaveLength(1);
  });

  it('never promotes a hidden repetition', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'flag', label: 'Flag' },
        {
          type: 'repeatingGroup',
          key: 'group',
          label: 'Group',
          fields: [
            { type: 'boolean', key: 'row_flag', label: 'Row flag' },
            {
              type: 'shortText',
              key: 'row_note',
              label: 'Row note',
              promote: { searchable: true },
              conditions: [
                {
                  effect: 'show',
                  when: { kind: 'compare', field: 'row_flag', operator: 'equals', value: true },
                },
              ],
            },
          ],
        },
      ])
    );
    const result = promote(compiled, {
      row_flag: [true, false],
      row_note: ['kept', 'hidden'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.map((row) => row.valueText)).toStrictEqual(['kept']);
  });

  it('refuses an answer that is present but the wrong shape, rather than dropping it', () => {
    const cases: ReadonlyArray<readonly [FormValues, string]> = [
      [{ preferred_name: 7 }, 'preferred_name'],
      [{ children: 'two' }, 'children'],
      [{ pregnant: 'yes' }, 'pregnant'],
      [{ last_tetanus: 'not a date' }, 'last_tetanus'],
      [{ primary_problem: 12 }, 'primary_problem'],
      [{ weight: 'heavy' }, 'weight'],
      [{ children: Number.POSITIVE_INFINITY }, 'children'],
      [{ weight: { value: 'heavy' } }, 'weight'],
    ];
    for (const [values, fieldKey] of cases) {
      const result = promote(intake, values);
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.error[0]).toMatchObject({
        code: 'unpromotableValue',
        fieldKey,
        repeatIndex: 0,
      });
    }
  });

  it('refuses a list for a field the manifest does not mark as repeating', () => {
    const result = promote(intake, { pain: [1, 2] });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toStrictEqual([
      {
        code: 'unexpectedList',
        fieldKey: 'pain',
        message: 'Received a list for a field the manifest does not mark as repeating.',
      },
    ]);
  });

  it('reports the repetition a bad value came from', () => {
    const result = promote(intake, { med_dose: [500, 'a lot'] });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]).toMatchObject({ fieldKey: 'med_dose', repeatIndex: 1 });
  });
});

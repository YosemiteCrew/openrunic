import { describe, expect, it } from 'vitest';

import type { CompiledForm } from './compiled.js';
import { evaluateConditions, fieldStateFor } from './conditions.js';
import type { ConditionNode, FormValues } from './definition.js';
import {
  branchingForm,
  compileOrThrow,
  forwardReferenceForm,
  formOf,
  medicationGroupForm,
} from './test-support/forms.js';

/** Builds a one-condition form over a fixed answer field, for operator tests. */
function operatorForm(when: ConditionNode, answerField: 'value' | 'list' | 'coded' = 'value') {
  const source = {
    value: { type: 'shortText', key: 'value', label: 'Value' },
    list: {
      type: 'multiSelect',
      key: 'value',
      label: 'Value',
      options: [
        { value: 'cough', label: 'Cough' },
        { value: 'fever', label: 'Fever' },
      ],
    },
    coded: {
      type: 'codedValue',
      key: 'value',
      label: 'Value',
      system: 'http://loinc.org',
    },
  } as const;
  return compileOrThrow(
    formOf([
      source[answerField],
      { type: 'shortText', key: 'target', label: 'Target', conditions: [{ effect: 'show', when }] },
    ])
  );
}

function visibleTarget(compiled: CompiledForm, values: FormValues): boolean {
  return fieldStateFor(evaluateConditions(compiled, values), 'target')?.visible === true;
}

describe('evaluateConditions', () => {
  const branching = compileOrThrow(branchingForm);

  it('shows a field only when its show rule is satisfied', () => {
    const hidden = evaluateConditions(branching, {});
    expect(hidden.fields.due_date_note).toStrictEqual({ visible: false, required: false });

    const shown = evaluateConditions(branching, { pregnant: true });
    expect(shown.fields.due_date_note).toStrictEqual({ visible: true, required: true });
  });

  it('never requires a hidden field, whatever its base flag says', () => {
    const states = evaluateConditions(branching, { pregnant: false });
    expect(states.fields.due_date_note).toStrictEqual({ visible: false, required: false });
  });

  it('reads a hidden field as unanswered, so a closed branch stays closed', () => {
    // due_date_note keeps its answer in the document, but pregnant is false, so
    // the field is hidden and midwife must not see the retained answer.
    const states = evaluateConditions(branching, {
      pregnant: false,
      due_date_note: 'Mid October',
    });
    expect(states.fields.due_date_note?.visible).toBe(false);
    expect(states.fields.midwife?.visible).toBe(false);

    const reopened = evaluateConditions(branching, {
      pregnant: true,
      due_date_note: 'Mid October',
    });
    expect(reopened.fields.midwife?.visible).toBe(true);
  });

  it('conjoins show rules and lets any hide rule win', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'a', label: 'A' },
        { type: 'boolean', key: 'b', label: 'B' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'a', operator: 'equals', value: true },
            },
            {
              effect: 'show',
              when: { kind: 'compare', field: 'b', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    expect(visibleTarget(compiled, { a: true, b: true })).toBe(true);
    expect(visibleTarget(compiled, { a: true, b: false })).toBe(false);

    const hiding = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'a', label: 'A' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'hide',
              when: { kind: 'compare', field: 'a', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    expect(visibleTarget(hiding, { a: true })).toBe(false);
    expect(visibleTarget(hiding, { a: false })).toBe(true);
  });

  it('applies require and optional in declaration order, last satisfied rule winning', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'broad', label: 'Broad' },
        { type: 'boolean', key: 'carve_out', label: 'Carve out' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'require',
              when: { kind: 'compare', field: 'broad', operator: 'equals', value: true },
            },
            {
              effect: 'optional',
              when: { kind: 'compare', field: 'carve_out', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    const required = (values: FormValues): boolean =>
      fieldStateFor(evaluateConditions(compiled, values), 'target')?.required === true;

    expect(required({ broad: true })).toBe(true);
    expect(required({ broad: true, carve_out: true })).toBe(false);
    expect(required({ broad: false })).toBe(false);
  });

  it('lets an optional rule relax a field that is required by default', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'declined', label: 'Declined to answer' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          required: true,
          conditions: [
            {
              effect: 'optional',
              when: { kind: 'compare', field: 'declined', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    expect(fieldStateFor(evaluateConditions(compiled, {}), 'target')?.required).toBe(true);
    expect(
      fieldStateFor(evaluateConditions(compiled, { declined: true }), 'target')?.required
    ).toBe(false);
  });
});

describe('evaluation order', () => {
  const forward = compileOrThrow(forwardReferenceForm);

  it('sorts dependencies before dependents rather than keeping declaration order', () => {
    expect(forwardReferenceForm.fields.map((field) => field.key)).toStrictEqual([
      'midwife',
      'due_date_note',
      'pregnant',
    ]);
    expect(forward.evaluationOrder).toStrictEqual(['pregnant', 'due_date_note', 'midwife']);
  });

  it('gets the right answer for a chain declared backwards', () => {
    // Evaluated in declaration order, midwife would read due_date_note before
    // due_date_note's own visibility had settled, and would stay visible.
    const states = evaluateConditions(forward, {
      pregnant: false,
      due_date_note: 'Mid October',
    });
    expect(states.fields.midwife?.visible).toBe(false);
  });

  it('places a repeating group before its children', () => {
    const compiled = compileOrThrow(medicationGroupForm);
    const order = compiled.evaluationOrder;
    expect(order.indexOf('meds')).toBeLessThan(order.indexOf('is_prn'));
    expect(order.indexOf('is_prn')).toBeLessThan(order.indexOf('prn_reason'));
  });
});

describe('conditions inside a repeating group', () => {
  const compiled = compileOrThrow(medicationGroupForm);

  it('resolves against the same repetition, never another one', () => {
    const states = evaluateConditions(compiled, {
      reviewing: false,
      is_prn: [true, false, true],
      prn_reason: ['Breakthrough pain', null, null],
    });
    expect(states.repeats.prn_reason).toStrictEqual([
      { visible: true, required: true },
      { visible: false, required: false },
      { visible: true, required: true },
    ]);
  });

  it('lets a repetition read a top-level field', () => {
    const hidden = evaluateConditions(compiled, { reviewing: false, is_prn: [true] });
    expect(hidden.repeats.reviewer_note).toStrictEqual([{ visible: false, required: false }]);

    const shown = evaluateConditions(compiled, { reviewing: true, is_prn: [true] });
    expect(shown.repeats.reviewer_note).toStrictEqual([{ visible: true, required: false }]);
  });

  it('derives the repetition count from the longest child answer list', () => {
    const states = evaluateConditions(compiled, { is_prn: [true], prn_reason: ['a', 'b', 'c'] });
    expect(states.repeats.is_prn).toHaveLength(3);
  });

  it('reports no repetitions when nothing in the group is answered', () => {
    const states = evaluateConditions(compiled, { reviewing: true });
    expect(states.repeats.prn_reason).toStrictEqual([]);
  });

  it('hides every repetition when the group itself is hidden', () => {
    const gated = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'has_meds', label: 'Takes medication' },
        {
          type: 'repeatingGroup',
          key: 'meds',
          label: 'Medications',
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'has_meds', operator: 'equals', value: true },
            },
          ],
          fields: [{ type: 'shortText', key: 'med_name', label: 'Name', required: true }],
        },
      ])
    );
    const states = evaluateConditions(gated, { has_meds: false, med_name: ['Cardiozine'] });
    expect(states.fields.meds?.visible).toBe(false);
    expect(states.repeats.med_name).toStrictEqual([{ visible: false, required: false }]);
  });
});

describe('leaf operators', () => {
  it('compares for equality and inequality', () => {
    const equals = operatorForm({
      kind: 'compare',
      field: 'value',
      operator: 'equals',
      value: 'yes',
    });
    expect(visibleTarget(equals, { value: 'yes' })).toBe(true);
    expect(visibleTarget(equals, { value: 'no' })).toBe(false);

    const notEquals = operatorForm({
      kind: 'compare',
      field: 'value',
      operator: 'notEquals',
      value: 'yes',
    });
    expect(visibleTarget(notEquals, { value: 'no' })).toBe(true);
    expect(visibleTarget(notEquals, { value: 'yes' })).toBe(false);
  });

  it('tests membership in and out of a list', () => {
    const isIn = operatorForm({
      kind: 'membership',
      field: 'value',
      operator: 'in',
      values: ['a', 'b'],
    });
    expect(visibleTarget(isIn, { value: 'b' })).toBe(true);
    expect(visibleTarget(isIn, { value: 'c' })).toBe(false);

    const notIn = operatorForm({
      kind: 'membership',
      field: 'value',
      operator: 'notIn',
      values: ['a', 'b'],
    });
    expect(visibleTarget(notIn, { value: 'c' })).toBe(true);
    expect(visibleTarget(notIn, { value: 'a' })).toBe(false);
  });

  it('orders numbers numerically', () => {
    const cases: ReadonlyArray<
      readonly [
        'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual',
        number,
        boolean,
      ]
    > = [
      ['greaterThan', 6, true],
      ['greaterThan', 5, false],
      ['greaterThanOrEqual', 5, true],
      ['greaterThanOrEqual', 4, false],
      ['lessThan', 4, true],
      ['lessThan', 5, false],
      ['lessThanOrEqual', 5, true],
      ['lessThanOrEqual', 6, false],
    ];
    for (const [operator, answer, expected] of cases) {
      const compiled = compileOrThrow(
        formOf([
          { type: 'number', key: 'value', label: 'Value' },
          {
            type: 'shortText',
            key: 'target',
            label: 'Target',
            conditions: [
              { effect: 'show', when: { kind: 'ordering', field: 'value', operator, value: 5 } },
            ],
          },
        ])
      );
      expect(visibleTarget(compiled, { value: answer })).toBe(expected);
    }
  });

  it('orders ISO date strings chronologically', () => {
    const compiled = operatorForm({
      kind: 'ordering',
      field: 'value',
      operator: 'greaterThan',
      value: '2026-01-01',
    });
    expect(visibleTarget(compiled, { value: '2026-06-01' })).toBe(true);
    expect(visibleTarget(compiled, { value: '2025-06-01' })).toBe(false);
    expect(visibleTarget(compiled, { value: '2026-01-01' })).toBe(false);
  });

  it('never orders a mixed pair, and never orders NaN', () => {
    const mixed = operatorForm({
      kind: 'ordering',
      field: 'value',
      operator: 'greaterThan',
      value: 5,
    });
    expect(visibleTarget(mixed, { value: 'seven' })).toBe(false);
    expect(visibleTarget(mixed, {})).toBe(false);
    expect(visibleTarget(mixed, { value: Number.NaN })).toBe(false);
  });

  it('tests presence, counting an empty string and an empty list as unanswered', () => {
    const empty = operatorForm({ kind: 'presence', field: 'value', operator: 'isEmpty' });
    expect(visibleTarget(empty, {})).toBe(true);
    expect(visibleTarget(empty, { value: '' })).toBe(true);
    expect(visibleTarget(empty, { value: null })).toBe(true);
    expect(visibleTarget(empty, { value: 'x' })).toBe(false);

    const notEmpty = operatorForm({ kind: 'presence', field: 'value', operator: 'isNotEmpty' });
    expect(visibleTarget(notEmpty, { value: 'x' })).toBe(true);
    expect(visibleTarget(notEmpty, { value: [] })).toBe(false);
  });

  it('tests a list answer by membership rather than by identity', () => {
    const compiled = operatorForm(
      { kind: 'compare', field: 'value', operator: 'equals', value: 'fever' },
      'list'
    );
    expect(visibleTarget(compiled, { value: ['cough', 'fever'] })).toBe(true);
    expect(visibleTarget(compiled, { value: ['cough'] })).toBe(false);
  });

  it('tests a coded answer by its code', () => {
    const compiled = operatorForm(
      { kind: 'compare', field: 'value', operator: 'equals', value: '8302-2' },
      'coded'
    );
    expect(visibleTarget(compiled, { value: { code: '8302-2', system: 'http://loinc.org' } })).toBe(
      true
    );
    expect(visibleTarget(compiled, { value: { code: '29463-7' } })).toBe(false);
    expect(visibleTarget(compiled, { value: { display: 'no code here' } })).toBe(false);
  });
});

describe('combinators', () => {
  const tree = (when: ConditionNode): CompiledForm =>
    compileOrThrow(
      formOf([
        { type: 'boolean', key: 'a', label: 'A' },
        { type: 'boolean', key: 'b', label: 'B' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [{ effect: 'show', when }],
        },
      ])
    );

  const leafA: ConditionNode = { kind: 'compare', field: 'a', operator: 'equals', value: true };
  const leafB: ConditionNode = { kind: 'compare', field: 'b', operator: 'equals', value: true };

  it('requires every child of all', () => {
    const compiled = tree({ kind: 'all', of: [leafA, leafB] });
    expect(visibleTarget(compiled, { a: true, b: true })).toBe(true);
    expect(visibleTarget(compiled, { a: true, b: false })).toBe(false);
  });

  it('accepts any child of any', () => {
    const compiled = tree({ kind: 'any', of: [leafA, leafB] });
    expect(visibleTarget(compiled, { a: false, b: true })).toBe(true);
    expect(visibleTarget(compiled, { a: false, b: false })).toBe(false);
  });

  it('inverts a subtree with not', () => {
    const compiled = tree({ kind: 'not', of: { kind: 'any', of: [leafA, leafB] } });
    expect(visibleTarget(compiled, { a: false, b: false })).toBe(true);
    expect(visibleTarget(compiled, { a: true, b: false })).toBe(false);
  });
});

describe('fieldStateFor', () => {
  const compiled = compileOrThrow(medicationGroupForm);
  const states = evaluateConditions(compiled, { is_prn: [true, false] });

  it('reads a top-level field without an index', () => {
    expect(fieldStateFor(states, 'reviewing')).toStrictEqual({ visible: true, required: false });
  });

  it('reads a repetition by index', () => {
    expect(fieldStateFor(states, 'prn_reason', 0)?.required).toBe(true);
    expect(fieldStateFor(states, 'prn_reason', 1)?.required).toBe(false);
  });

  it('returns nothing for a key or index the form does not have', () => {
    expect(fieldStateFor(states, 'ghost')).toBeUndefined();
    expect(fieldStateFor(states, 'prn_reason', 9)).toBeUndefined();
    expect(fieldStateFor(states, 'reviewing', 0)).toBeUndefined();
  });
});

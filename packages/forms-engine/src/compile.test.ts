import { describe, expect, it } from 'vitest';

import { compileDefinition } from './compile.js';
import type { FormDefinition } from './definition.js';
import {
  compileErrorCodes,
  compileErrors,
  compileOrThrow,
  formOf,
  intakeForm,
  mutate,
} from './test-support/forms.js';

describe('compileDefinition', () => {
  const compiled = compileOrThrow(intakeForm);

  it('flattens every field, groups followed by their children', () => {
    expect(compiled.key).toBe('adult_intake');
    expect(compiled.version).toBe(3);
    expect(compiled.fields.map((field) => field.key)).toStrictEqual([
      'about_you',
      'intro',
      'preferred_name',
      'reason_for_visit',
      'weight',
      'children',
      'last_tetanus',
      'symptom_onset',
      'smoking',
      'symptoms',
      'pregnant',
      'pain',
      'primary_problem',
      'insurance_card',
      'consent_signature',
      'medications',
      'med_name',
      'med_dose',
      'med_prn',
    ]);
  });

  it('marks presentation fields as carrying no answer', () => {
    const heading = compiled.fields.find((field) => field.key === 'about_you');
    const group = compiled.fields.find((field) => field.key === 'medications');
    const name = compiled.fields.find((field) => field.key === 'preferred_name');
    expect(heading?.answerable).toBe(false);
    expect(group?.answerable).toBe(false);
    expect(name?.answerable).toBe(true);
    expect(name?.required).toBe(true);
  });

  it('records which group each child belongs to', () => {
    const child = compiled.fields.find((field) => field.key === 'med_dose');
    expect(child?.groupKey).toBe('medications');
    expect(compiled.fields.find((field) => field.key === 'weight')?.groupKey).toBeUndefined();
  });

  it('orders every field exactly once for evaluation', () => {
    expect([...compiled.evaluationOrder].sort()).toStrictEqual(
      compiled.fields.map((field) => field.key).sort()
    );
  });

  it('emits all five artifacts', () => {
    expect(compiled.renderTree.nodes).toHaveLength(16);
    expect(compiled.printLayout.blocks.length).toBeGreaterThan(0);
    expect(compiled.questionnaire.resourceType).toBe('Questionnaire');
    expect(compiled.promotionManifest.definitionKey).toBe('adult_intake');
    expect(compiled.schema.safeParse({ preferred_name: 'Testina' }).success).toBe(true);
  });

  it('snapshots the source definition instead of holding the caller draft', () => {
    const draft: FormDefinition = formOf([{ type: 'shortText', key: 'note', label: 'Note' }]);
    const result = compileOrThrow(draft);
    mutate(draft, 'title', 'Renamed after compiling');
    expect(result.definition.title).toBe('Fixture form');
    expect(draft.title).toBe('Renamed after compiling');
  });

  it('freezes the definition and the serializable artifacts', () => {
    expect(Object.isFrozen(compiled.definition)).toBe(true);
    expect(Object.isFrozen(compiled.definition.fields)).toBe(true);
    expect(Object.isFrozen(compiled.renderTree)).toBe(true);
    expect(Object.isFrozen(compiled.printLayout)).toBe(true);
    expect(Object.isFrozen(compiled.questionnaire)).toBe(true);
    expect(Object.isFrozen(compiled.promotionManifest)).toBe(true);
    expect(Object.isFrozen(compiled.evaluationOrder)).toBe(true);
  });

  it('leaves the zod schema unfrozen so it can build its internals lazily', () => {
    expect(Object.isFrozen(compiled.schema)).toBe(false);
  });

  it('honours the canonical base URL and the questionnaire status', () => {
    const result = compileDefinition(intakeForm, {
      baseUrl: 'https://clinic.invalid/fhir',
      status: 'draft',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.questionnaire.url).toBe(
      'https://clinic.invalid/fhir/Questionnaire/adult_intake'
    );
    expect(result.value.questionnaire.status).toBe('draft');
  });
});

describe('compileDefinition refusals', () => {
  it('rejects a key that is not an identifier', () => {
    expect(
      compileErrorCodes(formOf([{ type: 'shortText', key: 'not a key', label: 'Bad' }]))
    ).toStrictEqual(['invalidFieldKey']);
  });

  it('rejects a duplicate key, including one that collides with a group child', () => {
    expect(
      compileErrorCodes(
        formOf([
          { type: 'shortText', key: 'note', label: 'One' },
          { type: 'shortText', key: 'note', label: 'Two' },
        ])
      )
    ).toStrictEqual(['duplicateFieldKey']);

    expect(
      compileErrorCodes(
        formOf([
          { type: 'shortText', key: 'note', label: 'One' },
          {
            type: 'repeatingGroup',
            key: 'group',
            label: 'Group',
            fields: [{ type: 'shortText', key: 'note', label: 'Collides' }],
          },
        ])
      )
    ).toStrictEqual(['duplicateFieldKey']);
  });

  it('rejects a repeating group inside a repeating group', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'repeatingGroup',
          key: 'outer',
          label: 'Outer',
          fields: [
            {
              type: 'repeatingGroup',
              key: 'inner',
              label: 'Inner',
              fields: [{ type: 'shortText', key: 'deep', label: 'Deep' }],
            },
          ],
        },
      ])
    );
    expect(errors).toStrictEqual([
      {
        code: 'nestedRepeatingGroup',
        fieldKey: 'inner',
        groupKey: 'outer',
        message:
          'A repeating group may not contain another one; repeatIndex would have to become a path.',
      },
    ]);
  });

  it('rejects a repeating group with nothing in it', () => {
    expect(
      compileErrorCodes(
        formOf([{ type: 'repeatingGroup', key: 'empty', label: 'Empty', fields: [] }])
      )
    ).toStrictEqual(['emptyRepeatingGroup']);
  });

  it('rejects a select with no options and one with duplicate option values', () => {
    expect(
      compileErrorCodes(formOf([{ type: 'singleSelect', key: 'pick', label: 'Pick', options: [] }]))
    ).toStrictEqual(['emptyOptionList']);

    const errors = compileErrors(
      formOf([
        {
          type: 'multiSelect',
          key: 'pick',
          label: 'Pick',
          options: [
            { value: 'a', label: 'First' },
            { value: 'a', label: 'Second' },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({ code: 'duplicateOptionValue', optionValue: 'a' });
  });

  it('rejects a scale with no positions', () => {
    expect(
      compileErrorCodes(formOf([{ type: 'scale', key: 'pain', label: 'Pain', min: 5, max: 5 }]))
    ).toStrictEqual(['invalidScaleRange']);
  });

  it('rejects a coded field with no bound system', () => {
    expect(
      compileErrorCodes(
        formOf([{ type: 'codedValue', key: 'dx', label: 'Diagnosis', system: '  ' }])
      )
    ).toStrictEqual(['missingCodeSystem']);
  });

  it('rejects promoting a field type with no indexed column', () => {
    expect(
      compileErrorCodes(
        formOf([
          {
            type: 'signature',
            key: 'sig',
            label: 'Signature',
            promote: { graphable: true },
          },
        ])
      )
    ).toStrictEqual(['unpromotableField']);
  });

  it('rejects promoting a multi-select inside a repeating group', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'repeatingGroup',
          key: 'group',
          label: 'Group',
          fields: [
            {
              type: 'multiSelect',
              key: 'tags',
              label: 'Tags',
              options: [{ value: 'a', label: 'A' }],
              promote: { searchable: true },
            },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({ code: 'unpromotableField', fieldKey: 'tags' });
  });

  it('accepts promotion flags that are all false as no promotion at all', () => {
    const compiled = compileOrThrow(
      formOf([
        {
          type: 'signature',
          key: 'sig',
          label: 'Signature',
          promote: { graphable: false, searchable: false, reportable: false },
        },
      ])
    );
    expect(compiled.promotionManifest.fields).toStrictEqual([]);
  });

  it('rejects a condition that reads a field the form does not declare', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'shortText',
          key: 'note',
          label: 'Note',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'ghost', operator: 'isNotEmpty' } },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({
      code: 'unknownConditionField',
      fieldKey: 'note',
      referencedKey: 'ghost',
    });
  });

  it('rejects a condition that reads a field carrying no answer', () => {
    const errors = compileErrors(
      formOf([
        { type: 'sectionHeader', key: 'heading', label: 'Heading' },
        {
          type: 'shortText',
          key: 'note',
          label: 'Note',
          conditions: [
            {
              effect: 'show',
              when: { kind: 'presence', field: 'heading', operator: 'isNotEmpty' },
            },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({
      code: 'conditionTargetHasNoAnswer',
      referencedKey: 'heading',
      referencedType: 'sectionHeader',
    });
  });

  it('rejects a condition reaching into another repetition', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'repeatingGroup',
          key: 'left',
          label: 'Left',
          fields: [{ type: 'boolean', key: 'left_flag', label: 'Flag' }],
        },
        {
          type: 'repeatingGroup',
          key: 'right',
          label: 'Right',
          fields: [
            {
              type: 'shortText',
              key: 'right_note',
              label: 'Note',
              conditions: [
                {
                  effect: 'show',
                  when: { kind: 'compare', field: 'left_flag', operator: 'equals', value: true },
                },
              ],
            },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({ code: 'crossRepeatReference', referencedKey: 'left_flag' });
  });

  it('rejects a top-level condition reading inside a repeating group', () => {
    expect(
      compileErrorCodes(
        formOf([
          {
            type: 'repeatingGroup',
            key: 'group',
            label: 'Group',
            fields: [{ type: 'boolean', key: 'flag', label: 'Flag' }],
          },
          {
            type: 'shortText',
            key: 'note',
            label: 'Note',
            conditions: [
              {
                effect: 'show',
                when: { kind: 'compare', field: 'flag', operator: 'equals', value: true },
              },
            ],
          },
        ])
      )
    ).toStrictEqual(['crossRepeatReference']);
  });

  it('rejects an all/any node with no children', () => {
    expect(
      compileErrorCodes(
        formOf([
          { type: 'boolean', key: 'flag', label: 'Flag' },
          {
            type: 'shortText',
            key: 'note',
            label: 'Note',
            conditions: [{ effect: 'show', when: { kind: 'all', of: [] } }],
          },
        ])
      )
    ).toStrictEqual(['emptyConditionGroup']);

    expect(
      compileErrorCodes(
        formOf([
          { type: 'boolean', key: 'flag', label: 'Flag' },
          {
            type: 'shortText',
            key: 'note',
            label: 'Note',
            conditions: [
              {
                effect: 'show',
                when: { kind: 'not', of: { kind: 'any', of: [] } },
              },
            ],
          },
        ])
      )
    ).toStrictEqual(['emptyConditionGroup']);
  });

  it('reports every problem in one pass rather than the first one', () => {
    const codes = compileErrorCodes(
      formOf([
        { type: 'scale', key: 'pain', label: 'Pain', min: 9, max: 1 },
        { type: 'singleSelect', key: 'pick', label: 'Pick', options: [] },
        { type: 'codedValue', key: 'dx', label: 'Diagnosis', system: '' },
      ])
    );
    expect(codes).toStrictEqual(['invalidScaleRange', 'emptyOptionList', 'missingCodeSystem']);
  });
});

describe('condition cycles', () => {
  it('rejects a two-field cycle rather than hanging', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'shortText',
          key: 'alpha',
          label: 'Alpha',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'beta', operator: 'isNotEmpty' } },
          ],
        },
        {
          type: 'shortText',
          key: 'beta',
          label: 'Beta',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'alpha', operator: 'isNotEmpty' } },
          ],
        },
      ])
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'conditionCycle',
      fieldKey: 'alpha',
      cycle: ['alpha', 'beta', 'alpha'],
    });
  });

  it('rejects a three-field cycle and names the whole path', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'shortText',
          key: 'alpha',
          label: 'Alpha',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'gamma', operator: 'isNotEmpty' } },
          ],
        },
        {
          type: 'shortText',
          key: 'beta',
          label: 'Beta',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'alpha', operator: 'isNotEmpty' } },
          ],
        },
        {
          type: 'shortText',
          key: 'gamma',
          label: 'Gamma',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'beta', operator: 'isNotEmpty' } },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({ cycle: ['alpha', 'gamma', 'beta', 'alpha'] });
    expect(errors[0]?.message).toContain('alpha -> gamma -> beta -> alpha');
  });

  it('rejects a field whose condition reads itself', () => {
    const errors = compileErrors(
      formOf([
        {
          type: 'shortText',
          key: 'alpha',
          label: 'Alpha',
          conditions: [
            { effect: 'show', when: { kind: 'presence', field: 'alpha', operator: 'isNotEmpty' } },
          ],
        },
      ])
    );
    expect(errors[0]).toMatchObject({ code: 'conditionCycle', cycle: ['alpha', 'alpha'] });
  });
});

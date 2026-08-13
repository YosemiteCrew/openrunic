import { describe, expect, it } from 'vitest';

import { RENDER_GRID_COLUMNS } from './render-tree.js';
import { compileOrThrow, formOf, intakeForm, medicationGroupForm } from './test-support/forms.js';

const intake = compileOrThrow(intakeForm);

describe('render tree', () => {
  it('is plain JSON with no functions, because it is persisted and read back', () => {
    expect(JSON.parse(JSON.stringify(intake.renderTree))).toStrictEqual(intake.renderTree);
  });

  it('describes the form it came from', () => {
    expect(intake.renderTree).toMatchObject({
      key: 'adult_intake',
      version: 3,
      title: 'Adult intake',
      bindTo: 'PORTAL',
    });
  });

  it('nests a repeating group children under the group node', () => {
    const group = intake.renderTree.nodes.find((node) => node.key === 'medications');
    expect(group).toMatchObject({ nodeType: 'group', minRepeats: 0, maxRepeats: 5 });
    if (group?.nodeType !== 'group') {
      return;
    }
    expect(group.children.map((child) => child.key)).toStrictEqual([
      'med_name',
      'med_dose',
      'med_prn',
    ]);
  });

  it('defaults a group with no declared bounds to zero and unbounded', () => {
    const compiled = compileOrThrow(medicationGroupForm);
    const group = compiled.renderTree.nodes.find((node) => node.key === 'meds');
    expect(group).toMatchObject({ minRepeats: 0 });
    expect(group).not.toHaveProperty('maxRepeats');
  });

  it('resolves layout hints so the renderer never has to default them', () => {
    const named = intake.renderTree.nodes.find((node) => node.key === 'preferred_name');
    const plain = intake.renderTree.nodes.find((node) => node.key === 'weight');
    expect(named?.layout).toStrictEqual({ columnSpan: 6, density: 'compact' });
    expect(plain?.layout).toStrictEqual({
      columnSpan: RENDER_GRID_COLUMNS,
      density: 'comfortable',
    });
  });

  it('clamps an out-of-range span rather than refusing to publish the form', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'shortText', key: 'wide', label: 'Wide', layout: { columnSpan: 40 } },
        { type: 'shortText', key: 'narrow', label: 'Narrow', layout: { columnSpan: 0 } },
        { type: 'shortText', key: 'fractional', label: 'Fractional', layout: { columnSpan: 5.4 } },
      ])
    );
    const spanOf = (key: string): number | undefined =>
      compiled.renderTree.nodes.find((node) => node.key === key)?.layout.columnSpan;
    expect(spanOf('wide')).toBe(12);
    expect(spanOf('narrow')).toBe(1);
    expect(spanOf('fractional')).toBe(5);
  });

  it('flattens type-specific hints onto the node', () => {
    const nodeFor = (key: string): Record<string, unknown> => {
      const node = intake.renderTree.nodes.find((candidate) => candidate.key === key);
      if (node === undefined) {
        throw new Error(`render tree has no node ${key}`);
      }
      return node as unknown as Record<string, unknown>;
    };
    expect(nodeFor('preferred_name')).toMatchObject({ maxLength: 40, placeholder: 'Testina' });
    expect(nodeFor('reason_for_visit')).toMatchObject({ rows: 4, maxLength: 500 });
    expect(nodeFor('weight')).toMatchObject({ unit: 'kg', min: 0, max: 400, step: 0.1 });
    expect(nodeFor('children')).toMatchObject({ integer: true });
    expect(nodeFor('pain')).toMatchObject({ min: 0, max: 10, minLabel: 'None' });
    expect(nodeFor('consent_signature')).toMatchObject({ signerRole: 'patient' });
    expect(nodeFor('insurance_card')).toMatchObject({ accept: ['image/png', 'image/jpeg'] });
    expect(nodeFor('primary_problem')).toMatchObject({
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      valueSet: 'https://openrunic.org/fhir/ValueSet/intake-problems',
    });
    expect(nodeFor('about_you')).toMatchObject({ level: 1 });
    expect(nodeFor('intro')).toMatchObject({
      text: 'Answer what you can. Nothing here is compulsory unless it is marked.',
    });
    expect(nodeFor('symptoms')).toMatchObject({ maxSelected: 3 });
    expect(nodeFor('pregnant')).not.toHaveProperty('unit');
  });

  it('defaults a section header to level two when the author does not say', () => {
    const compiled = compileOrThrow(
      formOf([{ type: 'sectionHeader', key: 'h', label: 'Heading' }])
    );
    expect(compiled.renderTree.nodes[0]).toMatchObject({ level: 2 });
  });

  it('names the conditions that govern each node, and carries them once on the tree', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'gate', label: 'Gate' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'gate', operator: 'equals', value: true },
            },
            {
              effect: 'require',
              when: { kind: 'presence', field: 'gate', operator: 'isNotEmpty' },
            },
          ],
        },
      ])
    );
    expect(compiled.renderTree.nodes[1]?.conditionIds).toStrictEqual(['target#0', 'target#1']);
    expect(compiled.renderTree.conditions.map((condition) => condition.id)).toStrictEqual([
      'target#0',
      'target#1',
    ]);
    expect(compiled.renderTree.conditions[0]).toStrictEqual({
      id: 'target#0',
      fieldKey: 'target',
      effect: 'show',
      when: { kind: 'compare', field: 'gate', operator: 'equals', value: true },
      dependsOn: ['gate'],
    });
  });

  it('deduplicates the fields a condition tree reads', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'gate', label: 'Gate' },
        { type: 'boolean', key: 'other', label: 'Other' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'show',
              when: {
                kind: 'all',
                of: [
                  { kind: 'compare', field: 'gate', operator: 'equals', value: true },
                  { kind: 'not', of: { kind: 'presence', field: 'gate', operator: 'isEmpty' } },
                  { kind: 'compare', field: 'other', operator: 'equals', value: true },
                ],
              },
            },
          ],
        },
      ])
    );
    expect(compiled.renderTree.conditions[0]?.dependsOn).toStrictEqual(['gate', 'other']);
  });
});

describe('print layout', () => {
  it('is plain JSON, like the render tree', () => {
    expect(JSON.parse(JSON.stringify(intake.printLayout))).toStrictEqual(intake.printLayout);
  });

  it('prints headings, paragraphs, value slots, a ruled signature and a table', () => {
    expect(intake.printLayout.blocks.map((block) => [block.blockType, block.key])).toStrictEqual([
      ['heading', 'about_you'],
      ['paragraph', 'intro'],
      ['valueSlot', 'preferred_name'],
      ['valueSlot', 'reason_for_visit'],
      ['valueSlot', 'weight'],
      ['valueSlot', 'children'],
      ['valueSlot', 'last_tetanus'],
      ['valueSlot', 'symptom_onset'],
      ['valueSlot', 'smoking'],
      ['valueSlot', 'symptoms'],
      ['valueSlot', 'pregnant'],
      ['valueSlot', 'pain'],
      ['valueSlot', 'primary_problem'],
      ['valueSlot', 'insurance_card'],
      ['pageBreak', 'consent_signature#break'],
      ['signature', 'consent_signature'],
      ['repeatTable', 'medications'],
    ]);
  });

  it('renders a signature as a ruled line rather than as an input', () => {
    const signature = intake.printLayout.blocks.find((block) => block.key === 'consent_signature');
    expect(signature).toStrictEqual({
      blockType: 'signature',
      key: 'consent_signature',
      label: 'Your signature',
      signerRole: 'patient',
      conditionIds: [],
    });
  });

  it('picks a value style that suits the answer', () => {
    const styleOf = (key: string): unknown => {
      const block = intake.printLayout.blocks.find((candidate) => candidate.key === key);
      return block?.blockType === 'valueSlot' ? block.valueStyle : undefined;
    };
    expect(styleOf('pregnant')).toBe('checkbox');
    expect(styleOf('reason_for_visit')).toBe('block');
    expect(styleOf('symptoms')).toBe('list');
    expect(styleOf('preferred_name')).toBe('inline');
  });

  it('carries the unit on a quantity slot so the printed page is not ambiguous', () => {
    const weight = intake.printLayout.blocks.find((block) => block.key === 'weight');
    expect(weight).toMatchObject({ unit: 'kg' });
    expect(intake.printLayout.blocks.find((block) => block.key === 'pain')).not.toHaveProperty(
      'unit'
    );
  });

  it('gives a repeating group one column per child and blank rows to write in', () => {
    const table = intake.printLayout.blocks.find((block) => block.key === 'medications');
    expect(table).toStrictEqual({
      blockType: 'repeatTable',
      key: 'medications',
      label: 'Current medications',
      columns: [
        { key: 'med_name', label: 'Medication', fieldType: 'shortText' },
        { key: 'med_dose', label: 'Dose', fieldType: 'number', unit: 'mg' },
        { key: 'med_prn', label: 'Taken as needed', fieldType: 'boolean' },
      ],
      blankRows: 3,
      conditionIds: [],
    });
  });

  it('prints at least as many blank rows as the group demands entries', () => {
    const compiled = compileOrThrow(
      formOf([
        {
          type: 'repeatingGroup',
          key: 'group',
          label: 'Group',
          minRepeats: 6,
          fields: [{ type: 'shortText', key: 'item', label: 'Item' }],
        },
      ])
    );
    expect(compiled.printLayout.blocks[0]).toMatchObject({ blankRows: 6 });
  });

  it('carries the description through when the form has one', () => {
    expect(intake.printLayout.description).toBe(
      'Synthetic intake form, used only by this package to test itself.'
    );
    const compiled = compileOrThrow(formOf([{ type: 'shortText', key: 'note', label: 'Note' }]));
    expect(compiled.printLayout).not.toHaveProperty('description');
    expect(compiled.renderTree).not.toHaveProperty('description');
  });
});

describe('generated schema', () => {
  it('enforces the selection bounds a multi-select declares', () => {
    const compiled = compileOrThrow(
      formOf([
        {
          type: 'multiSelect',
          key: 'tags',
          label: 'Tags',
          minSelected: 2,
          maxSelected: 3,
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
            { value: 'd', label: 'D' },
          ],
        },
      ])
    );
    expect(compiled.schema.safeParse({ tags: ['a'] }).success).toBe(false);
    expect(compiled.schema.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
    expect(compiled.schema.safeParse({ tags: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });

  it('demands a required field that no condition can hide', () => {
    expect(intake.schema.safeParse({}).success).toBe(false);
    expect(intake.schema.safeParse({ preferred_name: 'Testina' }).success).toBe(true);
  });

  it('declines to demand a required field a condition can take off the page', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'gate', label: 'Gate' },
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          required: true,
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'gate', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    expect(compiled.schema.safeParse({ gate: false }).success).toBe(true);
  });

  it('accepts a null in a repeating column, for a repetition that skipped the field', () => {
    expect(intake.schema.safeParse({ preferred_name: 'T', med_dose: [500, null] }).success).toBe(
      true
    );
  });
});

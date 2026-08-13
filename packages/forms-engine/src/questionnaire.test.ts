import { describe, expect, it } from 'vitest';

import type { CompiledForm } from './compiled.js';
import type { ConditionNode, FormField, FormValues } from './definition.js';
import type { QuestionnaireItem, QuestionnaireResponse } from './questionnaire.js';
import { fromQuestionnaireResponse, toQuestionnaireResponse } from './questionnaire.js';
import { compileOrThrow, formOf, intakeForm } from './test-support/forms.js';

const intake = compileOrThrow(intakeForm);

function itemFor(compiled: CompiledForm, linkId: string): QuestionnaireItem {
  const item = compiled.questionnaire.item.find((candidate) => candidate.linkId === linkId);
  if (item === undefined) {
    throw new Error(`questionnaire has no item ${linkId}`);
  }
  return item;
}

/** A one-condition form over a chosen answer field, for enableWhen tests. */
function gatedForm(when: ConditionNode, effect: 'show' | 'hide', gate: FormField): CompiledForm {
  return compileOrThrow(
    formOf([
      gate,
      { type: 'shortText', key: 'target', label: 'Target', conditions: [{ effect, when }] },
    ])
  );
}

const booleanGate: FormField = { type: 'boolean', key: 'gate', label: 'Gate' };

describe('Questionnaire', () => {
  it('names itself canonically and pins the definition version', () => {
    expect(intake.questionnaire).toMatchObject({
      resourceType: 'Questionnaire',
      url: 'https://openrunic.org/fhir/Questionnaire/adult_intake',
      version: '3',
      name: 'adult_intake',
      title: 'Adult intake',
      status: 'active',
      subjectType: ['Patient'],
    });
  });

  it('emits one item per top-level field, presentation fields included as display', () => {
    expect(intake.questionnaire.item.map((item) => item.linkId)).toStrictEqual([
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
    ]);
  });

  it('maps every catalogue type to its FHIR item type', () => {
    const typeOf = (linkId: string): string => itemFor(intake, linkId).type;
    expect(typeOf('about_you')).toBe('display');
    expect(typeOf('intro')).toBe('display');
    expect(typeOf('preferred_name')).toBe('string');
    expect(typeOf('reason_for_visit')).toBe('text');
    expect(typeOf('weight')).toBe('quantity');
    expect(typeOf('children')).toBe('decimal');
    expect(typeOf('last_tetanus')).toBe('date');
    expect(typeOf('symptom_onset')).toBe('dateTime');
    expect(typeOf('smoking')).toBe('choice');
    expect(typeOf('symptoms')).toBe('choice');
    expect(typeOf('pregnant')).toBe('boolean');
    expect(typeOf('pain')).toBe('integer');
    expect(typeOf('primary_problem')).toBe('choice');
    expect(typeOf('insurance_card')).toBe('attachment');
    expect(typeOf('consent_signature')).toBe('attachment');
    expect(typeOf('medications')).toBe('group');
  });

  it('marks repeats on multi-selects and on repeating groups only', () => {
    expect(itemFor(intake, 'symptoms').repeats).toBe(true);
    expect(itemFor(intake, 'medications').repeats).toBe(true);
    expect(itemFor(intake, 'smoking').repeats).toBeUndefined();
  });

  it('carries required from the base flag and never from a presentation field', () => {
    expect(itemFor(intake, 'preferred_name').required).toBe(true);
    expect(itemFor(intake, 'weight').required).toBe(false);
    expect(itemFor(intake, 'about_you').required).toBeUndefined();
    expect(itemFor(intake, 'medications').required).toBeUndefined();
  });

  it('carries answer options as strings for selects and as codings for coded fields', () => {
    expect(itemFor(intake, 'smoking').answerOption).toStrictEqual([
      { valueString: 'never' },
      { valueString: 'former' },
      { valueString: 'current' },
    ]);
    expect(itemFor(intake, 'primary_problem').answerOption?.[0]).toStrictEqual({
      valueCoding: {
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
        code: 'E11.9',
        display: 'Type 2 diabetes mellitus without complications',
      },
    });
    expect(itemFor(intake, 'pregnant').answerOption).toBeUndefined();
  });

  it('carries maxLength on the two text types that declare one', () => {
    expect(itemFor(intake, 'preferred_name').maxLength).toBe(40);
    expect(itemFor(intake, 'reason_for_visit').maxLength).toBe(500);
    expect(itemFor(intake, 'weight').maxLength).toBeUndefined();
  });

  it('nests a repeating group children inside the group item', () => {
    expect(itemFor(intake, 'medications').item?.map((child) => child.linkId)).toStrictEqual([
      'med_name',
      'med_dose',
      'med_prn',
    ]);
  });

  it('is plain JSON, so it survives being stored in FormDefinition.compiled', () => {
    expect(JSON.parse(JSON.stringify(intake.questionnaire))).toStrictEqual(intake.questionnaire);
  });
});

describe('enableWhen derivation', () => {
  it('turns a show rule into one clause with no behaviour', () => {
    const compiled = gatedForm(
      { kind: 'compare', field: 'gate', operator: 'equals', value: true },
      'show',
      booleanGate
    );
    const item = itemFor(compiled, 'target');
    expect(item.enableWhen).toStrictEqual([
      { question: 'gate', operator: '=', answerBoolean: true },
    ]);
    expect(item.enableBehavior).toBeUndefined();
    expect(compiled.questionnaireGaps).toStrictEqual([]);
  });

  it('inverts a hide rule rather than dropping it, since FHIR has no not', () => {
    const compiled = gatedForm(
      { kind: 'compare', field: 'gate', operator: 'equals', value: true },
      'hide',
      booleanGate
    );
    expect(itemFor(compiled, 'target').enableWhen).toStrictEqual([
      { question: 'gate', operator: '!=', answerBoolean: true },
    ]);
  });

  it('flattens all into a conjunction and any into a disjunction', () => {
    const two: readonly ConditionNode[] = [
      { kind: 'compare', field: 'gate', operator: 'equals', value: true },
      { kind: 'presence', field: 'gate', operator: 'isNotEmpty' },
    ];
    const conjunction = gatedForm({ kind: 'all', of: two }, 'show', booleanGate);
    expect(itemFor(conjunction, 'target').enableBehavior).toBe('all');

    const disjunction = gatedForm({ kind: 'any', of: two }, 'show', booleanGate);
    expect(itemFor(disjunction, 'target').enableBehavior).toBe('any');
  });

  it('expands membership into one clause per candidate', () => {
    const gate: FormField = {
      type: 'singleSelect',
      key: 'gate',
      label: 'Gate',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    };
    const isIn = gatedForm(
      { kind: 'membership', field: 'gate', operator: 'in', values: ['a', 'b'] },
      'show',
      gate
    );
    expect(itemFor(isIn, 'target')).toMatchObject({
      enableBehavior: 'any',
      enableWhen: [
        { question: 'gate', operator: '=', answerString: 'a' },
        { question: 'gate', operator: '=', answerString: 'b' },
      ],
    });

    const notIn = gatedForm(
      { kind: 'membership', field: 'gate', operator: 'notIn', values: ['a', 'b'] },
      'show',
      gate
    );
    expect(itemFor(notIn, 'target')).toMatchObject({
      enableBehavior: 'all',
      enableWhen: [
        { question: 'gate', operator: '!=', answerString: 'a' },
        { question: 'gate', operator: '!=', answerString: 'b' },
      ],
    });

    const hiddenWhenIn = gatedForm(
      { kind: 'membership', field: 'gate', operator: 'in', values: ['a', 'b'] },
      'hide',
      gate
    );
    expect(itemFor(hiddenWhenIn, 'target').enableBehavior).toBe('all');
  });

  it('turns presence tests into the exists operator', () => {
    const present = gatedForm(
      { kind: 'presence', field: 'gate', operator: 'isNotEmpty' },
      'show',
      booleanGate
    );
    expect(itemFor(present, 'target').enableWhen).toStrictEqual([
      { question: 'gate', operator: 'exists', answerBoolean: true },
    ]);

    const absent = gatedForm(
      { kind: 'presence', field: 'gate', operator: 'isEmpty' },
      'show',
      booleanGate
    );
    expect(itemFor(absent, 'target').enableWhen?.[0]?.answerBoolean).toBe(false);

    const hidden = gatedForm(
      { kind: 'presence', field: 'gate', operator: 'isNotEmpty' },
      'hide',
      booleanGate
    );
    expect(itemFor(hidden, 'target').enableWhen?.[0]?.answerBoolean).toBe(false);
  });

  it('maps every ordering operator, and its inverse under hide', () => {
    const gate: FormField = { type: 'number', key: 'gate', label: 'Gate' };
    const cases: ReadonlyArray<
      readonly [
        'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual',
        string,
        string,
      ]
    > = [
      ['greaterThan', '>', '<='],
      ['greaterThanOrEqual', '>=', '<'],
      ['lessThan', '<', '>='],
      ['lessThanOrEqual', '<=', '>'],
    ];
    for (const [operator, shown, hidden] of cases) {
      const when: ConditionNode = { kind: 'ordering', field: 'gate', operator, value: 5 };
      expect(itemFor(gatedForm(when, 'show', gate), 'target').enableWhen?.[0]).toStrictEqual({
        question: 'gate',
        operator: shown,
        answerDecimal: 5,
      });
      expect(itemFor(gatedForm(when, 'hide', gate), 'target').enableWhen?.[0]?.operator).toBe(
        hidden
      );
    }
  });

  it('pushes not down to the leaves', () => {
    const compiled = gatedForm(
      {
        kind: 'not',
        of: { kind: 'compare', field: 'gate', operator: 'equals', value: true },
      },
      'show',
      booleanGate
    );
    expect(itemFor(compiled, 'target').enableWhen?.[0]?.operator).toBe('!=');
  });

  it('picks the answer element that matches the referenced item type', () => {
    const payloadFor = (gate: FormField, value: string | number | boolean): unknown => {
      const compiled = gatedForm(
        { kind: 'compare', field: 'gate', operator: 'equals', value },
        'show',
        gate
      );
      return itemFor(compiled, 'target').enableWhen?.[0];
    };

    expect(
      payloadFor({ type: 'scale', key: 'gate', label: 'Gate', min: 0, max: 10 }, 4)
    ).toMatchObject({ answerInteger: 4 });
    expect(payloadFor({ type: 'date', key: 'gate', label: 'Gate' }, '2026-01-01')).toMatchObject({
      answerDate: '2026-01-01',
    });
    expect(
      payloadFor({ type: 'datetime', key: 'gate', label: 'Gate' }, '2026-01-01T00:00:00Z')
    ).toMatchObject({ answerDateTime: '2026-01-01T00:00:00Z' });
    expect(
      payloadFor(
        { type: 'codedValue', key: 'gate', label: 'Gate', system: 'http://loinc.org' },
        '8302-2'
      )
    ).toMatchObject({ answerCoding: { system: 'http://loinc.org', code: '8302-2' } });
    expect(payloadFor({ type: 'shortText', key: 'gate', label: 'Gate' }, 'yes')).toMatchObject({
      answerString: 'yes',
    });
  });

  it('names a nested boolean tree as a gap instead of exporting something else', () => {
    const compiled = gatedForm(
      {
        kind: 'all',
        of: [
          {
            kind: 'any',
            of: [
              { kind: 'compare', field: 'gate', operator: 'equals', value: true },
              { kind: 'presence', field: 'gate', operator: 'isEmpty' },
            ],
          },
          { kind: 'presence', field: 'gate', operator: 'isNotEmpty' },
        ],
      },
      'show',
      booleanGate
    );
    expect(itemFor(compiled, 'target').enableWhen).toBeUndefined();
    expect(compiled.questionnaireGaps).toStrictEqual([
      {
        kind: 'conditionNotRepresentable',
        fieldKey: 'target',
        reason:
          'The condition is a nested or mixed boolean tree; FHIR enableWhen carries one flat clause list.',
      },
    ]);
  });

  it('names a gap nested inside a combinator, rather than merging half a tree', () => {
    const disjunction: ConditionNode = {
      kind: 'any',
      of: [
        { kind: 'compare', field: 'gate', operator: 'equals', value: true },
        { kind: 'presence', field: 'gate', operator: 'isEmpty' },
      ],
    };
    const compiled = gatedForm(
      {
        kind: 'all',
        of: [{ kind: 'all', of: [disjunction, disjunction] }],
      },
      'show',
      booleanGate
    );
    expect(itemFor(compiled, 'target').enableWhen).toBeUndefined();
    expect(compiled.questionnaireGaps[0]?.kind).toBe('conditionNotRepresentable');
  });

  it('names a mix of behaviours across two rules as a gap', () => {
    const compiled = compileOrThrow(
      formOf([
        booleanGate,
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'show',
              when: {
                kind: 'any',
                of: [
                  { kind: 'compare', field: 'gate', operator: 'equals', value: true },
                  { kind: 'presence', field: 'gate', operator: 'isEmpty' },
                ],
              },
            },
            { effect: 'show', when: { kind: 'presence', field: 'gate', operator: 'isNotEmpty' } },
          ],
        },
      ])
    );
    expect(compiled.questionnaireGaps[0]?.kind).toBe('conditionNotRepresentable');
  });

  it('names a conditional requirement as a gap, since FHIR cannot carry one', () => {
    const compiled = gatedForm(
      { kind: 'compare', field: 'gate', operator: 'equals', value: true },
      'show',
      booleanGate
    );
    const withRequire = compileOrThrow(
      formOf([
        booleanGate,
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'require',
              when: { kind: 'compare', field: 'gate', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    expect(compiled.questionnaireGaps).toStrictEqual([]);
    expect(withRequire.questionnaireGaps).toStrictEqual([
      {
        kind: 'conditionalRequirement',
        fieldKey: 'target',
        reason: 'FHIR Questionnaire has no representation for a conditionally required item.',
      },
    ]);
    expect(itemFor(withRequire, 'target').enableWhen).toBeUndefined();
  });
});

const completeIntake: FormValues = {
  preferred_name: 'Testina Patientsson',
  reason_for_visit: 'Annual review',
  weight: 71.5,
  children: 2,
  last_tetanus: '2019-04-12',
  symptom_onset: '2026-08-01T09:30:00.000Z',
  smoking: 'never',
  symptoms: ['cough', 'fever'],
  pregnant: false,
  pain: 3,
  primary_problem: { code: 'E11.9', system: 'http://hl7.org/fhir/sid/icd-10-cm' },
  insurance_card: 'object://cards/2f1c',
  consent_signature: 'object://signatures/2f1c',
  med_name: ['Cardiozine', 'Pulmovex'],
  med_dose: [500, null],
  med_prn: [false, true],
};

describe('QuestionnaireResponse', () => {
  const response = toQuestionnaireResponse(intake, {
    values: completeIntake,
    status: 'COMPLETED',
    authored: '2026-08-13T10:00:00.000Z',
    subjectReference: 'Patient/8f2c1d64-0000-4000-8000-000000000001',
  });

  it('points at the exact questionnaire version it answers', () => {
    expect(response.questionnaire).toBe('https://openrunic.org/fhir/Questionnaire/adult_intake|3');
    expect(response.status).toBe('completed');
    expect(response.authored).toBe('2026-08-13T10:00:00.000Z');
    expect(response.subject).toStrictEqual({
      reference: 'Patient/8f2c1d64-0000-4000-8000-000000000001',
    });
  });

  it('answers only fields that carry an answer, and repeats a group per repetition', () => {
    expect(response.item.map((item) => item.linkId)).toStrictEqual([
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
      'medications',
    ]);
  });

  it('uses the FHIR element that matches each field type', () => {
    const answerFor = (linkId: string): unknown =>
      response.item.find((item) => item.linkId === linkId)?.answer?.[0];
    expect(answerFor('preferred_name')).toStrictEqual({ valueString: 'Testina Patientsson' });
    expect(answerFor('weight')).toStrictEqual({
      valueQuantity: {
        value: 71.5,
        unit: 'kg',
        system: 'http://unitsofmeasure.org',
        code: 'kg',
      },
    });
    expect(answerFor('children')).toStrictEqual({ valueDecimal: 2 });
    expect(answerFor('last_tetanus')).toStrictEqual({ valueDate: '2019-04-12' });
    expect(answerFor('symptom_onset')).toStrictEqual({
      valueDateTime: '2026-08-01T09:30:00.000Z',
    });
    expect(answerFor('pregnant')).toStrictEqual({ valueBoolean: false });
    expect(answerFor('pain')).toStrictEqual({ valueInteger: 3 });
    expect(answerFor('primary_problem')).toStrictEqual({
      valueCoding: { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' },
    });
    expect(answerFor('consent_signature')).toStrictEqual({
      valueAttachment: { url: 'object://signatures/2f1c' },
    });
  });

  it('emits one answer per selection for a multi-select', () => {
    const symptoms = response.item.find((item) => item.linkId === 'symptoms');
    expect(symptoms?.answer).toStrictEqual([{ valueString: 'cough' }, { valueString: 'fever' }]);
  });

  it('skips a child a repetition left blank rather than answering it with null', () => {
    const repetitions = response.item.filter((item) => item.linkId === 'medications');
    expect(repetitions[0]?.item?.map((child) => child.linkId)).toStrictEqual([
      'med_name',
      'med_dose',
      'med_prn',
    ]);
    expect(repetitions[1]?.item?.map((child) => child.linkId)).toStrictEqual([
      'med_name',
      'med_prn',
    ]);
  });

  it('round trips back to the exact document it came from', () => {
    const restored = fromQuestionnaireResponse(intake, response);
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(restored.value).toStrictEqual(completeIntake);
  });

  it('maps every submission status, defaulting to completed', () => {
    const statusOf = (status: Parameters<typeof toQuestionnaireResponse>[1]['status']): string =>
      toQuestionnaireResponse(intake, { values: {}, status }).status;
    expect(statusOf('IN_PROGRESS')).toBe('in-progress');
    expect(statusOf('COMPLETED')).toBe('completed');
    expect(statusOf('SIGNED')).toBe('completed');
    expect(statusOf('AMENDED')).toBe('amended');
    expect(statusOf('ENTERED_IN_ERROR')).toBe('entered-in-error');
    expect(statusOf(undefined)).toBe('completed');
  });

  it('exports answers to fields the conditions hide, since it copies the document', () => {
    const branching = compileOrThrow(
      formOf([
        booleanGate,
        {
          type: 'shortText',
          key: 'target',
          label: 'Target',
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'gate', operator: 'equals', value: true },
            },
          ],
        },
      ])
    );
    const exported = toQuestionnaireResponse(branching, {
      values: { gate: false, target: 'retained' },
    });
    expect(exported.item.map((item) => item.linkId)).toStrictEqual(['gate', 'target']);
  });

  it('omits an answer whose stored shape does not match its field', () => {
    const exported = toQuestionnaireResponse(intake, {
      values: {
        about_you: 'a heading carries no answer',
        preferred_name: 7,
        weight: 'heavy',
        children: 'two',
        last_tetanus: 2019,
        symptom_onset: 2026,
        pregnant: 'yes',
        pain: 'a lot',
        consent_signature: 3,
        symptoms: [],
        primary_problem: 'E11.9',
      },
    });
    expect(exported.item).toStrictEqual([]);
  });

  it('omits a coded answer that carries no code', () => {
    const exported = toQuestionnaireResponse(intake, {
      values: { primary_problem: { display: 'Asthma' } },
    });
    expect(exported.item).toStrictEqual([]);
  });
});

describe('fromQuestionnaireResponse', () => {
  const base = toQuestionnaireResponse(intake, { values: completeIntake });

  it('refuses a response that answers a different questionnaire', () => {
    const foreign: QuestionnaireResponse = {
      ...base,
      questionnaire: 'https://openrunic.org/fhir/Questionnaire/adult_intake|2',
    };
    const result = fromQuestionnaireResponse(intake, foreign);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]?.code).toBe('questionnaireMismatch');
  });

  it('refuses an item the form does not declare, at either level', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [
        { linkId: 'legacy', answer: [{ valueString: 'x' }] },
        {
          linkId: 'medications',
          item: [{ linkId: 'med_route', answer: [{ valueString: 'oral' }] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.map((error) => error.code)).toStrictEqual(['unknownField', 'unknownField']);
  });

  it('refuses an answer whose FHIR element does not fit the field', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [{ linkId: 'children', answer: [{ valueString: 'two' }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]).toMatchObject({ code: 'schemaViolation', fieldKey: 'children' });
  });

  it('refuses a bad element inside a multi-select answer list', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [{ linkId: 'symptoms', answer: [{ valueString: 'cough' }, { valueInteger: 3 }] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]).toMatchObject({ code: 'schemaViolation', fieldKey: 'symptoms' });
  });

  it('ignores display items and items carrying no answer', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [
        { linkId: 'about_you', text: 'About you' },
        { linkId: 'preferred_name', answer: [] },
        { linkId: 'smoking', answer: [{ valueString: 'former' }] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toStrictEqual({ smoking: 'former' });
  });

  it('normalizes a coded answer to carry the field binding when the resource omits it', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [{ linkId: 'primary_problem', answer: [{ valueCoding: { code: 'J45.909' } }] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.primary_problem).toStrictEqual({
      code: 'J45.909',
      system: 'http://hl7.org/fhir/sid/icd-10-cm',
    });
  });

  it('keeps a coded display when the resource states one', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [
        {
          linkId: 'primary_problem',
          answer: [{ valueCoding: { code: 'J45.909', display: 'Asthma' } }],
        },
      ],
    });
    expect(result.ok && result.value.primary_problem).toStrictEqual({
      code: 'J45.909',
      system: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Asthma',
    });
  });

  it('refuses a coding with no code at all', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [{ linkId: 'primary_problem', answer: [{ valueCoding: { display: 'Asthma' } }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('omits a repeating child that no repetition answered', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [
        { linkId: 'medications', item: [{ linkId: 'med_name', answer: [{ valueString: 'A' }] }] },
        { linkId: 'medications', item: [{ linkId: 'med_name', answer: [{ valueString: 'B' }] }] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toStrictEqual({ med_name: ['A', 'B'] });
  });

  it('reads a quantity back as the plain number the document stores', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [
        {
          linkId: 'weight',
          answer: [{ valueQuantity: { value: 80, unit: 'kg' } }],
        },
      ],
    });
    expect(result.ok && result.value.weight).toBe(80);
  });

  it('refuses a quantity item answered without a value', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [{ linkId: 'weight', answer: [{ valueDecimal: 80 }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('refuses an attachment with no url', () => {
    const result = fromQuestionnaireResponse(intake, {
      ...base,
      item: [{ linkId: 'consent_signature', answer: [{ valueAttachment: { title: 'sig' } }] }],
    });
    expect(result.ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import type { FormValues } from './definition.js';
import type { FormValidationError } from './errors.js';
import {
  branchingForm,
  compileOrThrow,
  formOf,
  intakeForm,
  medicationGroupForm,
} from './test-support/forms.js';
import { validateResponse } from './validate.js';

const intake = compileOrThrow(intakeForm);

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
  med_dose: [500, 250],
  med_prn: [false, true],
};

function errorsFor(values: FormValues): readonly FormValidationError[] {
  const result = validateResponse(intake, values);
  if (result.ok) {
    throw new Error('expected validation to fail');
  }
  return result.error;
}

describe('validateResponse', () => {
  it('accepts a complete document and hands back the state that decided it', () => {
    const result = validateResponse(intake, completeIntake);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.values).toBe(completeIntake);
    expect(result.value.fieldStates.fields.preferred_name).toStrictEqual({
      visible: true,
      required: true,
    });
    expect(result.value.fieldStates.repeats.med_name).toHaveLength(2);
  });

  it('rejects a key the definition version does not declare', () => {
    expect(errorsFor({ ...completeIntake, legacy_field: 'x' })).toStrictEqual([
      {
        code: 'unknownField',
        fieldKey: 'legacy_field',
        message: 'The document answers a field this definition version does not declare.',
      },
    ]);
  });

  it('rejects the container key of a repeating group, since answers are columnar', () => {
    const errors = errorsFor({ ...completeIntake, medications: [{ med_name: 'x' }] });
    expect(errors[0]).toMatchObject({ code: 'unknownField', fieldKey: 'medications' });
  });

  it('reports a type violation against the field that carries it', () => {
    const errors = errorsFor({ ...completeIntake, weight: 'seventy' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'schemaViolation', fieldKey: 'weight' });
  });

  it('enforces bounds, option membership and ISO date formats', () => {
    const cases: ReadonlyArray<readonly [FormValues, string]> = [
      [{ pain: 42 }, 'pain'],
      [{ children: 1.5 }, 'children'],
      [{ smoking: 'sometimes' }, 'smoking'],
      [{ last_tetanus: '12/04/2019' }, 'last_tetanus'],
      [{ symptom_onset: '2026-08-01' }, 'symptom_onset'],
      [{ preferred_name: 'x'.repeat(41) }, 'preferred_name'],
      [{ symptoms: ['cough', 'fever', 'breathless', 'cough'] }, 'symptoms'],
      [{ primary_problem: { code: 'E11.9', extra: 'no' } }, 'primary_problem'],
    ];
    for (const [override, fieldKey] of cases) {
      expect(errorsFor({ ...completeIntake, ...override })[0]).toMatchObject({
        code: 'schemaViolation',
        fieldKey,
      });
    }
  });

  it('reports a missing required field once, as a requirement rather than a shape problem', () => {
    const withoutName: Record<string, unknown> = { ...completeIntake };
    delete withoutName.preferred_name;
    expect(errorsFor(withoutName)).toStrictEqual([
      {
        code: 'requiredMissing',
        fieldKey: 'preferred_name',
        message: 'This field is required and has no answer.',
      },
    ]);
  });

  it('treats an empty string as unanswered for a required field', () => {
    expect(errorsFor({ ...completeIntake, preferred_name: '' })[0]).toMatchObject({
      code: 'requiredMissing',
      fieldKey: 'preferred_name',
    });
  });

  it('reports a missing answer inside a repetition with its index', () => {
    const errors = errorsFor({ ...completeIntake, med_name: ['Cardiozine', null] });
    expect(errors).toStrictEqual([
      {
        code: 'requiredMissing',
        fieldKey: 'med_name',
        repeatIndex: 1,
        message: 'This field is required in this repetition and has no answer.',
      },
    ]);
  });

  it('carries the repeat index on a shape problem inside a repetition', () => {
    const errors = errorsFor({ ...completeIntake, med_dose: [500, 'a lot'] });
    expect(errors[0]).toMatchObject({
      code: 'schemaViolation',
      fieldKey: 'med_dose',
      repeatIndex: 1,
    });
  });

  it('rejects a group with more repetitions than it allows', () => {
    const errors = errorsFor({
      ...completeIntake,
      med_name: ['a', 'b', 'c', 'd', 'e', 'f'],
      med_dose: [1, 2, 3, 4, 5, 6],
      med_prn: [false, false, false, false, false, false],
    });
    expect(errors[0]).toMatchObject({ code: 'repeatCountOutOfRange', fieldKey: 'medications' });
  });

  it('rejects a group with fewer repetitions than it demands', () => {
    const compiled = compileOrThrow(
      formOf([
        {
          type: 'repeatingGroup',
          key: 'contacts',
          label: 'Emergency contacts',
          minRepeats: 1,
          fields: [{ type: 'shortText', key: 'contact_name', label: 'Name' }],
        },
      ])
    );
    const result = validateResponse(compiled, {});
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]).toMatchObject({
      code: 'repeatCountOutOfRange',
      fieldKey: 'contacts',
    });
  });

  it('skips the repeat-count check for a group that is hidden', () => {
    const compiled = compileOrThrow(
      formOf([
        { type: 'boolean', key: 'has_contacts', label: 'Has contacts' },
        {
          type: 'repeatingGroup',
          key: 'contacts',
          label: 'Emergency contacts',
          minRepeats: 1,
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'has_contacts', operator: 'equals', value: true },
            },
          ],
          fields: [{ type: 'shortText', key: 'contact_name', label: 'Name' }],
        },
      ])
    );
    expect(validateResponse(compiled, { has_contacts: false }).ok).toBe(true);
    expect(validateResponse(compiled, { has_contacts: true }).ok).toBe(false);
  });
});

describe('conditional requirement', () => {
  const branching = compileOrThrow(branchingForm);

  it('demands an answer only once the branch is open', () => {
    expect(validateResponse(branching, { pregnant: false }).ok).toBe(true);

    const opened = validateResponse(branching, { pregnant: true });
    expect(opened.ok).toBe(false);
    if (opened.ok) {
      return;
    }
    expect(opened.error).toStrictEqual([
      {
        code: 'requiredMissing',
        fieldKey: 'due_date_note',
        message: 'This field is required and has no answer.',
      },
    ]);
  });

  it('discards a shape problem on an answer the conditions have hidden', () => {
    // The retained answer is the wrong type, but the branch is closed, so it
    // must not block the submission.
    const result = validateResponse(branching, { pregnant: false, due_date_note: 42 });
    expect(result.ok).toBe(true);

    const reopened = validateResponse(branching, { pregnant: true, due_date_note: 42 });
    expect(reopened.ok).toBe(false);
  });

  it('demands an answer per repetition, only in the repetitions that ask for it', () => {
    const compiled = compileOrThrow(medicationGroupForm);
    const result = validateResponse(compiled, {
      is_prn: [true, false],
      prn_reason: [null, null],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toStrictEqual([
      {
        code: 'requiredMissing',
        fieldKey: 'prn_reason',
        repeatIndex: 0,
        message: 'This field is required in this repetition and has no answer.',
      },
    ]);
  });
});

describe('promotableValues', () => {
  it('keeps every visible answer and drops the hidden ones', () => {
    const branching = compileOrThrow(branchingForm);
    const result = validateResponse(branching, {
      pregnant: false,
      due_date_note: 'Mid October',
      midwife: 'A. Okafor',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.values.due_date_note).toBe('Mid October');
    expect(result.value.promotableValues).toStrictEqual({ pregnant: false });
  });

  it('nulls out the repetitions a condition hid, keeping the columns aligned', () => {
    const compiled = compileOrThrow(medicationGroupForm);
    const result = validateResponse(compiled, {
      reviewing: false,
      is_prn: [true, false],
      prn_reason: ['Breakthrough pain', 'stale answer'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.promotableValues).toStrictEqual({
      reviewing: false,
      is_prn: [true, false],
      prn_reason: ['Breakthrough pain', null],
    });
  });

  it('carries the whole document through when nothing is hidden', () => {
    const result = validateResponse(intake, completeIntake);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.promotableValues).toStrictEqual(completeIntake);
  });
});

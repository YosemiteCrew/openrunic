import { compileDefinition } from '../compile.js';
import type { CompiledForm } from '../compiled.js';
import type { FormDefinition, FormField } from '../definition.js';
import type { FormCompileError } from '../errors.js';

/**
 * Fixtures and helpers shared by the suites. Every identity here is invented;
 * nothing in this package's tests touches real patient data.
 */

/** Compiles, or fails the test loudly with the refusals attached. */
export function compileOrThrow(definition: FormDefinition): CompiledForm {
  const result = compileDefinition(definition);
  if (!result.ok) {
    throw new Error(`expected a clean compile, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Compiles expecting failure, and returns the refusals. */
export function compileErrors(definition: FormDefinition): readonly FormCompileError[] {
  const result = compileDefinition(definition);
  if (result.ok) {
    throw new Error('expected the compiler to refuse this definition');
  }
  return result.error;
}

/** The codes reported for a definition, for terse assertions. */
export function compileErrorCodes(definition: FormDefinition): string[] {
  return compileErrors(definition).map((error) => error.code);
}

/** Wraps a list of fields into a minimal definition. */
export function formOf(fields: readonly FormField[], key = 'fixture'): FormDefinition {
  return {
    key,
    version: 1,
    title: 'Fixture form',
    bindTo: 'ENCOUNTER',
    fields,
  };
}

/** Writes through a readonly view, so a frozen-object test can assert the throw. */
export function mutate(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

/**
 * One form exercising all fifteen catalogue types, including a repeating group
 * and a promoted field of every promotable type.
 */
export const intakeForm: FormDefinition = {
  key: 'adult_intake',
  version: 3,
  title: 'Adult intake',
  description: 'Synthetic intake form, used only by this package to test itself.',
  bindTo: 'PORTAL',
  fields: [
    { type: 'sectionHeader', key: 'about_you', label: 'About you', level: 1 },
    {
      type: 'staticText',
      key: 'intro',
      label: 'Before you start',
      text: 'Answer what you can. Nothing here is compulsory unless it is marked.',
    },
    {
      type: 'shortText',
      key: 'preferred_name',
      label: 'Preferred name',
      maxLength: 40,
      placeholder: 'Testina',
      required: true,
      layout: { columnSpan: 6, density: 'compact' },
      promote: { searchable: true },
    },
    {
      type: 'longText',
      key: 'reason_for_visit',
      label: 'Reason for visit',
      rows: 4,
      maxLength: 500,
    },
    {
      type: 'number',
      key: 'weight',
      label: 'Weight',
      unit: 'kg',
      min: 0,
      max: 400,
      step: 0.1,
      promote: { graphable: true },
    },
    {
      type: 'number',
      key: 'children',
      label: 'Children in the household',
      integer: true,
      min: 0,
      max: 20,
      promote: { reportable: true },
    },
    {
      type: 'date',
      key: 'last_tetanus',
      label: 'Date of last tetanus booster',
      promote: { graphable: true },
    },
    {
      type: 'datetime',
      key: 'symptom_onset',
      label: 'When the symptoms started',
      promote: { graphable: true },
    },
    {
      type: 'singleSelect',
      key: 'smoking',
      label: 'Smoking status',
      options: [
        { value: 'never', label: 'Never smoked' },
        { value: 'former', label: 'Former smoker' },
        { value: 'current', label: 'Current smoker' },
      ],
      promote: { searchable: true },
    },
    {
      type: 'multiSelect',
      key: 'symptoms',
      label: 'Symptoms in the last week',
      options: [
        { value: 'cough', label: 'Cough' },
        { value: 'fever', label: 'Fever' },
        { value: 'breathless', label: 'Shortness of breath' },
      ],
      maxSelected: 3,
      promote: { searchable: true },
    },
    {
      type: 'boolean',
      key: 'pregnant',
      label: 'Currently pregnant',
      promote: { searchable: true },
    },
    {
      type: 'scale',
      key: 'pain',
      label: 'Pain right now',
      min: 0,
      max: 10,
      minLabel: 'None',
      maxLabel: 'Worst imaginable',
      promote: { graphable: true },
    },
    {
      type: 'codedValue',
      key: 'primary_problem',
      label: 'Primary problem',
      system: 'http://hl7.org/fhir/sid/icd-10-cm',
      valueSet: 'https://openrunic.org/fhir/ValueSet/intake-problems',
      options: [
        { value: 'E11.9', label: 'Type 2 diabetes mellitus without complications' },
        { value: 'J45.909', label: 'Unspecified asthma, uncomplicated' },
      ],
      promote: { graphable: true },
    },
    {
      type: 'fileReference',
      key: 'insurance_card',
      label: 'Photo of your insurance card',
      accept: ['image/png', 'image/jpeg'],
    },
    {
      type: 'signature',
      key: 'consent_signature',
      label: 'Your signature',
      signerRole: 'patient',
      layout: { pageBreakBefore: true },
    },
    {
      type: 'repeatingGroup',
      key: 'medications',
      label: 'Current medications',
      minRepeats: 0,
      maxRepeats: 5,
      fields: [
        {
          type: 'shortText',
          key: 'med_name',
          label: 'Medication',
          required: true,
          promote: { searchable: true },
        },
        {
          type: 'number',
          key: 'med_dose',
          label: 'Dose',
          unit: 'mg',
          promote: { graphable: true },
        },
        { type: 'boolean', key: 'med_prn', label: 'Taken as needed' },
      ],
    },
  ],
};

/**
 * A branching form. `pregnant` gates a follow-up, which in turn gates a third
 * field, which is what makes evaluation order observable.
 */
export const branchingForm: FormDefinition = formOf(
  [
    { type: 'boolean', key: 'pregnant', label: 'Currently pregnant' },
    {
      type: 'shortText',
      key: 'due_date_note',
      label: 'Expected due date',
      required: true,
      conditions: [
        {
          effect: 'show',
          when: { kind: 'compare', field: 'pregnant', operator: 'equals', value: true },
        },
      ],
    },
    {
      type: 'shortText',
      key: 'midwife',
      label: 'Midwife',
      conditions: [
        {
          effect: 'show',
          when: { kind: 'presence', field: 'due_date_note', operator: 'isNotEmpty' },
        },
      ],
    },
  ],
  'branching'
);

/**
 * The same three fields, declared so that a condition points at a field
 * declared after it. Compilation must reorder rather than refuse.
 */
export const forwardReferenceForm: FormDefinition = formOf(
  [
    {
      type: 'shortText',
      key: 'midwife',
      label: 'Midwife',
      conditions: [
        {
          effect: 'show',
          when: { kind: 'presence', field: 'due_date_note', operator: 'isNotEmpty' },
        },
      ],
    },
    {
      type: 'shortText',
      key: 'due_date_note',
      label: 'Expected due date',
      conditions: [
        {
          effect: 'show',
          when: { kind: 'compare', field: 'pregnant', operator: 'equals', value: true },
        },
      ],
    },
    { type: 'boolean', key: 'pregnant', label: 'Currently pregnant' },
  ],
  'forward_reference'
);

/** A repeating group whose child conditions resolve within their own repetition. */
export const medicationGroupForm: FormDefinition = formOf(
  [
    { type: 'boolean', key: 'reviewing', label: 'Reviewing medications' },
    {
      type: 'repeatingGroup',
      key: 'meds',
      label: 'Medications',
      fields: [
        { type: 'boolean', key: 'is_prn', label: 'As needed' },
        {
          type: 'shortText',
          key: 'prn_reason',
          label: 'Reason it is taken as needed',
          required: true,
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'is_prn', operator: 'equals', value: true },
            },
          ],
        },
        {
          type: 'shortText',
          key: 'reviewer_note',
          label: 'Reviewer note',
          conditions: [
            {
              effect: 'show',
              when: { kind: 'compare', field: 'reviewing', operator: 'equals', value: true },
            },
          ],
        },
      ],
    },
  ],
  'medication_group'
);

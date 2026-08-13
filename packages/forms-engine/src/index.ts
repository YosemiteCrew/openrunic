/**
 * `@openrunic/forms-engine`: the runtime behind Openrunic's no-code forms.
 *
 * A form is authored as data, compiled once when it is published, and then run
 * unchanged by the server, the browser, the printer and the FHIR API. This
 * module is the whole public surface; everything else is an implementation
 * detail, and `api-surface.test.ts` fails the build if that stops being true.
 *
 * The usual path through it:
 *
 *   publishDefinition(draft)          -> a frozen definition + its artifacts
 *   evaluateConditions(compiled, v)   -> what to draw, per field and repetition
 *   validateResponse(compiled, v)     -> accept or refuse, with promotableValues
 *   promote(compiled, promotable)     -> the indexed projection
 *   toQuestionnaireResponse(...)      -> the same answers, as FHIR
 */

// --- The definition model ---------------------------------------------------

export {
  ANSWERABLE_FIELD_TYPES,
  CONDITION_EFFECTS,
  CONDITION_OPERATORS,
  FIELD_TYPES,
  FORM_BINDINGS,
  FORM_STATUSES,
  FORM_SUBMISSION_STATUSES,
  PRESENTATION_FIELD_TYPES,
  isAnswerableFieldType,
} from './definition.js';
export type {
  AnswerableField,
  AnswerableFieldType,
  BooleanField,
  CodedAnswer,
  CodedValueField,
  ConditionEffect,
  ConditionLeaf,
  ConditionNode,
  ConditionOperator,
  ConditionScalar,
  DateField,
  DateTimeField,
  DensityHint,
  FieldLayout,
  FieldType,
  FileReferenceField,
  FormBinding,
  FormConditionRule,
  FormDefinition,
  FormField,
  FormStatus,
  FormSubmissionStatus,
  FormValues,
  LongTextField,
  MultiSelectField,
  NumberField,
  PresentationField,
  PresentationFieldType,
  PromotionFlags,
  RepeatingGroupField,
  ScaleField,
  SectionHeaderField,
  SelectOption,
  ShortTextField,
  SignatureField,
  SingleSelectField,
  StaticTextField,
} from './definition.js';

// --- Errors -----------------------------------------------------------------

export type { FormCompileError, FormPromotionError, FormValidationError } from './errors.js';

// --- Compile, publish, version ----------------------------------------------

export { compileDefinition } from './compile.js';
export { definitionContentHash } from './canonical.js';
export { assertPublishable, publishDefinition } from './publish.js';
export type { PublishedFormDefinition, PublishedVersionRecord } from './publish.js';
export type {
  CompileOptions,
  CompiledCondition,
  CompiledField,
  CompiledForm,
  FieldState,
  FieldStateMap,
  FormValuesSchema,
} from './compiled.js';

// --- Conditions and validation ----------------------------------------------

export { evaluateConditions, fieldStateFor } from './conditions.js';
export { validateResponse } from './validate.js';
export type { ValidatedResponse } from './validate.js';

// --- Render and print artifacts ---------------------------------------------

export { RENDER_GRID_COLUMNS } from './render-tree.js';
export type {
  RenderFieldNode,
  RenderGroupNode,
  RenderLayout,
  RenderNode,
  RenderTree,
} from './render-tree.js';
export type {
  PrintBlock,
  PrintHeadingBlock,
  PrintLayout,
  PrintPageBreakBlock,
  PrintParagraphBlock,
  PrintRepeatTableBlock,
  PrintSignatureBlock,
  PrintTableColumn,
  PrintValueSlotBlock,
  PrintValueStyle,
} from './print-layout.js';

// --- FHIR ------------------------------------------------------------------

export {
  DEFAULT_QUESTIONNAIRE_BASE_URL,
  UCUM_SYSTEM,
  fromQuestionnaireResponse,
  toQuestionnaireResponse,
} from './questionnaire.js';
export type {
  FhirAttachment,
  FhirCoding,
  FhirQuantity,
  FormSubmissionView,
  Questionnaire,
  QuestionnaireAnswerOption,
  QuestionnaireEnableOperator,
  QuestionnaireEnableWhen,
  QuestionnaireGap,
  QuestionnaireItem,
  QuestionnaireItemType,
  QuestionnaireResponse,
  QuestionnaireResponseAnswer,
  QuestionnaireResponseItem,
  QuestionnaireResponseStatus,
  QuestionnaireStatus,
} from './questionnaire.js';

// --- Promotion --------------------------------------------------------------

export {
  PROMOTED_FIELD_TYPES,
  isPromoted,
  promote,
  promotedFieldTypeFor,
  toPromotionManifest,
} from './promotion.js';
export type {
  PromotedFieldSpec,
  PromotedFieldType,
  PromotedValue,
  PromotionManifest,
} from './promotion.js';

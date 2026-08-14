/**
 * The form-definition model: a fixed field-type catalogue plus a closed,
 * declarative condition grammar.
 *
 * Everything in this file is data. That is the point of the whole package. A
 * form is authored by a practice administrator in a builder UI, stored as JSON,
 * and executed on both the server and the patient's browser. If a definition
 * could carry an expression string or a callback, then "add a field to the
 * intake form" would become "deploy code into every tenant", and the engine
 * would have to sandbox something. It cannot, so it does not: the catalogue is
 * closed, the operators are enumerated, and the worst a malicious definition
 * can do is describe a form nobody wants to fill in.
 *
 * The catalogue is deliberately small. Fifteen types cover the core clinical
 * form library (SOAP, vitals, review of systems, care plan, screening
 * instruments, intake, consent) because those forms are overwhelmingly made of
 * the same handful of controls. A sixteenth type is a product decision, not a
 * shortcut, and it costs a compiler branch, a zod element, a render node, a
 * print block, a Questionnaire item type and a promotion mapping.
 */

/** Types that carry an answer and therefore appear in the submitted document. */
export const ANSWERABLE_FIELD_TYPES = [
  'shortText',
  'longText',
  'number',
  'date',
  'datetime',
  'singleSelect',
  'multiSelect',
  'boolean',
  'scale',
  'signature',
  'fileReference',
  'codedValue',
] as const;

/**
 * Types that exist only to shape the page. They never reach the zod schema, the
 * QuestionnaireResponse or the promotion manifest, because a heading is not an
 * answer and storing it as one would corrupt every "how many questions did the
 * patient complete" count in the product.
 */
export const PRESENTATION_FIELD_TYPES = ['sectionHeader', 'staticText'] as const;

/** The full catalogue: answerable types, presentation types, and the one container. */
export const FIELD_TYPES = [
  ...ANSWERABLE_FIELD_TYPES,
  ...PRESENTATION_FIELD_TYPES,
  'repeatingGroup',
] as const;

export type AnswerableFieldType = (typeof ANSWERABLE_FIELD_TYPES)[number];
export type PresentationFieldType = (typeof PRESENTATION_FIELD_TYPES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Narrows a catalogue member to the answerable subset. Exported because every
 * consumer that walks a definition needs the same question answered the same
 * way, and a hand-rolled `type !== 'sectionHeader'` check in a caller is how
 * presentation fields end up in a flowsheet.
 */
export function isAnswerableFieldType(type: FieldType): type is AnswerableFieldType {
  return (ANSWERABLE_FIELD_TYPES as readonly string[]).includes(type);
}

/**
 * Row height preference for a field, resolved against the tenant's density
 * setting by the renderer. Carried on the field rather than computed at render
 * time so a print layout and a screen layout agree without sharing CSS.
 */
export type DensityHint = 'comfortable' | 'compact';

/** Layout hints. Advisory: a renderer on a narrow viewport may ignore the span. */
export interface FieldLayout {
  /** Columns out of twelve. Clamped by the compiler, never trusted raw. */
  readonly columnSpan?: number;
  readonly density?: DensityHint;
  /** Starts a new printed page before this field, for consent signature pages. */
  readonly pageBreakBefore?: boolean;
}

/**
 * Why an author wants a field indexed. All three flags mean the same thing to
 * the compiler (emit a promotion manifest entry), but they are kept separate
 * because they answer different product questions later: which fields to offer
 * in the chart grapher, which to expose in patient search, which to expose in
 * the report builder.
 */
export interface PromotionFlags {
  readonly graphable?: boolean;
  readonly searchable?: boolean;
  readonly reportable?: boolean;
}

/** One choice in a select. `value` is what lands in the submitted document. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface FieldCommon {
  /** Unique within the whole definition, including inside repeating groups. */
  readonly key: string;
  readonly label: string;
  readonly helpText?: string;
  readonly layout?: FieldLayout;
  readonly conditions?: readonly FormConditionRule[];
}

interface AnswerableCommon extends FieldCommon {
  /**
   * The base requirement, before conditions. A `require` or `optional` rule can
   * move it at runtime; see {@link FormConditionRule}.
   */
  readonly required?: boolean;
  readonly promote?: PromotionFlags;
}

/** Single-line free text. */
export interface ShortTextField extends AnswerableCommon {
  readonly type: 'shortText';
  readonly maxLength?: number;
  readonly placeholder?: string;
}

/** Multi-line free text, the narrative body of a SOAP note or a comment box. */
export interface LongTextField extends AnswerableCommon {
  readonly type: 'longText';
  readonly maxLength?: number;
  readonly rows?: number;
}

/**
 * A number, optionally carrying a unit, which makes it a quantity. The unit
 * lives on the definition rather than in each answer so that a flowsheet can
 * label an axis without reading a single submission, and so that two answers to
 * the same field can never disagree about what they measure.
 */
export interface NumberField extends AnswerableCommon {
  readonly type: 'number';
  /** UCUM code, e.g. `mm[Hg]` or `kg`. Presence is what makes this a quantity. */
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly integer?: boolean;
}

/** Calendar date with no time, e.g. a date of last tetanus booster. */
export interface DateField extends AnswerableCommon {
  readonly type: 'date';
}

/** An instant. Requires an explicit offset so a chart never guesses a timezone. */
export interface DateTimeField extends AnswerableCommon {
  readonly type: 'datetime';
}

/** Pick one from a closed list authored on the form. */
export interface SingleSelectField extends AnswerableCommon {
  readonly type: 'singleSelect';
  readonly options: readonly SelectOption[];
}

/**
 * Pick any number from a closed list. The answer is a list, which is why a
 * promoted multi-select becomes one indexed row per selection rather than a
 * comma-joined string: "every patient who ticked shortness of breath" has to be
 * an index scan, not a `LIKE '%'` over free text.
 */
export interface MultiSelectField extends AnswerableCommon {
  readonly type: 'multiSelect';
  readonly options: readonly SelectOption[];
  readonly minSelected?: number;
  readonly maxSelected?: number;
}

/** A yes/no answer. Distinct from a two-option select so print renders a tick box. */
export interface BooleanField extends AnswerableCommon {
  readonly type: 'boolean';
}

/**
 * A bounded integer scale: pain 0-10, PHQ-9 item 0-3, a Likert row. Integer by
 * construction, because every validated instrument that scores by summation
 * assumes it, and a fractional PHQ-9 answer would silently break the total.
 */
export interface ScaleField extends AnswerableCommon {
  readonly type: 'scale';
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly minLabel?: string;
  readonly maxLabel?: string;
}

/**
 * A captured signature. The answer is an opaque handle to the stored image, not
 * the image itself, so a consent form does not put a megabyte of base64 into a
 * JSONB column that the chart timeline reads on every open.
 */
export interface SignatureField extends AnswerableCommon {
  readonly type: 'signature';
  /** Who is expected to sign, e.g. `patient`, `guardian`, `witness`. */
  readonly signerRole?: string;
}

/** A handle to an uploaded document, held the same way and for the same reason. */
export interface FileReferenceField extends AnswerableCommon {
  readonly type: 'fileReference';
  /** Advisory MIME hints for the picker. Enforcement lives in the upload service. */
  readonly accept?: readonly string[];
}

/**
 * An answer drawn from a terminology system rather than from a list somebody
 * typed. The bound `system` matches `TerminologyCode.system`, which is what
 * makes a promoted answer resolvable to display text later, and what lets the
 * same answer leave the building as a FHIR Coding rather than a bare string.
 */
export interface CodedValueField extends AnswerableCommon {
  readonly type: 'codedValue';
  /** Canonical system URI, e.g. `http://loinc.org`. Required, checked at compile. */
  readonly system: string;
  /** Optional canonical value-set URI narrowing the system to a usable subset. */
  readonly valueSet?: string;
  /** A pre-expanded subset, when the value set is small enough to inline. */
  readonly options?: readonly SelectOption[];
}

/** A heading. Carries no answer. */
export interface SectionHeaderField extends FieldCommon {
  readonly type: 'sectionHeader';
  readonly level?: 1 | 2 | 3;
}

/** Instructions, a legal paragraph, a consent body. Carries no answer. */
export interface StaticTextField extends FieldCommon {
  readonly type: 'staticText';
  readonly text: string;
}

/**
 * A block of fields the respondent can repeat: current medications, prior
 * surgeries, household members.
 *
 * Exactly one level deep. A group may not contain another group, and the
 * compiler rejects it. Two levels would make `repeatIndex` a path rather than
 * an integer, and every promoted row, every FHIR linkId and every print table
 * would have to grow a coordinate system to match. The forms that seem to want
 * two levels almost always want two separate groups.
 */
export interface RepeatingGroupField extends FieldCommon {
  readonly type: 'repeatingGroup';
  readonly minRepeats?: number;
  readonly maxRepeats?: number;
  /** Typed loosely enough to express a nested group, so the compiler can reject it. */
  readonly fields: readonly FormField[];
}

export type AnswerableField =
  | ShortTextField
  | LongTextField
  | NumberField
  | DateField
  | DateTimeField
  | SingleSelectField
  | MultiSelectField
  | BooleanField
  | ScaleField
  | SignatureField
  | FileReferenceField
  | CodedValueField;

export type PresentationField = SectionHeaderField | StaticTextField;

export type FormField = AnswerableField | PresentationField | RepeatingGroupField;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** The only answer shapes a condition may compare against. */
export type ConditionScalar = string | number | boolean;

/** The ten leaf tests. Enumerated so the grammar can never grow an escape hatch. */
export const CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'isEmpty',
  'isNotEmpty',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/**
 * A single test against another field's answer.
 *
 * Split into four shapes rather than one shape with an optional payload, so
 * that "an `in` test with no list" and "an `isEmpty` test with a stray value"
 * are type errors rather than compiler checks nobody wrote.
 *
 * Comparison rules, which are total and have no implicit coercion:
 *
 *   1. When the answer is a list (a multi-select), `equals` and `in` test
 *      membership. That is what an author means by "show if hypertension was
 *      ticked", and the alternative is a grammar with a separate `contains`.
 *   2. When the answer is a coded value, comparison is against its `code`.
 *   3. Ordering compares two numbers numerically, or two strings
 *      lexicographically, which is chronological for ISO-8601 dates. A mixed
 *      pair is never ordered and the test is false.
 */
export type ConditionLeaf =
  | {
      readonly kind: 'compare';
      readonly field: string;
      readonly operator: 'equals' | 'notEquals';
      readonly value: ConditionScalar;
    }
  | {
      readonly kind: 'membership';
      readonly field: string;
      readonly operator: 'in' | 'notIn';
      readonly values: readonly ConditionScalar[];
    }
  | {
      readonly kind: 'ordering';
      readonly field: string;
      readonly operator: 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';
      readonly value: number | string;
    }
  | {
      readonly kind: 'presence';
      readonly field: string;
      readonly operator: 'isEmpty' | 'isNotEmpty';
    };

/**
 * A boolean tree over leaf tests. Three combinators, no negation of anything
 * except a subtree, and no recursion into anything but itself. A definition is
 * therefore a finite tree, and evaluating it terminates by structural induction
 * rather than by a step budget.
 */
export type ConditionNode =
  | ConditionLeaf
  | { readonly kind: 'all'; readonly of: readonly ConditionNode[] }
  | { readonly kind: 'any'; readonly of: readonly ConditionNode[] }
  | { readonly kind: 'not'; readonly of: ConditionNode };

/** What a satisfied condition does to the field that declares it. */
export const CONDITION_EFFECTS = ['show', 'hide', 'require', 'optional'] as const;

export type ConditionEffect = (typeof CONDITION_EFFECTS)[number];

/**
 * One rule on one field.
 *
 * Resolution is deliberately order-insensitive for visibility and
 * order-sensitive for requirement, because those are the two behaviours authors
 * actually expect:
 *
 *   1. `show` rules conjoin. The field is visible only if every `show` rule is
 *      satisfied, so adding a second `show` narrows rather than widens.
 *   2. `hide` rules disjoin and win. Any satisfied `hide` hides the field.
 *   3. `require` and `optional` apply in declaration order, last satisfied rule
 *      wins, so an author can write a broad `require` followed by a narrow
 *      `optional` carve-out and read the result top to bottom.
 *   4. A hidden field is never required, whatever its rules say.
 */
export interface FormConditionRule {
  readonly effect: ConditionEffect;
  readonly when: ConditionNode;
}

// ---------------------------------------------------------------------------
// The definition document
// ---------------------------------------------------------------------------

/** The four consumers of one engine, mirroring the `FormBinding` enum. */
export const FORM_BINDINGS = ['PATIENT', 'ENCOUNTER', 'PORTAL', 'REFERRAL'] as const;
export type FormBinding = (typeof FORM_BINDINGS)[number];

/** Mirrors the `FormStatus` enum. A definition is only immutable once PUBLISHED. */
export const FORM_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

/** Mirrors the `FormSubmissionStatus` enum, so callers need not restate it. */
export const FORM_SUBMISSION_STATUSES = [
  'IN_PROGRESS',
  'COMPLETED',
  'SIGNED',
  'AMENDED',
  'ENTERED_IN_ERROR',
] as const;
export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

/**
 * The authored document. `(key, version)` is the identity: a published version
 * is never edited, it is superseded by the next version, so a submission taken
 * three years ago still validates against exactly the form the patient saw.
 */
export interface FormDefinition {
  readonly key: string;
  readonly version: number;
  readonly title: string;
  readonly description?: string;
  readonly bindTo: FormBinding;
  readonly fields: readonly FormField[];
}

/**
 * A submitted document: one flat JSON object, one key per answerable field.
 *
 * Answers to fields inside a repeating group are stored columnar, as an array
 * with one entry per repetition, rather than as an array of row objects. That
 * is not an aesthetic choice. It makes `repeatIndex` in a promoted row equal to
 * the array index in this document, so a promoted value can always be traced
 * back to its JSON path without a join or a scan, and it is the shape the
 * database package's promotion executor reads.
 *
 * The number of repetitions is the longest of a group's children's arrays. An
 * empty repetition is therefore an explicit `null` at that index, not a gap.
 */
export type FormValues = Readonly<Record<string, unknown>>;

/**
 * The answer shape of a {@link CodedValueField}. `system` may be omitted, in
 * which case the field's binding supplies it; a value set that spans systems is
 * the reason it can be present at all.
 */
export interface CodedAnswer {
  readonly code: string;
  readonly system?: string;
  readonly display?: string;
}

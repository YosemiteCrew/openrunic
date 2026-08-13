import type { ZodType } from 'zod';

import type {
  ConditionEffect,
  ConditionNode,
  FieldType,
  FormDefinition,
  FormField,
} from './definition.js';
import type { PrintLayout } from './print-layout.js';
import type { PromotionManifest } from './promotion.js';
import type { Questionnaire, QuestionnaireGap } from './questionnaire.js';
import type { RenderTree } from './render-tree.js';

/**
 * The output of the compiler: everything the rest of the product needs to run a
 * form, produced once, at publish time.
 *
 * "Once" is the load-bearing word. A busy practice renders the same intake form
 * a few hundred times a day and validates it as many times again. Deriving a
 * zod schema, a render tree, a print layout, a Questionnaire and a promotion
 * manifest on every one of those requests would spend real CPU re-deriving
 * artifacts that cannot have changed, because the definition they come from is
 * immutable. Worse, it would make "does this form validate" depend on the
 * engine version that happened to answer the request, so a deploy could quietly
 * start rejecting submissions that were fine an hour earlier. Compiling at
 * publish pins the answer to the definition instead.
 */

/**
 * A single field, flattened out of the definition tree with the facts every
 * later stage needs: where it sits, whether it carries an answer, and which
 * conditions govern it. Callers walk this list rather than re-walking the
 * definition, so the "is this inside a repeating group" question is answered in
 * exactly one place.
 */
export interface CompiledField {
  readonly key: string;
  readonly type: FieldType;
  readonly label: string;
  /** The repeating group this field belongs to, absent when it is top level. */
  readonly groupKey?: string;
  /** False for headings, static text and the group container itself. */
  readonly answerable: boolean;
  /** The base requirement, before conditions. Always false when not answerable. */
  readonly required: boolean;
  readonly conditions: readonly CompiledCondition[];
  /** The source field, kept so builders can narrow on `type` without a lookup. */
  readonly field: FormField;
}

/**
 * A condition with a compiler-assigned identity and its resolved dependencies.
 *
 * The id is derived (`<fieldKey>#<ordinal>`) rather than authored. Authored ids
 * would need a uniqueness check, a migration story when an author reorders
 * rules, and a way to report a collision; derived ids are unique by
 * construction and stable for as long as the rule list is, which is forever,
 * because the definition is immutable once published.
 */
export interface CompiledCondition {
  readonly id: string;
  /** The field whose visibility or requirement this rule moves. */
  readonly fieldKey: string;
  readonly effect: ConditionEffect;
  readonly when: ConditionNode;
  /** Every field key read by `when`, deduplicated, in first-seen order. */
  readonly dependsOn: readonly string[];
}

/**
 * The generated validator for a submission's `values` document.
 *
 * Typed as a plain record rather than a per-form inferred shape on purpose: the
 * shape is a runtime fact about a row in the database, so no static type can
 * describe it without the definition being a literal in the source, which is
 * exactly the situation this package exists to avoid.
 */
export type FormValuesSchema = ZodType<Record<string, unknown>>;

/** Knobs that affect the emitted artifacts but never the definition's identity. */
export interface CompileOptions {
  /**
   * Canonical base for the emitted `Questionnaire.url`. Self-hosted
   * deployments publish under their own canonical base, and a resource that
   * claims someone else's canonical URL is a resource nobody can resolve.
   */
  readonly baseUrl?: string;
  /**
   * `Questionnaire.status`. Defaults to `active`, because the overwhelmingly
   * common caller is a publish, but a builder previewing a draft should say so.
   */
  readonly status?: 'draft' | 'active' | 'retired';
}

/** Everything the compiler produces for one definition. */
export interface CompiledForm {
  readonly key: string;
  readonly version: number;
  /** The source definition, deep-frozen. */
  readonly definition: FormDefinition;
  /** Every field, in document order, groups followed by their children. */
  readonly fields: readonly CompiledField[];
  readonly conditions: readonly CompiledCondition[];
  /**
   * A topological order over field keys, computed once here so that
   * {@link evaluateConditions} is a single pass that never reads a state which
   * has not settled. See that function for the guarantees this buys.
   */
  readonly evaluationOrder: readonly string[];
  readonly schema: FormValuesSchema;
  readonly renderTree: RenderTree;
  readonly printLayout: PrintLayout;
  readonly questionnaire: Questionnaire;
  /**
   * What the Questionnaire mapping could not carry, stated out loud.
   *
   * FHIR's `enableWhen` is a flat list joined by a single behaviour, so it
   * cannot express a nested boolean tree, and it has no notion of a conditional
   * requirement at all. Silently dropping either would make an exported
   * Questionnaire look complete while behaving differently from the form the
   * patient actually saw. Listing the gaps lets a caller warn, and lets a test
   * assert exactly what is lost.
   */
  readonly questionnaireGaps: readonly QuestionnaireGap[];
  readonly promotionManifest: PromotionManifest;
}

/** Whether a field is currently on screen, and whether an answer is demanded. */
export interface FieldState {
  readonly visible: boolean;
  readonly required: boolean;
}

/**
 * Resolved state for one submission.
 *
 * Two maps rather than one, because a field inside a repeating group genuinely
 * has one state per repetition: row 1 of a medication list can demand a dose
 * while row 2 does not, and collapsing that into a single entry would force the
 * UI to re-derive per-row state that this pass already computed.
 */
export interface FieldStateMap {
  /** Top-level fields and the repeating groups themselves, keyed by field key. */
  readonly fields: Readonly<Record<string, FieldState>>;
  /** Repeating-group children, keyed by field key, one entry per repetition. */
  readonly repeats: Readonly<Record<string, readonly FieldState[]>>;
}

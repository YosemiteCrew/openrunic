import type { FieldType } from './definition.js';

/**
 * Every failure this package can produce, as data.
 *
 * Nothing here is thrown. A form that will not compile is an ordinary outcome
 * of an administrator building a form, and a submission that will not validate
 * is the ordinary outcome of a patient filling one in. Both need to arrive at a
 * UI as a list attached to specific fields, and an exception can only carry the
 * first one. So the compiler and the validator return every error they find in
 * one pass, and the caller renders them all at once instead of playing
 * fix-one-reload-repeat.
 *
 * Each arm is discriminated on `code`, and `code` is the machine-readable
 * contract. `message` is a developer-facing sentence, not a localized string:
 * user-facing copy is keyed off `code` in the presentation layer, because that
 * is where the ICU catalogues live.
 */

/** Refusals from {@link compileDefinition}, {@link publishDefinition} and {@link assertPublishable}. */
export type FormCompileError =
  | {
      readonly code: 'invalidFieldKey';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'duplicateFieldKey';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'nestedRepeatingGroup';
      readonly fieldKey: string;
      readonly groupKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'emptyRepeatingGroup';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'emptyOptionList';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'duplicateOptionValue';
      readonly fieldKey: string;
      readonly optionValue: string;
      readonly message: string;
    }
  | {
      readonly code: 'invalidScaleRange';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'missingCodeSystem';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'unpromotableField';
      readonly fieldKey: string;
      readonly fieldType: FieldType;
      readonly message: string;
    }
  | {
      readonly code: 'unknownConditionField';
      readonly fieldKey: string;
      readonly referencedKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'conditionTargetHasNoAnswer';
      readonly fieldKey: string;
      readonly referencedKey: string;
      readonly referencedType: FieldType;
      readonly message: string;
    }
  | {
      readonly code: 'crossRepeatReference';
      readonly fieldKey: string;
      readonly referencedKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'emptyConditionGroup';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'conditionCycle';
      readonly fieldKey: string;
      /** The cycle as a walkable path, first key repeated at the end. */
      readonly cycle: readonly string[];
      readonly message: string;
    }
  | {
      readonly code: 'versionAlreadyPublished';
      readonly definitionKey: string;
      readonly version: number;
      readonly publishedHash: string;
      readonly draftHash: string;
      readonly message: string;
    };

/**
 * Refusals from {@link validateResponse} and {@link fromQuestionnaireResponse}.
 *
 * `repeatIndex` is present exactly when the offending answer sits inside a
 * repeating group, so a UI can put the message on the right row rather than on
 * the group.
 */
export type FormValidationError =
  | {
      readonly code: 'schemaViolation';
      readonly fieldKey: string;
      readonly repeatIndex?: number;
      readonly message: string;
    }
  | {
      readonly code: 'unknownField';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'requiredMissing';
      readonly fieldKey: string;
      readonly repeatIndex?: number;
      readonly message: string;
    }
  | {
      readonly code: 'repeatCountOutOfRange';
      readonly fieldKey: string;
      readonly message: string;
    }
  | {
      readonly code: 'questionnaireMismatch';
      readonly message: string;
    };

/**
 * Refusals from {@link promote}.
 *
 * `@openrunic/database` raises a class of the same name for the same two
 * conditions at the other end of the seam. That is deliberate: promotion can
 * fail in exactly these two ways wherever it runs, and a value that is present
 * but the wrong shape must never be dropped silently, because a hole in a
 * flowsheet reads as "not measured" rather than as "we lost it".
 */
export type FormPromotionError =
  | {
      readonly code: 'unpromotableValue';
      readonly fieldKey: string;
      readonly repeatIndex: number;
      readonly message: string;
    }
  | {
      readonly code: 'unexpectedList';
      readonly fieldKey: string;
      readonly message: string;
    };

import type { AdministrativeGender, SensitivityClass } from '@/lib/api';

/**
 * What this application calls its own patient enums, as catalogue keys.
 *
 * The words used to be derived from the enum member by `formatEnumLabel`, which
 * turned `VERY_RESTRICTED` into "Very restricted" and was correct in exactly one
 * language. A derived label cannot be translated, because there is nothing for
 * a translator to open.
 *
 * Carried as `labelKey` data rather than translated here, for two reasons. The
 * words have to be looked up per render, because the reader's language is not
 * known at module scope. And `catalogue-drift.test.ts` reads `somethingKey:`
 * out of the source, so a key that is defined nowhere fails the build instead
 * of rendering as itself in a demographics row.
 *
 * These are labels this codebase wrote for vocabularies this codebase defines
 * in `lib/api/types.ts`. A patient's name, preferred name, MRN, date of birth,
 * phone number and language tag arrive on the record already carrying their own
 * value and are never given a second one here.
 */

export const SEX_AT_BIRTH_LABELS: Record<AdministrativeGender, { labelKey: string }> = {
  FEMALE: { labelKey: 'patients.sexAtBirth.female' },
  MALE: { labelKey: 'patients.sexAtBirth.male' },
  OTHER: { labelKey: 'patients.sexAtBirth.other' },
  UNKNOWN: { labelKey: 'patients.sexAtBirth.unknown' },
};

export const SENSITIVITY_LABELS: Record<SensitivityClass, { labelKey: string }> = {
  NORMAL: { labelKey: 'patients.sensitivity.normal' },
  RESTRICTED: { labelKey: 'patients.sensitivity.restricted' },
  VERY_RESTRICTED: { labelKey: 'patients.sensitivity.veryRestricted' },
};

/**
 * The languages the registration form offers, in the order it offers them.
 *
 * A list rather than a lookup, because the order on the screen is part of the
 * answer. The BCP 47 tag is the value the record carries and never moves; only
 * the name a reader sees is looked up. The set is a practice decision rather
 * than a list of every locale that exists.
 */
export const LANGUAGE_OPTIONS: readonly { value: string; labelKey: string }[] = [
  { value: 'en-US', labelKey: 'patients.register.language.enUS' },
  { value: 'es-US', labelKey: 'patients.register.language.esUS' },
  { value: 'de-DE', labelKey: 'patients.register.language.deDE' },
  { value: 'sv-SE', labelKey: 'patients.register.language.svSE' },
];

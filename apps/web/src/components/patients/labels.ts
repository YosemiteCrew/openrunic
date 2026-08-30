import type { AdministrativeGender, SensitivityClass } from '@/lib/api';

/**
 * What this application calls two of its own patient enums, as catalogue keys.
 *
 * The API sends `FEMALE` and `RESTRICTED`. It does not send a display for
 * either, and neither enum comes from a terminology server: both are declared
 * in `apps/web/src/lib/api/types.ts` and mirrored in `packages/database`. The
 * English was being derived by `formatEnumLabel`, which turns `VERY_RESTRICTED`
 * into "Very restricted" and is correct in exactly one language. A derived
 * label cannot be translated, because there is nothing for a translator to
 * open.
 *
 * Carried as `labelKey` data rather than translated here, for the two reasons
 * `components/orders/labels.ts` gives: the reader's language is not known at
 * module scope, and `catalogue-drift.test.ts` reads `somethingKey:` out of the
 * source, so a key defined nowhere fails the build instead of rendering as
 * itself beside a patient's name.
 *
 * The distinction that decides membership here is not "did this arrive from the
 * API" - both of these did - but "who named it". A LOINC display, an ICD-10
 * title and a payer's plan name are named by somebody else and keep that name.
 * These two were named by this codebase.
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

/**
 * GENERATED. Do not edit.
 *
 * Every reference table, and the map the lookup walks.
 *
 * Rebuild: pnpm --filter @openrunic/growth run reference:build
 */

import { weightForAgeInfant } from './weightForAgeInfant.js';
import { lengthForAgeInfant } from './lengthForAgeInfant.js';
import { headCircumferenceForAgeInfant } from './headCircumferenceForAgeInfant.js';
import { weightForLengthInfant } from './weightForLengthInfant.js';
import { weightForAge } from './weightForAge.js';
import { statureForAge } from './statureForAge.js';
import { bmiForAge } from './bmiForAge.js';

import type { LmsTable } from '../lms.js';

export const REFERENCE_TABLES: Readonly<Record<string, LmsTable>> = {
  weightForAgeInfant,
  lengthForAgeInfant,
  headCircumferenceForAgeInfant,
  weightForLengthInfant,
  weightForAge,
  statureForAge,
  bmiForAge,
};

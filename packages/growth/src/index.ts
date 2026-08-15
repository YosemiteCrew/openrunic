/**
 * Growth percentiles, from the CDC 2000 growth charts.
 *
 * The reference data is the CDC's own published LMS parameters, embedded by
 * `scripts/fetch-reference.mjs` - which downloads them, recomputes every
 * percentile the CDC publishes beside them, and refuses to write a table that
 * does not reproduce them. That is why these numbers can be trusted: not
 * because they were read carefully, but because a transcription error stops the
 * generator.
 */

export {
  CHILD_CHART_FROM_MONTHS,
  OLDEST_MONTHS,
  curveFor,
  isRefusal,
  percentileFor,
} from './growth.js';
export type { GrowthQuery, GrowthRefusal, GrowthResult, Measure } from './growth.js';
export { lmsAt, percentileOf, valueAtZ, zScore } from './lms.js';
export type { Lms, LmsRow, LmsTable, Sex } from './lms.js';
export { REFERENCE_TABLES } from './reference/index.js';

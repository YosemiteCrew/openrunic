import type { Messages } from '../../catalogue.js';

/**
 * The words the shared clinical formatters produce.
 *
 * `formatVital` in `apps/web` serves the chart summary, the record panels and
 * both results surfaces, so the range states it names are written once here
 * rather than once per screen. That is the same reason `common.ts` exists; the
 * split is that these are clinical readings and those are not.
 *
 * ## A reading is one message, not a sentence built from three
 *
 * `text` used to be assembled as value, unit and then the state label with
 * `.toLowerCase()` applied to it. Two things are wrong with that. Lowercasing a
 * label to make it fit mid-sentence is a rule about English capitalisation
 * applied to every language, and German would lose a capital its nouns require.
 * And the comma between the unit and the state is English word order: a
 * language that puts the state first cannot express that by translating the
 * fragments, because there is nowhere to say so.
 *
 * So there is one whole message per state. Four near-identical English strings
 * is the cost, and it buys a translator a sentence they can rewrite rather than
 * three pieces they must reassemble in an order the code has already fixed.
 *
 * ## Why this area has no Spanish file
 *
 * The same reason `chart.ts`, `results.ts` and the rest have none: "Above
 * range" on a lab screen is a clinical statement, and a wrong one is worse than
 * an English one a reader has to work through. `lookup` records the fallback,
 * so the coverage report names these as waiting for a Spanish-speaking
 * clinician rather than hiding them.
 */
export const clinical: Messages = {
  'clinical.range.in': 'In range',
  'clinical.range.above': 'Above range',
  'clinical.range.below': 'Below range',
  'clinical.range.none': 'No range recorded',

  'clinical.vital.reading.in': '{value} {unit}, in range',
  'clinical.vital.reading.above': '{value} {unit}, above range',
  'clinical.vital.reading.below': '{value} {unit}, below range',
  'clinical.vital.reading.none': '{value} {unit}, no range recorded',

  'clinical.vital.absent': '{label}: Not recorded',
  'clinical.vital.range': '{low} to {high} {unit}',
};

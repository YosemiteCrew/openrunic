/**
 * What a lab specimen can be. Chosen from the catalogue, never typed.
 *
 * Deliberately not in the message catalogue, and this is the reason: the picker
 * uses each string as the option's value as well as its label, so the chosen
 * one is what `DraftOrder.specimen` carries and what a signed order would be
 * transmitted with. Translating the label would translate the value, which
 * would put a Spanish string in the specimen field of a requisition going to a
 * laboratory that codes specimens in one language.
 *
 * Making these translatable means separating the code from its display first,
 * which is a specimen-terminology change rather than a wording one and belongs
 * with whoever owns that binding.
 */
export const SPECIMEN_OPTIONS = [
  'Blood, EDTA',
  'Blood, serum',
  'Blood, citrate',
  'Urine, random',
  'Swab',
] as const;

/**
 * Orders machine identifiers by UTF-16 code unit.
 *
 * `localeCompare` reads the runtime's default locale, so it cannot provide the
 * same promised order across independently configured API processes and
 * clients. Naming a locale does not remove the dependency on the ICU data in
 * that runtime either. Measured examples: `['order.Write', 'order.audit',
 * 'order.write']` sorts two different ways across eight locales, and
 * `['patient.Info', 'patient.index', 'patient.info']` sorts three.
 *
 * The default string comparison is stable across those runtimes. The
 * comparator is written out because `typescript:S2871` requires one and so the
 * next reader knows the plain form was rejected rather than forgotten.
 */
export function byIdentifier(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

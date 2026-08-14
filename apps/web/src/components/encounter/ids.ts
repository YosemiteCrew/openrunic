/**
 * Ids the slash menu and the textarea that drives it must agree on.
 *
 * They live apart from either component because both need them: the menu
 * stamps the id onto the option, the note block publishes the same string
 * through `aria-activedescendant`, and if the two ever computed it differently
 * the highlight would stop being announced.
 */

export function optionId(prefix: string, commandId: string): string {
  return `${prefix}-command-${commandId}`;
}

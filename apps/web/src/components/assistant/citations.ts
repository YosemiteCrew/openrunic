import type { Translator } from '@openrunic/i18n';

import type { AgentSource } from '@/lib/agent';

/**
 * Getting from an answer to the record it came from.
 *
 * ADR-0005 rule 2 asks for the source span to be displayed; a span nobody can
 * open is a citation in name only, so every entry that has a screen behind it
 * is a link to that screen.
 *
 * Two of the types the v1 tools cite have no detail route in this app yet.
 * `Appointment` and `Claim` are reachable only as rows inside a day view and a
 * workbench, and neither takes an identifier. Those citations render as a
 * labelled reference carrying the identifier rather than as a link to a screen
 * that would ignore it. A link that silently drops what it was pointing at is
 * worse than no link, because it looks like it worked.
 */

/** Resource type to a route that opens exactly that row. One line per type. */
const ROUTES: Record<string, (id: string) => string> = {
  Patient: (id) => `/patients/${encodeURIComponent(id)}`,
  Encounter: (id) => `/encounters/${encodeURIComponent(id)}`,
};

/** Where the citation opens, or null when this app has no screen for that row yet. */
export function citationHref(source: AgentSource): string | null {
  return ROUTES[source.resourceType]?.(source.resourceId) ?? null;
}

/**
 * How the resource type reads to a person, as catalogue keys.
 *
 * Only the three whose API name is not already the word a clinician uses.
 * Unmapped types fall through to the server's own word for the type, which is
 * the API's spelling of the aggregate and is already a noun a clinician
 * recognises - and is left in that spelling rather than gaining a second name
 * invented here.
 */
const TYPE_LABEL_KEYS: Record<string, { labelKey: string }> = {
  ClinicalNote: { labelKey: 'assistant.citation.note' },
  DiagnosticReport: { labelKey: 'assistant.citation.result' },
  ProblemList: { labelKey: 'assistant.citation.problemList' },
};

export function citationTypeLabel(t: Translator, source: AgentSource): string {
  // The map does not cover every resource type the agent can cite, so a type
  // nobody wrote a label for falls back to the FHIR name rather than to a blank.
  const entry = TYPE_LABEL_KEYS[source.resourceType];
  return entry === undefined ? source.resourceType : t(entry.labelKey);
}

import type { AssistantSource } from '@/lib/assistant';
import type { PortalRoute } from '@/lib/nav';

/**
 * Getting from a sentence to the record behind it.
 *
 * ADR-0005 rule 2 asks for the source to be shown, and a source nobody can open
 * is a citation in name only. Every record the assistant can reach lives on one
 * of the portal's own screens, so every citation is a link to the screen that
 * holds it.
 *
 * **No route here takes an identifier.** That is deliberate and it is checked:
 * the portal has no per-record page, so a link cannot carry a record id, which
 * means this module has no way to build a link into anybody's chart - including
 * the reader's own, and therefore including anybody else's. A citation whose
 * type is not one of the six below renders as plain words rather than as a link
 * to a screen that would ignore what it was pointing at. A link that silently
 * drops its target is worse than no link, because it looks like it worked.
 */

/** Record type to the screen that holds it. One line per type the tools can cite. */
const SCREENS: Readonly<Record<string, PortalRoute>> = {
  Condition: '/health-record',
  Medicine: '/health-record',
  Allergy: '/health-record',
  Vaccination: '/health-record',
  Appointment: '/appointments',
  Bill: '/bills',
};

/** Which screen the citation opens, or null when this app has no screen for that type. */
export function citationHref(source: AssistantSource): PortalRoute | null {
  return SCREENS[source.resourceType] ?? null;
}

/**
 * How the record type reads to the person holding the phone.
 *
 * An unmapped type falls through to "Record" rather than to the server's own
 * word for it. On the staff surface the raw type is a noun a clinician already
 * knows; here it would be shorthand a reader has to look up, and the label
 * beside it already says what the row is.
 */
const NAMES: Readonly<Record<string, string>> = {
  Condition: 'Condition',
  Medicine: 'Medicine',
  Allergy: 'Allergy',
  Vaccination: 'Vaccination',
  Appointment: 'Appointment',
  Bill: 'Bill',
};

export function citationName(source: AssistantSource): string {
  return NAMES[source.resourceType] ?? 'Record';
}

/** Where the link goes, said in words, so the link text is not "here". */
const DESTINATIONS: Readonly<Record<PortalRoute, string>> = {
  '/': 'Home',
  '/health-record': 'your health record',
  '/messages': 'your messages',
  '/appointments': 'your appointments',
  '/forms': 'your forms',
  '/bills': 'your bills',
  '/assistant': 'the assistant',
};

export function citationDestination(href: PortalRoute): string {
  return DESTINATIONS[href];
}

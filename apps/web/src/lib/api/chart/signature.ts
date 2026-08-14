import type { NoteSection } from './types';

/**
 * What a signature says, and how the text under it is fingerprinted.
 *
 * Both live here because both sides of the note need them and neither owns
 * them: the editor quotes the attestation in the dialog before it signs, and
 * the live client shows the same sentence when it reads a signed note back. Two
 * copies would be a confirmation dialog quoting a sentence the record does not
 * carry.
 */

/** The one sentence a signer attests to. Quoted in the dialog before it is stored. */
export const ATTESTATION = 'I attest that this note records the care I provided at this visit.';

/**
 * A short, stable fingerprint of the note text passed to it.
 *
 * It is a fingerprint of what the caller is holding right now, and that is the
 * whole of what it is. It is computed on this side, from text this side has
 * just read or just committed, and nothing on the wire is compared against it:
 * `noteDtoSchema` carries no hash field, so the API never states what the text
 * was when the signature was taken, and no comparison is possible from here.
 *
 * So it is not evidence that a signed note still says what it said. It tells
 * two versions of the same note apart within a session, and it is
 * deterministic, so a signed fixture reads the same every run. Both are worth
 * having; neither is tamper evidence, and this value must never be presented as
 * any.
 *
 * Making it evidence is an `apps/api` change, not a change here: the API would
 * have to hash the block document when it signs, store that hash on the note,
 * and return it, and only then would a client have two values to compare. The
 * hash-chained audit trail is the tamper-evidence surface that exists today.
 *
 * It is not a security primitive and is not used as one: DJB2 over a joined
 * string is a display fingerprint, not a digest anyone should rely on.
 */
export function contentHash(sections: readonly NoteSection[]): string {
  const text = sections.map((section) => `${section.key}:${section.text}`).join('|');
  let hash = 5381;
  // Iterated by code point, not by code unit: a character outside the basic
  // plane is one character to the clinician who typed it, so it contributes to
  // the hash once. For text inside the basic plane the two are identical, so
  // every hash already in a fixture is unchanged.
  for (const character of text) {
    hash = ((hash << 5) + hash + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${(text.length % 65536).toString(16).padStart(4, '0')}`;
}

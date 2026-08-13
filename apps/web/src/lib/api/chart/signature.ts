import type { NoteSection } from './types';

/**
 * What a signature says, and what it covers.
 *
 * Both halves live here because both sides of the note need them and neither
 * owns them: the editor shows the attestation in the dialog and stamps a hash
 * when it signs, and the live client reads a signed note back and recomputes
 * one. Two copies of either would be a confirmation dialog quoting a sentence
 * the record does not carry, or a signature block that disagrees with itself.
 */

/** The one sentence a signer attests to. Quoted in the dialog before it is stored. */
export const ATTESTATION = 'I attest that this note records the care I provided at this visit.';

/**
 * A short, stable content hash of the note's text.
 *
 * It is not a security primitive and is not used as one. It catches a note
 * whose stored text no longer matches what a signature was taken over, which is
 * exactly what the signature block is there to show. Deterministic, so a signed
 * fixture reads the same every run.
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

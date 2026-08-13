import type { NoteSection } from '@/lib/api/chart';

/** A short, stable content hash. Deterministic, so a signed fixture reads the same every run. */
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

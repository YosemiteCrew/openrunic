import { describe, expect, it } from 'vitest';

import { contentHash } from '@/lib/api/chart/signature';
import type { NoteSection } from '@/lib/api/chart';

/**
 * The fingerprint a signed note carries.
 *
 * Its job is to change when the note changes and not otherwise, so that a
 * signature stops matching text that was edited after it was signed. The
 * property worth pinning is the one the implementation went out of its way to
 * get right: iteration by code point rather than by code unit.
 */

function sections(...pairs: readonly (readonly [string, string])[]): NoteSection[] {
  return pairs.map(([key, text]) => ({ key, text }) as NoteSection);
}

describe('contentHash', () => {
  it('is stable for the same content', () => {
    const note = sections(['subjective', 'Cough for three days.']);

    expect(contentHash(note)).toBe(contentHash(note));
  });

  it('changes when a single character of the note changes', () => {
    const before = contentHash(sections(['subjective', 'Cough for three days.']));
    const after = contentHash(sections(['subjective', 'Cough for four days.']));

    expect(after).not.toBe(before);
  });

  it('changes when the same text moves to a different section', () => {
    /*
     * The key is hashed with the text. A finding recorded under `objective`
     * instead of `subjective` is a different note, and a signature taken before
     * the move must not still match.
     */
    const before = contentHash(sections(['subjective', 'No chest pain.']));
    const after = contentHash(sections(['objective', 'No chest pain.']));

    expect(after).not.toBe(before);
  });

  it('counts a character outside the basic plane once, not twice', () => {
    /*
     * The reason the loop iterates by code point. An astral character is two
     * code units and one character; hashing by unit would let two visibly
     * different notes of the same code-unit length collide more readily, and
     * would make the length component disagree with what the clinician typed.
     *
     * `'\u{1d5a0}'` is one character and `'ab'` is two, so a code-unit
     * implementation sees the same length for both.
     */
    const astral = contentHash(sections(['subjective', '\u{1d5a0}']));
    const twoAscii = contentHash(sections(['subjective', 'ab']));

    expect(astral).not.toBe(twoAscii);
  });

  it('keeps its shape whatever the content', () => {
    /* Four-four-four hex, so it is recognisable in an audit row at a glance. */
    for (const note of [
      sections(),
      sections(['subjective', '']),
      sections(['subjective', 'A'.repeat(70_000)]),
      sections(['a', 'one'], ['b', 'two']),
    ]) {
      expect(contentHash(note)).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/u);
    }
  });

  it('distinguishes notes longer than the length component can hold', () => {
    /*
     * The third group is `length % 65536`, so two notes whose lengths differ by
     * exactly 65536 share it. They must still differ, which is what the first
     * two groups are for.
     */
    const short = contentHash(sections(['subjective', 'A'.repeat(10)]));
    const long = contentHash(sections(['subjective', 'A'.repeat(10 + 65_536)]));

    expect(long).not.toBe(short);
  });
});

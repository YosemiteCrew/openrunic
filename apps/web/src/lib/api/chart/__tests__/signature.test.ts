import { describe, expect, it } from 'vitest';

import { contentHash } from '@/lib/api/chart/signature';
import type { NoteSection } from '@/lib/api/chart';

/**
 * A display fingerprint of the note text a caller is holding.
 *
 * It is emphatically NOT tamper evidence, and the module says so at length:
 * nothing on the wire is compared against it, `noteDtoSchema` carries no hash
 * field, and the API never states what the text was when a signature was taken.
 * An earlier version of this file described it as making a signature stop
 * matching edited text, which is precisely the claim the source forbids.
 *
 * What it actually does is tell two versions of the same note apart within a
 * session, deterministically, so a signed fixture reads the same every run.
 * Those are the properties tested here.
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
     * The key is hashed with the text, not just the text. A finding recorded
     * under `objective` instead of `subjective` is a different note, and the
     * two versions have to be distinguishable within the session that moved it.
     */
    const before = contentHash(sections(['subjective', 'No chest pain.']));
    const after = contentHash(sections(['objective', 'No chest pain.']));

    expect(after).not.toBe(before);
  });

  it('hashes a character outside the basic plane by code point, not code unit', () => {
    /*
     * The reason the loop iterates by code point rather than by code unit.
     *
     * Asserted as an exact value, because the obvious comparison does not
     * distinguish the two. An earlier version checked that this differed from
     * the hash of a two-character ASCII string, which is true under BOTH
     * implementations - so it stayed green under the exact rewrite it claimed
     * to guard against.
     *
     * `subjective:\u{1d5a0}` hashes to this by code point and to
     * `5f4f-3cc8-000d` by code unit, so only one of the two can pass.
     */
    expect(contentHash(sections(['subjective', '\u{1d5a0}']))).toBe('21ec-1793-000d');
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

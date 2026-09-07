import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The staff side of the same property: free text a person typed, rendered in a
 * box that did not choose its length.
 *
 * A single unbroken run made the whole page scroll sideways - 37 characters at
 * a 390 viewport in the patient portal, 81 at 1440 - and the same class of
 * overflow reaches the inbox summary at a higher threshold, because
 * `overflow-wrap` was set on neither. It is one property of free-text rendering
 * across both applications rather than one component's bug, so the portal
 * carries the matching test.
 *
 * jsdom does no layout, so a page that scrolls sideways and one that does not
 * are the same DOM here. The stylesheet is asserted directly because nothing
 * else in this suite can see the difference.
 */
describe('free-text bodies wrap anywhere', () => {
  // Comments stripped first, or the head of a rule includes the comment above
  // it and the first selector of a commented group stops comparing equal.
  const css = readFileSync('src/app/globals.css', 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');

  // Named rather than destructured: a capture group is `string | undefined` to
  // the compiler, and `pnpm --filter <pkg> test` does not type-check test files
  // while `type-check` does - so a destructured `[, head]` passes the suite and
  // fails the gate.
  const rulesFor = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((match) => ({ head: match[1] ?? '', body: match[2] ?? '' }))
      .filter((rule) => rule.head.split(',').some((part) => part.trim() === `.${selector}`));

  it('or-inbox__summary carries overflow-wrap: anywhere', () => {
    const rules = rulesFor('or-inbox__summary');

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => /overflow-wrap:\s*anywhere/.test(rule.body))).toBe(true);
  });

  it('does not settle for break-word, which leaves the track wide', () => {
    // `break-word` breaks the text and still reports the unbroken run as the
    // intrinsic min-content size, so a flex or grid track sized from content is
    // pushed wide anyway - it looks fixed and is not. Only `anywhere` shrinks
    // that size, and the inbox row is exactly such a track.
    for (const { body } of rulesFor('or-inbox__summary')) {
      expect(body).not.toMatch(/overflow-wrap:\s*break-word/);
    }
  });

  it('finds nothing for a selector that is not in the stylesheet', () => {
    // The control: every assertion above is "some rule matched", which a matcher
    // that matches everything would also satisfy.
    expect(rulesFor('or-no-such-class')).toHaveLength(0);
  });
});

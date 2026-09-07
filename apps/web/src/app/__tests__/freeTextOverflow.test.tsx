import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { InboxScreen } from '@/app/(app)/inbox/InboxScreen';
import { MOCK_NOW } from '@/lib/api/mock/fixtures';
import { createWorklistClient } from '@/lib/api/worklist';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/inbox',
}));

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

  it('or-inbox__body carries overflow-wrap: anywhere', () => {
    const rules = rulesFor('or-inbox__body');

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => /overflow-wrap:\s*anywhere/.test(rule.body))).toBe(true);
  });

  it('does not settle for break-word, which leaves the track wide', () => {
    // Not because `break-word` fails here - this column carries `min-width: 0`
    // inside a `minmax(0, 1fr)` track, so it would be enough. The portal's
    // message grid is the one where the difference decides the outcome, and one
    // property with one reason across both applications is worth more than each
    // side carrying the minimum that happens to work. Holding the stronger value
    // is what keeps the two from drifting apart.
    for (const { body } of rulesFor('or-inbox__body')) {
      expect(body).not.toMatch(/overflow-wrap:\s*break-word/);
    }
  });

  it('finds nothing for a selector that is not in the stylesheet', () => {
    // The control: every assertion above is "some rule matched", which a matcher
    // that matches everything would also satisfy.
    expect(rulesFor('or-no-such-class')).toHaveLength(0);
  });
});

/**
 * The pair the stylesheet test cannot see.
 *
 * The class is written twice - once in `globals.css` and once as a `className`
 * in `InboxList.tsx` - and nothing above asserts they agree. Rename it in the
 * component alone and the CSS rule is orphaned, the page overflows again, and
 * every assertion in this file still passes: the rule exists, it carries the
 * declaration, and it now applies to nothing.
 *
 * This renders the screen and requires the free-text column to actually be in
 * the document under the name the rule targets, so the two cannot drift apart
 * silently. Rendering rather than grepping the source, because a class name in
 * a comment or a dead branch would satisfy a grep.
 */
describe('the styled class is the one the component renders', () => {
  it('renders a free-text column under the class the stylesheet targets', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);

    const list = await screen.findByRole('list', { name: 'Inbox items' });
    const rows = [...list.querySelectorAll('li')];
    const styled = rows.flatMap((row) => [...row.querySelectorAll('.or-inbox__body')]);

    expect(styled.length).toBeGreaterThan(0);
    // CONTROL: a name the stylesheet does not target must find nothing, or the
    // query above would pass against any markup at all.
    expect(
      rows.flatMap((row) => [...row.querySelectorAll('.or-inbox__no-such-column')])
    ).toHaveLength(0);
  });
});

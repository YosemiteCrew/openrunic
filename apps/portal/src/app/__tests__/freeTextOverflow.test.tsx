import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MessagesScreen } from '@/app/messages/MessagesScreen';
import { AssistantTurnView } from '@/components/assistant';
import { Notice } from '@/components/Notice';
import { stubApi } from '@/__tests__/support';

/**
 * A person's own words, rendered in a box that did not choose their length.
 *
 * A single unbroken run of 37 characters in a message body made the WHOLE page
 * scroll sideways at a 390 viewport - the bubble, every card beside it, and the
 * layout holding them, with the reader's own earlier message clipped by the same
 * amount. 81 characters did it at 1440.
 *
 * jsdom does no layout, so a page that scrolls sideways and one that does not
 * are the same DOM here and no rendering test in this suite can tell them apart.
 * The stylesheet is therefore asserted directly, for the same reason the table's
 * sticky-column declarations are: the line reads like decoration, it is one
 * keystroke from being deleted, and the only instrument that would notice is a
 * real browser at a real width.
 *
 * `anywhere` and not `break-word`: both break the run at the box edge, but only
 * `anywhere` shrinks the intrinsic min-content size, and these bodies sit in
 * tracks sized from content - so `break-word` breaks the text and still pushes
 * the layout wide. That is the value this test exists to hold, not merely the
 * presence of some wrapping.
 */
describe('free-text bodies wrap anywhere', () => {
  // Comments are stripped before parsing. Without this the head of a rule
  // includes the comment above it, so the FIRST selector in a commented group
  // no longer compares equal after trimming - and the grouped rule this file is
  // about carries the comment explaining why the value is `anywhere`. The three
  // selectors after the comma passed while the first one failed, which is what
  // said the matcher was reading the comment rather than the selector.
  const css = readFileSync('src/app/globals.css', 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');

  // Named rather than destructured: a capture group is `string | undefined` to
  // the compiler, and `pnpm --filter <pkg> test` does not type-check test files
  // while `type-check` does - so a destructured `[, head]` passes the suite and
  // fails the gate.
  const rulesFor = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((match) => ({ head: match[1] ?? '', body: match[2] ?? '' }))
      .filter((rule) => rule.head.split(',').some((part) => part.trim() === `.${selector}`));

  const FREE_TEXT = [
    'portal-message__body',
    'portal-notice__text',
    'portal-assistant__question',
    'portal-assistant__answer',
  ];

  it.each(FREE_TEXT)('%s carries overflow-wrap: anywhere', (selector) => {
    // Every rule this selector appears in, so the declaration is found wherever
    // it is written rather than only in the block this test happens to expect.
    const rules = rulesFor(selector);

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => /overflow-wrap:\s*anywhere/.test(rule.body))).toBe(true);
  });

  it('does not settle for break-word, which leaves the track wide', () => {
    for (const selector of FREE_TEXT) {
      const rules = rulesFor(selector);
      for (const { body } of rules) {
        expect(body).not.toMatch(/overflow-wrap:\s*break-word/);
      }
    }
  });

  it('finds nothing for a selector that is not in the stylesheet', () => {
    // The control. Every assertion above is "some rule matched", which a parser
    // that matches everything would also satisfy; this is the one that fails if
    // the matcher has stopped discriminating.
    const rules = rulesFor('portal-no-such-class');

    expect(rules).toHaveLength(0);
  });
});

/**
 * The pair the stylesheet test cannot see, mirrored from the staff side.
 *
 * Each of these class names is written twice - once in `globals.css` and once
 * as a `className` in a component - and nothing above asserts they agree.
 * Rename one in the component alone and the rule is orphaned, the page
 * overflows again, and every assertion in this file still passes: the rule
 * exists, it carries the declaration, and it applies to nothing.
 *
 * Rendered rather than grepped, because a class name in a comment or a dead
 * branch would satisfy a grep. And each case asserts the element CONTAINS the
 * free text, not merely that an element with the name exists: move the class
 * onto a SIBLING - `portal-notice__title` beside the text it labels - and the
 * element still renders, still carries the name, and styles nothing, which is
 * the exact state the declaration exists to prevent.
 *
 * Containment and not identity, deliberately. Moving the class to a wrapper
 * AROUND the text is not a defect - `overflow-wrap` inherits, so an ancestor
 * carrying it still wraps the words - and a test asserting the exact element
 * would fail on that harmless move. The sibling arm is the one that separates
 * them; the wrapper arm must stay green.
 */
describe('the styled classes are the ones the components render', () => {
  const containing = (selector: string, text: string) =>
    [...document.querySelectorAll(selector)].filter((node) => node.textContent?.includes(text));

  it('the message body renders under the class the stylesheet targets', async () => {
    render(<MessagesScreen api={stubApi()} />);
    const body = await screen.findByText(/Your thyroid result is a little above the usual range\./);

    expect(containing('.portal-message__body', body.textContent ?? '')).not.toHaveLength(0);
    // CONTROL: a name the stylesheet does not target finds nothing, or the
    // query above would pass against any markup at all.
    expect(document.querySelectorAll('.portal-no-such-body')).toHaveLength(0);
  });

  it('the notice text renders under the class the stylesheet targets', () => {
    // `Notice` directly rather than through the screen that happens to use it:
    // the pair that must agree is the class in `globals.css` and the class in
    // `Notice.tsx`, and the caution's own words are the free text at risk.
    const caution = 'A message is not the way to reach anyone urgently.';

    render(<Notice title="Before you send">{caution}</Notice>);

    expect(containing('.portal-notice__text', caution)).not.toHaveLength(0);
    // CONTROL: the title is a SIBLING of the text and does not contain it, so
    // this is the assertion that goes red when the class moves onto it.
    expect(containing('.portal-notice__title', caution)).toHaveLength(0);
  });

  it('the assistant question and answer render under the classes the stylesheet targets', () => {
    const question = 'What does my thyroid result mean?';
    const answer = 'It is a little above the usual range.';

    render(
      <AssistantTurnView
        answering={false}
        turn={{
          id: 'turn-1',
          question,
          answer,
          steps: [],
          sources: [],
          failures: [],
          deferrals: [],
          outcome: null,
          withheld: 'none',
        }}
      />
    );

    expect(containing('.portal-assistant__question', question)).not.toHaveLength(0);
    expect(containing('.portal-assistant__answer', answer)).not.toHaveLength(0);
    // CONTROL: the same query for text that is not on the page.
    expect(containing('.portal-assistant__answer', 'text that is not rendered here')).toHaveLength(
      0
    );
  });
});

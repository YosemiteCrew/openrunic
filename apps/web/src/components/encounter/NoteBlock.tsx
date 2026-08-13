'use client';

import { Card, IconButton, Tag } from '@openrunic/ui';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';

import { useActiveOptionInView } from '@/lib/active-option';
import type { EmittedItem, NoteSection, SlashCommand } from '@/lib/api/chart';
import { formatCount, formatEnumLabel } from '@/lib/format';

import { optionId } from './ids';
import { SlashCommandMenu } from './SlashCommandMenu';

/**
 * One block of the note.
 *
 * The block is the unit of the editor: a heading, a line of what belongs in it,
 * the text itself, and the structured data that text wrote. Typing `/` opens
 * the command list at the caret, and committing a command inserts narrative AND
 * emits a chip naming what it wrote to the chart. That pairing is the answer to
 * The legacy split between iframe-loaded note forms and a separate ordering
 * module: here the sentence and the order come from the same keystrokes, and
 * the block shows both.
 *
 * The same list is reachable from a labelled button, so the feature is not
 * hidden behind knowing to press a key.
 *
 * A signed block renders as text. There is no editable state to fall back to,
 * because signed content that can still be typed into is the one defect a note
 * editor must never have.
 */

export interface NoteBlockProps {
  section: NoteSection;
  commands: readonly SlashCommand[];
  /** Signed notes are read-only. Corrections go through an addendum. */
  locked: boolean;
  onChange: (text: string) => void;
  onEmit: (item: Omit<EmittedItem, 'id'>) => void;
}

/** The `/token` immediately before the caret, if there is one. */
function slashToken(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)\/([\p{L}\d-]*)$/u.exec(before);
  const query = match?.[1];
  if (query === undefined) return null;
  return { start: caret - query.length - 1, query };
}

function matches(command: SlashCommand, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return command.id.includes(needle) || command.label.toLowerCase().includes(needle);
}

export function NoteBlock({
  section,
  commands,
  locked,
  onChange,
  onEmit,
}: Readonly<NoteBlockProps>): ReactElement {
  const blockId = `note-block-${section.key}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  /* A ref rather than state: the caret is a property of the DOM, not something
     the component renders, and putting it in state would cost a second render
     for every insertion. */
  const caretTarget = useRef<number | null>(null);

  const visible = menu ? commands.filter((command) => matches(command, menu.query)) : [];
  const active = visible[Math.min(activeIndex, Math.max(visible.length - 1, 0))] ?? null;
  const activeOptionId = menu && active ? optionId(blockId, active.id) : undefined;

  useActiveOptionInView(activeOptionId);

  // The caret is restored after the parent has committed the new text, so the
  // insertion leaves the writer exactly where they would have typed next.
  useEffect(() => {
    const target = caretTarget.current;
    if (target === null) return;
    caretTarget.current = null;
    const field = textareaRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(target, target);
  });

  const closeMenu = () => {
    setMenu(null);
    setActiveIndex(0);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    onChange(value);
    const token = slashToken(value, event.target.selectionStart ?? value.length);
    setMenu(token);
    setActiveIndex(0);
  };

  const insert = (command: SlashCommand) => {
    const field = textareaRef.current;
    const value = field?.value ?? section.text;
    const caret = field?.selectionEnd ?? value.length;
    const start = menu ? menu.start : caret;
    const head = value.slice(0, start);
    const tail = value.slice(caret);
    const spacer = head.length > 0 && !head.endsWith('\n') && !head.endsWith(' ') ? ' ' : '';
    const next = `${head}${spacer}${command.insertText}${tail}`;

    onChange(next);
    if (command.emits) onEmit(command.emits);
    caretTarget.current = head.length + spacer.length + command.insertText.length;
    closeMenu();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (visible.length === 0 ? 0 : (index + 1) % visible.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) =>
        visible.length === 0 ? 0 : (index - 1 + visible.length) % visible.length
      );
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      insert(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  };

  const openFromButton = () => {
    const field = textareaRef.current;
    const caret = field?.selectionEnd ?? section.text.length;
    field?.focus();
    setMenu({ start: caret, query: '' });
    setActiveIndex(0);
  };

  return (
    <Card id={blockId} title={section.label} className="or-note-block">
      <p className="or-caption or-note-block__hint" id={`${blockId}-hint`}>
        {section.hint}
      </p>

      {locked ? (
        <div className="or-note-block__locked">
          {section.text ? (
            /* Line breaks are preserved by the stylesheet rather than by
               splitting into elements: the signed text is rendered exactly as
               it was signed, and nothing about it is reconstructed. */
            <p className="or-body or-note-block__text">{section.text}</p>
          ) : (
            <p className="or-body or-note-block__absent">Nothing recorded in this block.</p>
          )}
        </div>
      ) : (
        <>
          <div className="or-note-block__margin">
            <IconButton
              icon="slash"
              label={`Insert a command in ${section.label.toLowerCase()}`}
              variant="ghost"
              size="sm"
              onClick={openFromButton}
            />
          </div>

          <textarea
            ref={textareaRef}
            className="or-note-block__field"
            aria-labelledby={`${blockId}-title`}
            aria-describedby={`${blockId}-hint`}
            aria-controls={menu ? `${blockId}-listbox` : undefined}
            aria-activedescendant={activeOptionId}
            rows={6}
            value={section.text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />

          {menu ? (
            <SlashCommandMenu
              commands={visible}
              activeId={active?.id ?? null}
              idPrefix={blockId}
              query={menu.query}
              onSelect={insert}
            />
          ) : null}

          <output className="or-visually-hidden">
            {menu
              ? `${formatCount(visible.length, 'command')} available. Use the arrow keys and Enter.`
              : ''}
          </output>
        </>
      )}

      {section.emitted.length > 0 ? (
        <ul
          className="or-note-block__emitted"
          aria-label={`Written to the chart from ${section.label.toLowerCase()}`}
        >
          {section.emitted.map((item) => (
            <li key={item.id}>
              <Tag>
                {formatEnumLabel(item.kind)}: {item.label}
              </Tag>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

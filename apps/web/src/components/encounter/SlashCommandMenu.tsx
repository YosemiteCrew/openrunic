'use client';

import { cx, Icon } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { SlashCommand } from '@/lib/api/chart';

import { optionId } from './ids';

/**
 * The popover behind `/` in a note block.
 *
 * It is a listbox owned by the textarea rather than a menu that steals focus:
 * the caret never leaves the note, which is the whole promise of the block
 * editor. Keyboard handling lives in the block that owns the textarea and
 * arrives here as `activeId`, which the textarea also publishes through
 * `aria-activedescendant`.
 *
 * Composed in the app because `@openrunic/ui` has no popover or combobox
 * primitive today. It is written to move into the library unchanged.
 */

export interface SlashCommandMenuProps {
  commands: readonly SlashCommand[];
  activeId: string | null;
  /** Id prefix so two blocks on one page never collide. */
  idPrefix: string;
  /** What was typed after the slash. Echoed in the empty state. */
  query: string;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandMenu({
  commands,
  activeId,
  idPrefix,
  query,
  onSelect,
}: Readonly<SlashCommandMenuProps>): ReactElement {
  if (commands.length === 0) {
    return (
      <div className="or-slash" id={`${idPrefix}-listbox`}>
        <p className="or-small or-slash__empty">
          No command matches {query ? `"${query}"` : 'that'}. Keep typing to write plain text.
        </p>
      </div>
    );
  }

  return (
    <ul className="or-slash" id={`${idPrefix}-listbox`} role="listbox" aria-label="Note commands">
      {commands.map((command) => (
        /* No key handler here, on purpose. These options are not focus targets:
           the caret stays in the note's textarea, which owns
           ArrowUp/ArrowDown/Enter/Escape and publishes the highlight through
           `aria-activedescendant`. That is the whole promise of the block
           editor, so a keydown listener on a row that can never hold focus
           would be unreachable code. The pointer handlers stand alone. */
        <li
          key={command.id}
          id={optionId(idPrefix, command.id)}
          role="option"
          aria-selected={command.id === activeId}
          className={cx('or-slash__option', command.id === activeId && 'or-slash__option--active')}
          /* Mouse-down rather than click: the textarea must not blur before the
             insertion runs, or the caret position is lost. */
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(command);
          }}
          onClick={() => onSelect(command)}
        >
          <Icon name={command.icon} size={16} className="or-slash__icon" />
          <span className="or-slash__label">{command.label}</span>
          <span className="or-caption or-slash__group">{command.group}</span>
          <span className="or-caption or-slash__preview">
            {command.emits ? `Writes ${command.emits.label}` : 'Text only'}
          </span>
        </li>
      ))}
    </ul>
  );
}

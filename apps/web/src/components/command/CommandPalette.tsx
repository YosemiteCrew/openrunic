'use client';

import { Icon, Input } from '@openrunic/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useActiveOptionInView } from '@/lib/active-option';
import { usePatients } from '@/lib/api';
import { formatDate, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { useCommandPalette } from './CommandProvider';
import { filterCommands, flattenSections } from './filter';
import type { Command, NavigateCommand } from './types';

/**
 * The command palette: Cmd-K on macOS, Ctrl-K elsewhere.
 *
 * This is the centrepiece of the app's keyboard and agent story. Every route
 * and every primary action is reachable from here, so the whole product can be
 * driven without a mouse and without knowing where a control lives on screen.
 *
 * It is a combobox inside a dialog, not a Modal: focus stays in the text field
 * the entire time and the active option is announced through
 * `aria-activedescendant`, which is the ARIA pattern for a list you type into.
 * The library's Modal moves focus to its own panel, which would swallow the
 * first keystroke, so this dialog owns its focus handling instead.
 *
 * Proposed @openrunic/ui addition: a `Dialog`/`Combobox` pair, so this focus
 * handling stops living in the app. Flagged rather than forked.
 */

/** Patient results shown while the palette is open. Enough to recognise, not to browse. */
const PATIENT_RESULT_LIMIT = 6;

const SEARCH_DEBOUNCE_MS = 150;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]';

/** The keys that move the highlight rather than acting on it. */
const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Where a move key sends the highlight. Wrapping is computed from the clamped
 * index, so it stays in range even when the previous keystroke shortened the
 * result list.
 */
function nextIndex(key: string, current: number, length: number): number {
  if (length === 0 || key === 'Home') return 0;
  if (key === 'End') return length - 1;
  const step = key === 'ArrowDown' ? 1 : -1;
  return (current + step + length) % length;
}

/**
 * Tab cycles inside the modal rather than escaping to the page behind, which
 * would leave an open overlay nobody can close.
 */
function cycleFocus(
  panel: HTMLDialogElement | null,
  event: ReactKeyboardEvent<HTMLInputElement>
): void {
  const stops = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return;
  if (document.activeElement !== (event.shiftKey ? first : last)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  if (!isOpen) return null;
  return <CommandPaletteDialog onClose={close} />;
}

interface CommandPaletteDialogProps {
  onClose: () => void;
}

function CommandPaletteDialog({ onClose }: Readonly<CommandPaletteDialogProps>) {
  const router = useRouter();
  const t = useTranslator();
  const { commands } = useCommandPalette();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [requestedIndex, setRequestedIndex] = useState(0);

  const panelRef = useRef<HTMLDialogElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const titleId = `${baseId}-title`;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  /* Patient search is live rather than a static list: the chart is what people
     reach for, and typing a name has to find it without a screen in between. */
  const patients = usePatients({
    q: debounced.trim() || undefined,
    pageSize: PATIENT_RESULT_LIMIT,
    active: true,
  });

  const patientCommands = useMemo<Command[]>(() => {
    const rows = patients.data?.data ?? [];
    return rows.map<NavigateCommand>((patient) => ({
      id: `patient.${patient.id}`,
      group: 'patients',
      label: formatName(patient.name, 'listing'),
      href: `/patients/${patient.id}`,
      icon: 'user-round',
      searchText: `${formatMrn(patient.mrn)} ${patient.birthDate}`,
      hint: (
        <span className="or-palette__hint">
          <span className="or-mono">{formatMrn(patient.mrn)}</span>
          <span aria-hidden="true"> | </span>
          <span>{t('shell.palette.born', { date: formatDate(patient.birthDate) })}</span>
        </span>
      ),
    }));
  }, [patients.data, t]);

  const sections = useMemo(
    () => filterCommands([...patientCommands, ...commands], query),
    [patientCommands, commands, query]
  );
  const flat = useMemo(() => flattenSections(sections), [sections]);

  /* Clamped during render rather than corrected in an effect: results change on
     every keystroke, and an effect would leave one frame where the highlight
     points past the end of the list. */
  const activeIndex = requestedIndex < flat.length ? requestedIndex : 0;

  /* Focus the field, then hand focus back to whatever opened the palette. Doing
     it here rather than with autoFocus keeps the restore and the grab in one
     place, so they cannot drift apart. */
  useEffect(() => {
    const trigger = document.activeElement;
    inputWrapRef.current?.querySelector('input')?.focus();
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  const run = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      onClose();
      // Narrowed on `perform` rather than on `href`: an empty string is falsy,
      // and a navigate command with an empty href would fall through silently.
      if (command.perform) {
        command.perform();
        return;
      }
      router.push(command.href);
    },
    [onClose, router]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(flat[activeIndex]);
      return;
    }
    if (MOVE_KEYS.has(event.key)) {
      event.preventDefault();
      setRequestedIndex(nextIndex(event.key, activeIndex, flat.length));
      return;
    }
    if (event.key === 'Tab') cycleFocus(panelRef.current, event);
  };

  const activeCommand = flat[activeIndex];
  const activeOptionId = activeCommand ? `${baseId}-option-${activeCommand.id}` : undefined;

  useActiveOptionInView(activeOptionId);

  return (
    <div className="or-palette">
      {/* The scrim closes on click, and is hidden from assistive technology:
          Escape is the keyboard route out, and a second "close" node would only
          add noise to the dialog's reading order. */}
      <div className="or-palette__scrim" aria-hidden="true" onClick={onClose} />
      {/* A real <dialog>, not a div wearing role="dialog". Rendered with `open`
          rather than through `showModal()`, so the palette keeps its own
          centring and scrim instead of the top layer's `::backdrop`. The
          keyboard contract below (arrows, Home/End, Enter, Escape, Tab cycling)
          is unchanged. */}
      <dialog
        ref={panelRef}
        className="or-palette__panel"
        open
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="or-visually-hidden">
          {t('shell.palette.title')}
        </h2>

        <div ref={inputWrapRef} className="or-palette__field">
          <Input
            label={t('shell.palette.searchLabel')}
            placeholder={t('shell.palette.searchPlaceholder')}
            iconLeft="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setRequestedIndex(0);
            }}
            /* Every key the palette understands is handled here rather than on
               the dialog around it. In the ARIA combobox pattern this field is
               the only thing that ever holds focus, so it is the only element a
               keystroke can originate from; a handler on the dialog would be
               catching its own child's bubbles. */
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
          />
        </div>

        <div
          id={listId}
          className="or-palette__list"
          role="listbox"
          aria-label={t('shell.palette.results')}
        >
          {sections.length === 0 ? (
            <p className="or-palette__empty or-body">
              {t('shell.palette.empty', { query: query.trim() })}
            </p>
          ) : null}

          {sections.map((section) => {
            const headingId = `${baseId}-group-${section.group}`;
            return (
              <div
                key={section.group}
                className="or-palette__group"
                role="group"
                aria-labelledby={headingId}
              >
                <p id={headingId} className="or-overline or-palette__group-label">
                  {t(section.labelKey)}
                  <span className="or-palette__count"> ({section.commands.length})</span>
                </p>
                {section.commands.map((command) => {
                  const index = flat.indexOf(command);
                  const selected = index === activeIndex;
                  return (
                    /* No key handler here, on purpose. In the ARIA combobox
                       pattern the options are not focus targets: DOM focus
                       stays in the text field above, which owns
                       ArrowUp/ArrowDown/Home/End/Enter/Escape and publishes the
                       highlight through `aria-activedescendant`. A keydown
                       listener on an element that can never hold focus would be
                       unreachable code, so the click handler stands alone as
                       the pointer affordance. */
                    <div
                      key={command.id}
                      id={`${baseId}-option-${command.id}`}
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? 'or-palette__option or-palette__option--active'
                          : 'or-palette__option'
                      }
                      onMouseMove={() => setRequestedIndex(index)}
                      onClick={() => run(command)}
                    >
                      {command.icon ? (
                        <Icon name={command.icon} size={16} className="or-palette__icon" />
                      ) : (
                        <span className="or-palette__icon" aria-hidden="true" />
                      )}
                      <span className="or-palette__label">{command.label}</span>
                      {command.hint ? (
                        <span className="or-palette__meta">{command.hint}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <p className="or-palette__footer or-caption">{t('shell.palette.footer')}</p>
      </dialog>
    </div>
  );
}

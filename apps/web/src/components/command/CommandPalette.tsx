'use client';

import { Icon, Input } from '@openrunic/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { usePatients } from '@/lib/api';
import { formatDate, formatMrn, formatName } from '@/lib/format';

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

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  if (!isOpen) return null;
  return <CommandPaletteDialog onClose={close} />;
}

interface CommandPaletteDialogProps {
  onClose: () => void;
}

function CommandPaletteDialog({ onClose }: CommandPaletteDialogProps) {
  const router = useRouter();
  const { commands } = useCommandPalette();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [requestedIndex, setActiveIndex] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
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
          <span>Born {formatDate(patient.birthDate)}</span>
        </span>
      ),
    }));
  }, [patients.data]);

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

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // Stepped from the clamped index, so a wrap is always in range even when
      // the previous keystroke shortened the result list.
      setActiveIndex((activeIndex + step + flat.length) % flat.length);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(flat.length - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      run(flat[activeIndex]);
      return;
    }

    if (event.key === 'Tab') {
      // The dialog is modal, so Tab cycles inside it rather than escaping to
      // the page behind, which would leave an open overlay nobody can close.
      const stops = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const atEdge = document.activeElement === (event.shiftKey ? first : last);
      if (!atEdge) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  const activeCommand = flat[activeIndex];
  const activeOptionId = activeCommand ? `${baseId}-option-${activeCommand.id}` : undefined;

  return (
    <div className="or-palette">
      {/* The scrim closes on click, and is hidden from assistive technology:
          Escape is the keyboard route out, and a second "close" node would only
          add noise to the dialog's reading order. */}
      <div className="or-palette__scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="or-palette__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="or-visually-hidden">
          Command palette
        </h2>

        <div ref={inputWrapRef} className="or-palette__field">
          <Input
            label="Search patients, screens and actions"
            placeholder="Type a patient, a screen, or an action"
            iconLeft="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
          />
        </div>

        <div id={listId} className="or-palette__list" role="listbox" aria-label="Results">
          {sections.length === 0 ? (
            <p className="or-palette__empty or-body">
              Nothing matches {`"${query.trim()}"`}. Try a patient name, an MRN, or a screen.
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
                  {section.label}
                  <span className="or-palette__count"> ({section.commands.length})</span>
                </p>
                {section.commands.map((command) => {
                  const index = flat.indexOf(command);
                  const selected = index === activeIndex;
                  return (
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
                      onMouseMove={() => setActiveIndex(index)}
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

        <p className="or-palette__footer or-caption">
          Arrow keys move, Enter opens, Escape closes.
        </p>
      </div>
    </div>
  );
}

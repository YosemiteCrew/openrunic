import type { Addendum, EmittedItem, EncounterNote, NoteSection } from '@/lib/api/chart';

/**
 * The note being edited, as one value.
 *
 * Signing is not one change: it stamps a signature, moves the state, and locks
 * every block at the same instant. Held as four separate `useState` values that
 * was four setter calls that a reader had to trust were all present, and a
 * half-applied signature is the one shape a note must never take. As a reducer
 * it is a single transition, and the invariant "signed implies a signature"
 * lives in one place that can be tested without rendering anything.
 */

export interface NoteDraft {
  sections: NoteSection[];
  state: EncounterNote['state'];
  signature: EncounterNote['signature'];
  addenda: Addendum[];
}

export type NoteDraftAction =
  | { type: 'edit'; key: NoteSection['key']; text: string }
  | { type: 'emit'; key: NoteSection['key']; item: Omit<EmittedItem, 'id'> }
  /**
   * The note as the server now holds it, after a signature or an addendum.
   *
   * The two write transitions used to be built here from a name and a clock,
   * which meant the screen decided what a signature said. The server decides
   * that, and this is how its answer replaces the draft wholesale rather than
   * being merged field by field into a value that could end up half-signed.
   */
  | { type: 'replace'; note: EncounterNote };

export function initialDraft(note: EncounterNote): NoteDraft {
  return {
    sections: [...note.sections],
    state: note.state,
    signature: note.signature,
    addenda: [...note.addenda],
  };
}

/** A signed note is read-only. Corrections go through an addendum, never an edit. */
export function isLocked(draft: NoteDraft): boolean {
  return draft.state === 'SIGNED' || draft.state === 'COSIGN_PENDING';
}

function mapSection(
  draft: NoteDraft,
  key: NoteSection['key'],
  change: (section: NoteSection) => NoteSection
): NoteDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) => (section.key === key ? change(section) : section)),
  };
}

export function reduceNoteDraft(draft: NoteDraft, action: NoteDraftAction): NoteDraft {
  // Every edit path is refused once the note is signed, in the reducer rather
  // than in the component, so no future caller can reach round the lock. A
  // replacement is not an edit: it is the server's own answer arriving.
  if (isLocked(draft) && action.type !== 'replace') return draft;

  switch (action.type) {
    case 'edit':
      return mapSection(draft, action.key, (section) => ({ ...section, text: action.text }));

    case 'emit':
      return mapSection(draft, action.key, (section) => ({
        ...section,
        emitted: [
          ...section.emitted,
          { ...action.item, id: `${section.key}-${section.emitted.length + 1}` },
        ],
      }));

    case 'replace':
      return initialDraft(action.note);
  }
}

import type { Addendum, EmittedItem, EncounterNote, NoteSection } from '@/lib/api/chart';

import { contentHash } from './content-hash';

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

export const ATTESTATION = 'I attest that this note records the care I provided at this visit.';

export interface NoteDraft {
  sections: NoteSection[];
  state: EncounterNote['state'];
  signature: EncounterNote['signature'];
  addenda: Addendum[];
}

export type NoteDraftAction =
  | { type: 'edit'; key: NoteSection['key']; text: string }
  | { type: 'emit'; key: NoteSection['key']; item: Omit<EmittedItem, 'id'> }
  | { type: 'sign'; signerName: string; credential: string; signedAt: string }
  | {
      type: 'addendum';
      authorName: string;
      credential: string;
      addedAt: string;
      text: string;
    };

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
  // than in the component, so no future caller can reach round the lock.
  if (isLocked(draft) && action.type !== 'addendum') return draft;

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

    case 'sign':
      return {
        ...draft,
        state: 'SIGNED',
        signature: {
          signerName: action.signerName,
          credential: action.credential,
          signedAt: action.signedAt,
          attestation: ATTESTATION,
          // Hashed from the sections this transition is signing, so the hash can
          // never describe text the signature did not cover.
          hash: contentHash(draft.sections),
        },
      };

    case 'addendum':
      return {
        ...draft,
        addenda: [
          ...draft.addenda,
          {
            id: `addendum-${draft.addenda.length + 1}`,
            authorName: action.authorName,
            credential: action.credential,
            addedAt: action.addedAt,
            text: action.text,
          },
        ],
      };
  }
}

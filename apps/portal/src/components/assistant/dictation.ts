/**
 * Asking by voice, as a reducer and one string function.
 *
 * The rules that decide whether a microphone is open live here rather than in a
 * component, for the same reason the transcript's and the voice's do: they read
 * as one file and are tested without a browser, a microphone or a permission
 * prompt.
 *
 * Three of them are load-bearing.
 *
 * **Permission is not authorisation.** A browser remembers that this origin may
 * use the microphone, and a reader who allowed it once is never asked again. So
 * nothing here starts from a page load, a chart arriving, the switch next door,
 * or a previous session: {@link IDLE} is the state this ships in and the state
 * every ending returns to, and the only action that opens a microphone is one a
 * hand produced. `continuous` is off in the adapter for the other half of the
 * same rule - one press is one question, not a microphone that stays open.
 *
 * **What is shown is the microphone, not the button.** `listening` is set by the
 * adapter saying audio is being captured, never by the press that asked for it.
 * Between the two sits the permission prompt, which is exactly where a label
 * drawn from the press would claim an open microphone that is not open - the one
 * moment the claim is most alarming to get wrong.
 *
 * **A stopped session cannot speak into the next one.** Every event names the
 * session it belongs to and is a claim about it rather than an instruction, so a
 * result that arrives after the reader signed out, changed record or cut the
 * microphone finds nothing waiting for it. Without that, the last thing said
 * over one record would appear in a question about another.
 */

/** What the microphone is doing. Three states, and the reader sees all three. */
export type DictationPhase =
  /** Nothing is open and nothing was asked for. */
  | 'idle'
  /** The microphone was asked for. The permission prompt lives in here. */
  | 'starting'
  /** Audio is being captured, as reported by the thing capturing it. */
  | 'listening';

/** How the last session ended. The surface says the five that are not `none` out loud. */
export type DictationEnding =
  'none' | 'denied' | 'no-speech' | 'no-audio' | 'off-device' | 'failed';

/** The stretch of listening whose events still count. */
export interface DictationSession {
  id: string;
}

export interface DictationState {
  phase: DictationPhase;
  session: DictationSession | null;
  /**
   * The words recognised so far and not yet settled, shown while they arrive.
   *
   * Dropped rather than kept when a session ends, because an interim result is
   * the recogniser's guess mid-sentence: what it settles on is what goes in the
   * box, and half of a guess is not a question anybody asked.
   */
  heard: string;
  ended: DictationEnding;
}

export const IDLE: DictationState = {
  phase: 'idle',
  session: null,
  heard: '',
  ended: 'none',
};

export type DictationAction =
  /** The reader pressed the control. The id is this session's, and comes back on every event. */
  | { kind: 'ask'; id: string }
  /** The adapter reports the microphone is open. */
  | { kind: 'listening'; id: string }
  /** Words arrived. A final one has already gone to the box by the time this lands. */
  | { kind: 'heard'; id: string; text: string; final: boolean }
  /** The adapter reports the session is over, however it got there. */
  | { kind: 'ended'; id: string }
  | { kind: 'failed'; id: string; reason: Exclude<DictationEnding, 'none'> }
  /**
   * The session or the record underneath changed: signed out, or a different
   * chart. The microphone goes, the words in flight go, and what is already in
   * the box stays, because those are the reader's own words and they typed them.
   */
  | { kind: 'revoke' };

/**
 * Whether an event is about the session that is actually open.
 *
 * It answers no in two situations a real adapter produces. Nothing is open,
 * because the reader was signed out or moved - and the recogniser reports the
 * aborted session's `end`, and sometimes one last result, a moment later. Or
 * something else is open, because the reader pressed again.
 */
function isCurrent(state: DictationState, id: string): boolean {
  return state.session?.id === id;
}

export function dictationReducer(state: DictationState, action: DictationAction): DictationState {
  switch (action.kind) {
    case 'ask':
      /* Pressing again while a microphone is open is not a second microphone.
         The control says "stop" at that point, so this is a double press or a
         stray key, and the answer to both is the session already running. */
      if (state.session !== null) return state;
      return { phase: 'starting', session: { id: action.id }, heard: '', ended: 'none' };

    case 'listening':
      return isCurrent(state, action.id) ? { ...state, phase: 'listening' } : state;

    case 'heard':
      if (!isCurrent(state, action.id)) return state;
      /* A settled result is on its way to the box, so the line that shows what
         is being recognised has nothing left to show until the next words. */
      return { ...state, heard: action.final ? '' : action.text };

    case 'ended':
      /* All the way back, including the ending. A session that ran and stopped
         has nothing to say afterwards, and a failure always arrives as its own
         action before the `end` the recogniser reports behind it. */
      return isCurrent(state, action.id) ? IDLE : state;

    case 'failed':
      return isCurrent(state, action.id) ? { ...IDLE, ended: action.reason } : state;

    case 'revoke':
      return IDLE;
  }
}

/**
 * The dictated words, added to what is already in the box.
 *
 * Added rather than replacing: somebody who typed half a question and then said
 * the rest of it meant both halves, and a surface that swaps one for the other
 * has silently deleted something a person wrote. Sentence after sentence
 * accumulates for the same reason - the recogniser settles once per sentence,
 * and a second sentence is a continuation, not a correction.
 *
 * The limit is the API's own, applied here because the box's `maxLength` only
 * governs typing: a browser does not enforce it against a value set in code, so
 * without this a long dictation would produce a question the API refuses after
 * the fact rather than one that stopped at the length it takes.
 */
export function appendDictation(current: string, dictated: string, limit: number): string {
  const words = dictated.trim();
  if (words === '') return current;

  /* `trimEnd` rather than a trailing-whitespace pattern: the set of characters
     is the same one, and a regex anchored at the end of an 8000-character box
     is quadratic on the input that does not match it. */
  const before = current.trimEnd();
  const joined = before === '' ? words : `${before} ${words}`;
  return joined.slice(0, limit);
}

import { offersCareTeam } from './transcript';
import type { AssistantTurn } from './transcript';

/**
 * Reading an answer aloud, as a reducer and one predicate.
 *
 * Everything that decides whether a patient hears something is here rather than
 * in a component, for the same reason the transcript is: the rules read as one
 * file and are tested without a browser or a voice.
 *
 * Two of them are load-bearing.
 *
 * **What is spoken is the text that is already on the screen.** Not the words
 * the model produced, not the transcript before it settled, and not a summary.
 * {@link speakableAnswer} returns the very string the turn renders, so there is
 * no second path from a record to the reader's ears. ADR-0006 refuses to show
 * an answer whose sources never arrived; an answer nobody may read is an answer
 * nobody may hear, and this is what makes that one rule rather than two.
 *
 * **An interrupted answer was not heard.** Stopping is not a quiet way of
 * finishing. An ending is only believed while the utterance it names is still
 * the one being spoken, so the ending a cancelled utterance reports - which is
 * the same `end` a finished one reports, on every browser - arrives to find
 * nothing waiting for it. Without that, a voice cut off halfway through an
 * amount owed would be recorded as delivered, and the one thing a patient must
 * be able to trust about a number read out is that they heard all of it.
 */

/**
 * The exact words this turn may be read aloud as, or null for silence.
 *
 * `offersCareTeam` is the surface's own test for "this turn has no checkable
 * answer on it", covering withheld text, failures, deferrals and an empty
 * answer alike. Reusing it rather than restating its clauses is deliberate: a
 * future reason to route somebody to their care team is, by construction, a
 * future reason not to read an answer out, and this stays correct without
 * anybody remembering to come here.
 *
 * A stopped turn is silent even though its kept sentences are on screen. The
 * reader stopped it; starting to speak the fragment they cut short would be
 * this surface answering a question that was withdrawn.
 */
export function speakableAnswer(turn: AssistantTurn): string | null {
  if (turn.outcome !== 'completed') return null;
  if (offersCareTeam(turn)) return null;
  return turn.answer;
}

/** The utterance the voice is on. Nothing else's ending is believed. */
export interface Speaking {
  turnId: string;
  /**
   * The words, copied off the turn at the moment it was found speakable.
   *
   * Carried here rather than looked up again when the voice is reached, so that
   * the text that was checked is the text that is spoken. A second lookup is a
   * second answer to the same question, and the gap between them is where a
   * turn that changed in between would be read out under a check it no longer
   * passes.
   */
  text: string;
}

/** How the last utterance ended. The surface says three of these four out loud. */
export type ReadbackEnding = 'none' | 'heard' | 'interrupted' | 'failed';

export interface ReadbackState {
  /** The reader asked for this. Off until they do, and off again on every revoke. */
  on: boolean;
  speaking: Speaking | null;
  /**
   * Every turn readback has already been offered, whether it was spoken or not.
   *
   * Turns settled while the switch was off are in here too, which is what stops
   * flipping it on from reading the whole conversation back at somebody who
   * asked for the next answer.
   *
   * A set rather than a list because it is read once per turn on screen every
   * time the transcript changes, which is once per word of the answer arriving.
   */
  attempted: ReadonlySet<string>;
  ended: ReadbackEnding;
}

export const SILENT: ReadbackState = {
  on: false,
  speaking: null,
  attempted: new Set(),
  ended: 'none',
};

export type ReadbackAction =
  | { kind: 'on' }
  /** The reader turned it off. Mid-answer, that is also an interruption. */
  | { kind: 'off' }
  /** A turn settled. Spoken when the switch is on, recorded as offered either way. */
  | { kind: 'speak'; turnId: string; text: string }
  | { kind: 'finished'; turnId: string }
  | { kind: 'failed'; turnId: string }
  /** The reader pressed stop. */
  | { kind: 'interrupt' }
  /**
   * The session or the record underneath changed: signed out, or a different
   * chart. Everything goes, including the reader's own consent to be read to.
   */
  | { kind: 'revoke' };

/**
 * Whether an event is about the utterance that is actually speaking.
 *
 * It answers no in two different situations, and both are ones a real adapter
 * produces. Nothing is speaking, because the reader stopped it - and the
 * browser reports the cancelled utterance's `end` a moment later. Or something
 * else is speaking, because the next answer had already started.
 *
 * A turn is offered to the voice at most once, so the utterance's own id is
 * enough to tell those from a real ending. A sequence number beside it would
 * have no case of its own to catch, and a guard with no case is a sentence
 * claiming a check that is not happening.
 */
function isCurrent(state: ReadbackState, turnId: string): boolean {
  return state.speaking?.turnId === turnId;
}

function stopped(state: ReadbackState, ending: ReadbackEnding): ReadbackState {
  /* Stopping when nothing is speaking leaves the last ending alone: there is no
     new fact about the voice, and overwriting it would wipe a failure sentence
     off the screen the moment somebody flipped the switch. */
  if (state.speaking === null) return state;
  return { ...state, speaking: null, ended: ending };
}

export function readbackReducer(state: ReadbackState, action: ReadbackAction): ReadbackState {
  switch (action.kind) {
    case 'on':
      return { ...state, on: true };

    case 'off':
      return { ...stopped(state, 'interrupted'), on: false };

    case 'interrupt':
      return stopped(state, 'interrupted');

    case 'speak': {
      const attempted = new Set(state.attempted).add(action.turnId);
      if (!state.on) return { ...state, attempted };
      return {
        ...state,
        attempted,
        speaking: { turnId: action.turnId, text: action.text },
        ended: 'none',
      };
    }

    case 'finished':
      return isCurrent(state, action.turnId) ? { ...state, speaking: null, ended: 'heard' } : state;

    case 'failed':
      return isCurrent(state, action.turnId)
        ? { ...state, speaking: null, ended: 'failed' }
        : state;

    case 'revoke':
      return SILENT;
  }
}

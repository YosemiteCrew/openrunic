/**
 * Reading an answer aloud, as a reducer.
 *
 * Everything that decides whether an utterance is spoken, believed or forgotten
 * is here rather than in a component or an adapter, for the same reason the
 * transcript is: the rules read as one file and are tested without a browser or
 * a voice.
 *
 * One of them is load-bearing.
 *
 * **An interrupted answer was not heard.** Stopping is not a quiet way of
 * finishing. An ending is only believed while the utterance it names is still
 * the one being spoken, so the ending a cancelled utterance reports - which is
 * the same `end` a finished one reports, on every browser - arrives to find
 * nothing waiting for it. Without that, a voice cut off halfway through an
 * amount owed would be recorded as delivered, and the one thing a reader must
 * be able to trust about a number read out is that they heard all of it.
 *
 * The other rule - *which* answers may be read aloud at all - is not here. It
 * is the surface's own test for what it is willing to show, handed to
 * {@link ./useReadback.ts} as an argument, because an answer nobody may read is
 * an answer nobody may hear and that has to stay one sentence rather than two.
 *
 * That argument is one-way, and {@link endingFor} is what the other direction
 * costs: an ending carries the turn it is about, so a surface can tell whether
 * the answer it describes is still the one on screen without the voice ever
 * learning about the turns that surface refused.
 */

/**
 * A turn and the exact words it may be read aloud as.
 *
 * Two roles, one shape, deliberately: it is what a surface offers the voice and
 * it is what the voice is on. Keeping them the same type is what makes "the
 * text that was checked is the text that is spoken" a thing you can see rather
 * than a thing you have to trace.
 */
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
  /**
   * The turn `ended` is about, and null exactly when it is `none`.
   *
   * An ending is a fact about one answer, and a surface is where that answer
   * either is or is not still the one being looked at. Carrying the id is what
   * lets it say so: this hook cannot be told that a turn it was never offered
   * has arrived - see {@link ./useReadback.ts} - so the ending has to be
   * identifiable from the outside instead. {@link endingFor} is that reading.
   */
  endedTurnId: string | null;
}

export const SILENT: ReadbackState = {
  on: false,
  speaking: null,
  attempted: new Set(),
  ended: 'none',
  endedTurnId: null,
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

/**
 * The one place an utterance stops being the one being spoken.
 *
 * Every ending goes through here - read to the end, cut off, or failed - so
 * `ended` and the turn it is about are written together and cannot drift.
 */
function stopped(state: ReadbackState, ending: ReadbackEnding): ReadbackState {
  /* Stopping when nothing is speaking leaves the last ending alone: there is no
     new fact about the voice, and overwriting it would wipe a failure sentence
     off the screen the moment somebody flipped the switch. */
  if (state.speaking === null) return state;
  return { ...state, speaking: null, ended: ending, endedTurnId: state.speaking.turnId };
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
        endedTurnId: null,
      };
    }

    case 'finished':
      return isCurrent(state, action.turnId) ? stopped(state, 'heard') : state;

    case 'failed':
      return isCurrent(state, action.turnId) ? stopped(state, 'failed') : state;

    case 'revoke':
      return SILENT;
  }
}

/**
 * How the last utterance ended, while the answer it is about is still the last
 * one on screen. `none` once the conversation has moved past it.
 *
 * The sentence a surface draws from an ending - that an answer was stopped, or
 * could not be read - is about one answer, and it stops being true of the
 * screen the moment a later answer is the one under it. That happens without
 * the voice hearing anything: a turn this surface refuses to read is a turn the
 * hook is never told about, deliberately, so an ending cannot be retired from
 * the inside.
 *
 * The reading is left here, with the rules, rather than written out at each
 * surface: what the surface supplies is a fact it already has - the last turn
 * it drew - and not a second thing it has to remember to keep in step.
 *
 * `null` for a conversation with nothing in it, which no ending can be about.
 */
export function endingFor(state: ReadbackState, lastTurnId: string | null): ReadbackEnding {
  return state.endedTurnId === lastTurnId ? state.ended : 'none';
}

/**
 * The turns a surface will have read aloud, in the words it shows for them.
 *
 * Stated once here rather than written out at each surface, because the shape
 * of the answer is the contract - a turn id and the rendered string, and
 * nothing else about the record - and the mapping is where a surface could
 * quietly hand the voice something other than what it drew on screen.
 *
 * The rule itself stays with the surface: what a patient may be told and what a
 * biller may be told are different sentences.
 */
export function speakableTurns<Turn extends { id: string }>(
  turns: readonly Turn[],
  rule: (turn: Turn) => string | null
): readonly Speaking[] {
  return turns.flatMap((turn) => {
    const text = rule(turn);
    return text === null ? [] : [{ turnId: turn.id, text }];
  });
}

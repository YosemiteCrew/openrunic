import { describe, expect, it } from 'vitest';
import { SILENT, endingFor, readbackReducer } from '../readback.js';
import type { ReadbackAction, ReadbackState } from '../readback.js';

/**
 * What "heard" is allowed to mean.
 *
 * Driven as a reducer rather than through a browser, because the case that
 * matters most - an utterance the reader cut off, whose `end` the device
 * reports anyway - is one a rendering test reaches only by accident.
 *
 * *Which* answers may be read aloud is not this file's question. That rule
 * belongs to the surface and is asserted where the surface is.
 */

/** The words on the screen, which are the only words an utterance ever carries. */
const SAID = 'You are next in on 4 March at 10:15.';

function reduce(state: ReadbackState, ...actions: readonly ReadbackAction[]): ReadbackState {
  return actions.reduce(readbackReducer, state);
}

describe('the switch', () => {
  it('starts off, and a settled turn with it off is recorded rather than spoken', () => {
    const state = reduce(SILENT, { kind: 'speak', turnId: 'turn-1', text: SAID });

    expect(SILENT.on).toBe(false);
    expect(state.speaking).toBeNull();
    expect(state.attempted).toEqual(new Set(['turn-1']));
  });

  it('does not read the conversation so far back when it is turned on', () => {
    /* The turn was recorded as offered while the switch was off, so turning the
       switch on finds nothing outstanding. Without that, somebody who flipped
       it would be read every answer they had already read. */
    const state = reduce(SILENT, { kind: 'speak', turnId: 'turn-1', text: SAID }, { kind: 'on' });

    expect(state.attempted).toEqual(new Set(['turn-1']));
    expect(state.speaking).toBeNull();
  });

  it('speaks a turn that settles after it is on', () => {
    const state = reduce(SILENT, { kind: 'on' }, { kind: 'speak', turnId: 'turn-1', text: SAID });

    expect(state.speaking).toEqual({ turnId: 'turn-1', text: SAID });
    expect(state.ended).toBe('none');
  });
});

describe('how an utterance ends', () => {
  const speaking = reduce(SILENT, { kind: 'on' }, { kind: 'speak', turnId: 'turn-1', text: SAID });

  it('records an answer read in full as heard', () => {
    const state = reduce(speaking, { kind: 'finished', turnId: 'turn-1' });

    expect(state.ended).toBe('heard');
    expect(state.speaking).toBeNull();
  });

  it('records an answer the reader stopped as interrupted, never as heard', () => {
    const state = reduce(speaking, { kind: 'interrupt' });

    expect(state.ended).toBe('interrupted');
    expect(state.speaking).toBeNull();
  });

  it('drops an ending that arrives after the utterance was stopped', () => {
    /* The load-bearing one. A browser reports the same `end` for an utterance it
       was told to cancel as for one it read to the last word, so an ending that
       arrives after a stop must be identifiable as late - or an answer cut off
       halfway through an amount owed is recorded as delivered. */
    const state = reduce(speaking, { kind: 'interrupt' }, { kind: 'finished', turnId: 'turn-1' });

    expect(state.ended).toBe('interrupted');
  });

  it('drops an ending from an utterance a later one replaced', () => {
    const state = reduce(
      speaking,
      { kind: 'speak', turnId: 'turn-2', text: SAID },
      { kind: 'finished', turnId: 'turn-1' }
    );

    expect(state.speaking).toEqual({ turnId: 'turn-2', text: SAID });
    expect(state.ended).toBe('none');
  });

  it('drops an ending about a turn that is not the one speaking', () => {
    const state = reduce(speaking, { kind: 'finished', turnId: 'turn-9' });

    expect(state.speaking).toEqual({ turnId: 'turn-1', text: SAID });
    expect(state.ended).toBe('none');
  });

  it('records a voice that could not speak as a failure', () => {
    const state = reduce(speaking, { kind: 'failed', turnId: 'turn-1' });

    expect(state.ended).toBe('failed');
    expect(state.speaking).toBeNull();
  });

  it('drops a failure that arrives after the utterance was stopped', () => {
    const state = reduce(speaking, { kind: 'interrupt' }, { kind: 'failed', turnId: 'turn-1' });

    expect(state.ended).toBe('interrupted');
  });
});

describe('turning it off and being cut off', () => {
  const speaking = reduce(SILENT, { kind: 'on' }, { kind: 'speak', turnId: 'turn-1', text: SAID });

  it('turning it off mid-answer is an interruption as well as a setting', () => {
    const state = reduce(speaking, { kind: 'off' });

    expect(state.on).toBe(false);
    expect(state.speaking).toBeNull();
    expect(state.ended).toBe('interrupted');
  });

  it('leaves a failure on screen when the switch is flipped afterwards', () => {
    /* Flipping a switch is not new information about the last answer, and
       wiping the sentence that says it could not be read would leave silence
       with no explanation anywhere. */
    const failed = reduce(speaking, { kind: 'failed', turnId: 'turn-1' });
    const state = reduce(failed, { kind: 'off' });

    expect(state.ended).toBe('failed');
    expect(state.on).toBe(false);
  });

  it('stopping when nothing is speaking changes nothing', () => {
    const heard = reduce(speaking, { kind: 'finished', turnId: 'turn-1' });

    expect(reduce(heard, { kind: 'interrupt' })).toBe(heard);
  });
});

describe('which answer an ending is about', () => {
  const speaking = reduce(SILENT, { kind: 'on' }, { kind: 'speak', turnId: 'turn-1', text: SAID });

  it('names the utterance it is about, whichever way that utterance ended', () => {
    for (const [state, ending] of [
      [reduce(speaking, { kind: 'interrupt' }), 'interrupted'],
      [reduce(speaking, { kind: 'off' }), 'interrupted'],
      [reduce(speaking, { kind: 'failed', turnId: 'turn-1' }), 'failed'],
      [reduce(speaking, { kind: 'finished', turnId: 'turn-1' }), 'heard'],
    ] as const) {
      expect(state.ended).toBe(ending);
      expect(state.endedTurnId).toBe('turn-1');
    }
  });

  it('has nothing to be about until an utterance has ended', () => {
    expect(SILENT.endedTurnId).toBeNull();
    expect(speaking.endedTurnId).toBeNull();
  });

  it('forgets the last one when the next utterance begins', () => {
    const state = reduce(
      speaking,
      { kind: 'interrupt' },
      { kind: 'speak', turnId: 'turn-2', text: SAID }
    );

    expect(state.ended).toBe('none');
    expect(state.endedTurnId).toBeNull();
  });

  it('is an ending about a turn or no ending at all, in every state these actions reach', () => {
    /* The two fields are written together in one place. This is the assertion
       that says so, over every state a sequence of actions can produce: an
       `endedTurnId` beside `none`, or an ending about no turn, is a state the
       surface below would read as a sentence about the wrong answer. */
    const actions = [
      { kind: 'on' },
      { kind: 'off' },
      { kind: 'speak', turnId: 'turn-1', text: SAID },
      { kind: 'speak', turnId: 'turn-2', text: SAID },
      { kind: 'interrupt' },
      { kind: 'finished', turnId: 'turn-1' },
      { kind: 'failed', turnId: 'turn-2' },
      { kind: 'revoke' },
    ] as const satisfies readonly ReadbackAction[];

    /* Four deep, because the shortest sequence that could separate them is
       four: on, speak, interrupt, speak again - the last of those is where an
       ending is dropped and a turn id could be left behind it. */
    const DEPTH = 4;
    let seen = 0;

    const walk = (state: ReadbackState, left: number): void => {
      expect((state.ended === 'none') === (state.endedTurnId === null)).toBe(true);
      seen += 1;
      if (left === 0) return;
      for (const action of actions) walk(readbackReducer(state, action), left - 1);
    };
    walk(SILENT, DEPTH);

    /* The walk ran rather than the assertion being true of nothing. */
    expect(seen).toBe([0, 1, 2, 3, 4].reduce((total, depth) => total + actions.length ** depth, 0));
  });
});

describe('the ending a surface should say out loud', () => {
  const speaking = reduce(SILENT, { kind: 'on' }, { kind: 'speak', turnId: 'turn-1', text: SAID });

  it('says how the answer ended while that answer is the last one on screen', () => {
    const stopped = reduce(speaking, { kind: 'interrupt' });

    expect(endingFor(stopped, 'turn-1')).toBe('interrupted');
  });

  it('says nothing once a later answer is the one on screen', () => {
    /* #530. The later turn is one the surface refused to read - a deferral, a
       failure, a proposal - so the voice was never told it arrived, and the
       sentence about the answer before it would sit under an answer it is not
       about. */
    const stopped = reduce(speaking, { kind: 'interrupt' });

    expect(endingFor(stopped, 'turn-2')).toBe('none');
  });

  it('says nothing where there is no conversation for an ending to be about', () => {
    const stopped = reduce(speaking, { kind: 'interrupt' });

    expect(endingFor(stopped, null)).toBe('none');
    expect(endingFor(SILENT, null)).toBe('none');
  });
});

describe('a different record underneath', () => {
  it('forgets the voice, the consent and everything already offered', () => {
    const heard = reduce(
      SILENT,
      { kind: 'on' },
      { kind: 'speak', turnId: 'turn-1', text: SAID },
      { kind: 'finished', turnId: 'turn-1' }
    );

    expect(readbackReducer(heard, { kind: 'revoke' })).toEqual(SILENT);
  });
});

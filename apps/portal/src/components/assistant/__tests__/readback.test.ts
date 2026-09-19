import { describe, expect, it } from 'vitest';
import { SILENT, readbackReducer, speakableAnswer } from '@/components/assistant';
import type { AssistantTurn, ReadbackAction, ReadbackState } from '@/components/assistant';

/**
 * What may be read aloud, and what "heard" is allowed to mean.
 *
 * Both halves are driven here rather than through a browser, because the two
 * cases that matter most - a turn whose records never arrived, and an utterance
 * the reader cut off - are ones a rendering test reaches only by accident.
 */

const ANSWERED: AssistantTurn = {
  id: 'turn-1',
  question: 'When am I next in?',
  answer: 'You are next in on 4 March at 10:15.',
  steps: [],
  sources: [{ resourceType: 'Appointment', resourceId: 'a-1', label: '4 March', untrusted: false }],
  failures: [],
  deferrals: [],
  outcome: 'completed',
  withheld: 'none',
};

/** The words on the screen, which are the only words an utterance ever carries. */
const SAID = ANSWERED.answer;

function reduce(state: ReadbackState, ...actions: readonly ReadbackAction[]): ReadbackState {
  return actions.reduce(readbackReducer, state);
}

describe('what may be read aloud', () => {
  it('reads back the very string the turn shows, and not a word more', () => {
    expect(speakableAnswer(ANSWERED)).toBe('You are next in on 4 March at 10:15.');
  });

  it('says nothing for an answer whose records never arrived', () => {
    /* The surface shows nothing for this turn. ADR-0006 refuses an unsourced
       answer on screen; saying it out loud would be the same claim through the
       one output nobody can check against a citation. */
    expect(speakableAnswer({ ...ANSWERED, answer: '', withheld: 'unsourced' })).toBeNull();
  });

  it('says nothing for a turn the reader stopped, even with sentences kept', () => {
    expect(speakableAnswer({ ...ANSWERED, outcome: 'stopped' })).toBeNull();
  });

  it('says nothing while the answer is still arriving', () => {
    expect(speakableAnswer({ ...ANSWERED, outcome: null })).toBeNull();
  });

  it('says nothing for a question that never left the phone', () => {
    expect(
      speakableAnswer({ ...ANSWERED, outcome: 'redirected', withheld: 'care-team' })
    ).toBeNull();
  });

  it('says nothing when something failed, however complete the words look', () => {
    expect(speakableAnswer({ ...ANSWERED, failures: ['AGENT_TOOL_FAILED'] })).toBeNull();
  });

  it('says nothing when part of the turn was not gone ahead with', () => {
    expect(
      speakableAnswer({ ...ANSWERED, deferrals: ['Booking is done by a person.'] })
    ).toBeNull();
  });
});

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

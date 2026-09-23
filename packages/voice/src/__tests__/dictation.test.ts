import { describe, expect, it } from 'vitest';
import { IDLE, appendDictation, dictationReducer } from '../index.js';
import type { DictationAction, DictationState } from '../index.js';

/**
 * The rules about an open microphone, without a microphone.
 *
 * Three of these decide whether the feature is safe rather than whether it is
 * pleasant: nothing opens without a press, the surface only claims an open
 * microphone once something has reported one, and a session that is over cannot
 * write into the one after it.
 */

function run(actions: readonly DictationAction[], from: DictationState = IDLE): DictationState {
  return actions.reduce(dictationReducer, from);
}

const ASK: DictationAction = { kind: 'ask', id: 'session-1' };

describe('nothing opens by itself', () => {
  it('ships closed', () => {
    expect(IDLE).toEqual({ phase: 'idle', session: null, heard: '', ended: 'none' });
  });

  it('opens only on a press, and a second press is not a second microphone', () => {
    const asked = run([ASK]);
    expect(asked.phase).toBe('starting');

    expect(run([{ kind: 'ask', id: 'session-2' }], asked)).toBe(asked);
  });

  it('clears the last failure when a new question is asked', () => {
    const failed = run([ASK, { kind: 'failed', id: 'session-1', reason: 'denied' }]);
    expect(failed.ended).toBe('denied');

    expect(run([{ kind: 'ask', id: 'session-2' }], failed).ended).toBe('none');
  });
});

describe('what it says the microphone is doing', () => {
  it('is not listening until something says audio is being captured', () => {
    /* The gap between the press and this is the permission prompt, which is the
       one moment a label drawn from the press would be both wrong and alarming. */
    expect(run([ASK]).phase).toBe('starting');
    expect(run([ASK, { kind: 'listening', id: 'session-1' }]).phase).toBe('listening');
  });

  it('shows the words as they arrive and clears them once they are settled', () => {
    const heard = run([
      ASK,
      { kind: 'listening', id: 'session-1' },
      { kind: 'heard', id: 'session-1', text: 'when is my', final: false },
    ]);
    expect(heard.heard).toBe('when is my');

    const settled = run(
      [{ kind: 'heard', id: 'session-1', text: 'when is my appointment', final: true }],
      heard
    );
    /* The settled words are in the box by now. Leaving them here as well would
       show the same sentence twice, in two places, one of them uneditable. */
    expect(settled.heard).toBe('');
  });

  it('drops words in flight when the session ends', () => {
    const cut = run([
      ASK,
      { kind: 'listening', id: 'session-1' },
      { kind: 'heard', id: 'session-1', text: 'when is my', final: false },
      { kind: 'ended', id: 'session-1' },
    ]);

    expect(cut).toEqual(IDLE);
  });

  it('says why nothing was heard, and closes', () => {
    for (const reason of ['denied', 'no-speech', 'no-audio', 'off-device', 'failed'] as const) {
      const failed = run([ASK, { kind: 'failed', id: 'session-1', reason }]);
      expect(failed).toEqual({ ...IDLE, ended: reason });
    }
  });
});

describe('a session that is over cannot speak into the next one', () => {
  const closed = run([ASK, { kind: 'listening', id: 'session-1' }, { kind: 'revoke' }]);

  it('goes silent on a revoke, which is a different record or none', () => {
    expect(closed).toEqual(IDLE);
  });

  it.each([
    ['listening', { kind: 'listening', id: 'session-1' }],
    ['words', { kind: 'heard', id: 'session-1', text: 'my card number is', final: false }],
    ['an ending', { kind: 'ended', id: 'session-1' }],
    ['a failure', { kind: 'failed', id: 'session-1', reason: 'denied' }],
  ] as const)('ignores %s that arrives after it', (_label, action) => {
    expect(dictationReducer(closed, action)).toBe(closed);
  });

  it('does not close the microphone somebody has since opened', () => {
    /* The case the block is named for, and the only one that separates the
       guard from its absence: after a revoke every state is the closed one, so
       an ending that wrongly returns "closed" is indistinguishable from the
       ending being ignored. Here there is a second session to lose. */
    const second = run([
      ASK,
      { kind: 'listening', id: 'session-1' },
      { kind: 'ended', id: 'session-1' },
      { kind: 'ask', id: 'session-2' },
      { kind: 'listening', id: 'session-2' },
    ]);
    expect(second.session).toEqual({ id: 'session-2' });

    expect(dictationReducer(second, { kind: 'ended', id: 'session-1' })).toBe(second);
    expect(dictationReducer(second, { kind: 'failed', id: 'session-1', reason: 'no-speech' })).toBe(
      second
    );
  });

  it('ignores an event for a different session while one is open', () => {
    const open = run([ASK, { kind: 'listening', id: 'session-1' }]);
    const stray = dictationReducer(open, {
      kind: 'heard',
      id: 'a-session-nobody-asked-for',
      text: 'somebody else in the room',
      final: true,
    });

    expect(stray).toBe(open);
  });
});

describe('where the words go', () => {
  it('adds to what is already in the box rather than replacing it', () => {
    expect(appendDictation('When is my', 'appointment', 100)).toBe('When is my appointment');
  });

  it('joins with one space however the two sides are spaced', () => {
    expect(appendDictation('When is my  ', '  appointment  ', 100)).toBe('When is my appointment');
  });

  it('is the dictated words alone when the box is empty', () => {
    expect(appendDictation('', ' what do I owe ', 100)).toBe('what do I owe');
  });

  it('leaves the box alone when nothing was said', () => {
    expect(appendDictation('When is my appointment', '   ', 100)).toBe('When is my appointment');
  });

  it('stops at the length the question can be', () => {
    /* The box's own `maxLength` only governs typing: a browser does not enforce
       it against a value set in code, so without this a long dictation makes a
       question the API refuses after the fact. */
    expect(appendDictation('abc', 'defgh', 6)).toBe('abc de');
  });
});

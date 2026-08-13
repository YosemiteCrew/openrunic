import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRANSCRIPT,
  announcementFor,
  offersCareTeam,
  transcriptReducer,
  trimToLastSentence,
} from '@/components/assistant';
import type { AssistantTurn, TranscriptState } from '@/components/assistant';
import type { AssistantEvent } from '@/lib/assistant';

/**
 * What a patient ends up seeing, decided without a DOM.
 *
 * The rule this file exists for is the one in the middle: words that arrived
 * without the records behind them are not shown. Everything else here is the
 * machinery around it.
 */

const SOURCE = {
  resourceType: 'Condition',
  resourceId: 'record-1',
  label: 'Underactive thyroid',
  untrusted: false,
};

function play(events: AssistantEvent[], question = 'What is on my record?'): TranscriptState {
  let state = transcriptReducer(EMPTY_TRANSCRIPT, { kind: 'ask', id: 'turn-1', question });
  for (const event of events) state = transcriptReducer(state, { kind: 'event', event });
  return state;
}

function lastTurn(state: TranscriptState): AssistantTurn {
  const turn = state.turns.at(-1);
  if (turn === undefined) throw new Error('expected a turn');
  return turn;
}

describe('an answer and the records behind it', () => {
  it('shows an answer that arrived with its records', () => {
    const state = play([
      { type: 'text', text: 'Your record lists one long-term condition.' },
      { type: 'sources', entries: [SOURCE] },
      { type: 'finished', outcome: 'completed' },
    ]);

    expect(lastTurn(state).answer).toBe('Your record lists one long-term condition.');
    expect(lastTurn(state).withheld).toBe('none');
    expect(state.answering).toBe(false);
  });

  it('shows nothing at all when the records never arrived', () => {
    const state = play([
      { type: 'text', text: 'Your thyroid results have been getting better.' },
      { type: 'finished', outcome: 'completed' },
    ]);

    expect(lastTurn(state).answer).toBe('');
    expect(lastTurn(state).withheld).toBe('unsourced');
  });

  it('keeps a stopped answer only as far as its last full stop', () => {
    let state = play([
      { type: 'text', text: 'You have two appointments booked. The next one is on' },
      { type: 'sources', entries: [SOURCE] },
    ]);
    state = transcriptReducer(state, { kind: 'stop' });

    expect(lastTurn(state).answer).toBe('You have two appointments booked.');
    expect(lastTurn(state).outcome).toBe('stopped');
  });

  it('shows nothing when a stop landed before the first full stop', () => {
    let state = play([
      { type: 'text', text: 'You have two appointments' },
      { type: 'sources', entries: [SOURCE] },
    ]);
    state = transcriptReducer(state, { kind: 'stop' });

    expect(lastTurn(state).answer).toBe('');
    expect(lastTurn(state).withheld).toBe('incomplete');
  });

  it('does not retroactively trim an answer that had already landed', () => {
    let state = play([
      { type: 'text', text: 'Your next appointment is booked. It is a follow-up' },
      { type: 'sources', entries: [SOURCE] },
      { type: 'finished', outcome: 'completed' },
    ]);
    state = transcriptReducer(state, { kind: 'stop' });

    expect(lastTurn(state).answer).toBe('Your next appointment is booked. It is a follow-up');
    expect(state.answering).toBe(false);
  });

  it('keeps nothing from words that never finished a sentence', () => {
    expect(trimToLastSentence('No full stop here')).toBe('');
    expect(trimToLastSentence('One. Two! Three? And a')).toBe('One. Two! Three?');
  });
});

describe('a question that is for a person', () => {
  it('settles immediately, with nothing sent and nothing to wait for', () => {
    const state = transcriptReducer(EMPTY_TRANSCRIPT, {
      kind: 'redirect',
      id: 'turn-1',
      question: 'Should I stop taking this?',
    });

    expect(lastTurn(state)).toMatchObject({ outcome: 'redirected', withheld: 'care-team' });
    expect(state.answering).toBe(false);
    expect(offersCareTeam(lastTurn(state))).toBe(true);
  });
});

describe('offering the care team', () => {
  it('offers it on every way a turn can end without a checkable answer', () => {
    const withheld = play([
      { type: 'text', text: 'Something unsourced.' },
      { type: 'finished', outcome: 'completed' },
    ]);
    const failed = play([
      { type: 'failed', code: 'AGENT_TURN_LIMIT' },
      { type: 'finished', outcome: 'failed' },
    ]);
    const deferred = play([
      { type: 'deferred', reason: 'it could not read that part' },
      { type: 'sources', entries: [SOURCE] },
      { type: 'text', text: 'Part of this worked.' },
      { type: 'finished', outcome: 'completed' },
    ]);
    const empty = play([{ type: 'finished', outcome: 'completed' }]);

    for (const state of [withheld, failed, deferred, empty]) {
      expect(offersCareTeam(lastTurn(state))).toBe(true);
    }
  });

  it('does not offer it while the turn is still running, or when the answer stands', () => {
    const running = play([{ type: 'text', text: 'Reading.' }]);
    expect(offersCareTeam(lastTurn(running))).toBe(false);

    const answered = play([
      { type: 'text', text: 'You have one appointment booked.' },
      { type: 'sources', entries: [SOURCE] },
      { type: 'finished', outcome: 'completed' },
    ]);
    expect(offersCareTeam(lastTurn(answered))).toBe(false);
  });
});

describe('steps', () => {
  it('lists each step once and remembers that it finished', () => {
    const state = play([
      { type: 'step', label: 'Reading your health record', done: false },
      { type: 'step', label: 'Reading your health record', done: true },
      { type: 'step', label: 'Reading your appointments', done: false },
    ]);

    expect(lastTurn(state).steps).toEqual([
      { key: 'Reading your health record', label: 'Reading your health record', done: true },
      { key: 'Reading your appointments', label: 'Reading your appointments', done: false },
    ]);
  });

  it('never un-finishes a step a later event describes as still running', () => {
    const state = play([
      { type: 'step', label: 'Reading your bills', done: true },
      { type: 'step', label: 'Reading your bills', done: false },
    ]);

    expect(lastTurn(state).steps[0]?.done).toBe(true);
  });
});

describe('what a screen reader hears', () => {
  it('says nothing before the first question', () => {
    expect(announcementFor(EMPTY_TRANSCRIPT)).toBe('');
  });

  it('says one sentence while an answer is arriving', () => {
    expect(announcementFor(play([{ type: 'text', text: 'Reading.' }]))).toBe(
      'Looking in your record.'
    );
  });

  it('counts the records an answer came from', () => {
    const one = play([
      { type: 'text', text: 'One thing.' },
      { type: 'sources', entries: [SOURCE] },
      { type: 'finished', outcome: 'completed' },
    ]);
    expect(announcementFor(one)).toBe('Answer ready, from 1 record.');

    const two = play([
      { type: 'text', text: 'Two things.' },
      { type: 'sources', entries: [SOURCE, { ...SOURCE, resourceId: 'record-2' }] },
      { type: 'finished', outcome: 'completed' },
    ]);
    expect(announcementFor(two)).toBe('Answer ready, from 2 records.');
  });

  it('says which kind of nothing it is', () => {
    const redirected = transcriptReducer(EMPTY_TRANSCRIPT, {
      kind: 'redirect',
      id: 'turn-1',
      question: 'Should I worry?',
    });
    expect(announcementFor(redirected)).toBe('This one is for your care team.');

    const failed = play([{ type: 'finished', outcome: 'failed' }]);
    expect(announcementFor(failed)).toBe('No answer came back.');

    const unsourced = play([
      { type: 'text', text: 'Unsourced.' },
      { type: 'finished', outcome: 'completed' },
    ]);
    expect(announcementFor(unsourced)).toBe('No answer is shown.');
  });
});

describe('events with no turn to fold into', () => {
  it('ignores an event that arrived before anything was asked', () => {
    const state = transcriptReducer(EMPTY_TRANSCRIPT, {
      kind: 'event',
      event: { type: 'text', text: 'stray' },
    });
    expect(state).toBe(EMPTY_TRANSCRIPT);
  });

  it('ignores a stop with nothing running', () => {
    expect(transcriptReducer(EMPTY_TRANSCRIPT, { kind: 'stop' })).toEqual(EMPTY_TRANSCRIPT);
  });
});

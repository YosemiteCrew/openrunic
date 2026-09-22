import { describe, expect, it } from 'vitest';

import { EMPTY_TRANSCRIPT, speakableAnswer, transcriptReducer } from '@/components/assistant';
import type { AssistantTurn, TranscriptAction } from '@/components/assistant';
import type { AgentEvent } from '@/lib/agent';

/**
 * What this surface will have read aloud.
 *
 * Driven here rather than through a browser, because the cases that matter most
 * - a turn whose records never arrived, and one carrying something the prose
 * does not say - are ones a rendering test reaches only by accident. What
 * "heard" is allowed to mean is the reducer's question and is asserted in
 * `@openrunic/voice`, against both of its adapters.
 */

const ANSWERED: AssistantTurn = {
  id: 'turn-1',
  question: 'What is still missing on this authorisation?',
  answer: 'Two requirements are unmet: the imaging report and the referral letter.',
  steps: [],
  sources: [
    {
      resourceType: 'Claim',
      resourceId: '0192f1a0-0000-7000-8000-00000000c001',
      label: 'Authorisation case, 3 March',
      untrusted: false,
    },
  ],
  drafts: [],
  deferrals: [],
  failures: [],
  outcome: 'completed',
  withheld: 'none',
};

const FINISHED: AgentEvent = {
  type: 'turn-finished',
  outcome: 'completed',
  usage: { inputTokens: 1, outputTokens: 2, costCents: 0 },
};

/**
 * A turn as the transcript actually builds one.
 *
 * The withheld cases are driven through the reducer rather than written out,
 * because what makes them silent is that `settle` empties the prose - and a
 * fixture that asserts its own empty string would go on passing on the day that
 * stopped being true.
 */
function settled(...actions: readonly TranscriptAction[]): AssistantTurn {
  const state = actions.reduce(transcriptReducer, EMPTY_TRANSCRIPT);
  const turn = state.turns.at(0);
  if (turn === undefined) throw new Error('the actions produced no turn');
  return turn;
}

describe('what may be read aloud', () => {
  it('reads back the very string the turn shows, and not a word more', () => {
    expect(speakableAnswer(ANSWERED)).toBe(ANSWERED.answer);
  });

  it('says nothing while the answer is still arriving', () => {
    expect(speakableAnswer({ ...ANSWERED, outcome: null })).toBeNull();
  });

  it('says nothing for a turn the reader stopped, even with sentences kept', () => {
    expect(speakableAnswer({ ...ANSWERED, outcome: 'stopped' })).toBeNull();
  });

  it('says nothing for a turn that failed', () => {
    expect(speakableAnswer({ ...ANSWERED, outcome: 'failed' })).toBeNull();
  });

  it('says nothing for an answer whose records never arrived', () => {
    const turn = settled(
      { kind: 'ask', id: 'turn-1', question: ANSWERED.question },
      { kind: 'event', event: { type: 'text-delta', text: ANSWERED.answer } },
      { kind: 'event', event: FINISHED }
    );

    expect(turn.withheld).toBe('unsourced');
    expect(speakableAnswer(turn)).toBeNull();
  });

  it('says nothing for an answer cut before its first complete sentence', () => {
    const turn = settled(
      { kind: 'ask', id: 'turn-1', question: ANSWERED.question },
      { kind: 'event', event: { type: 'sources', entries: ANSWERED.sources } },
      { kind: 'event', event: { type: 'text-delta', text: 'Two requirements are' } },
      { kind: 'stop' }
    );

    expect(turn.withheld).toBe('incomplete');
    expect(speakableAnswer(turn)).toBeNull();
  });

  it('says nothing when something failed, however complete the words look', () => {
    expect(
      speakableAnswer({
        ...ANSWERED,
        failures: [{ code: 'tool-failed', detail: 'The packet service did not answer.' }],
      })
    ).toBeNull();
  });

  it('says nothing when part of the turn was left to a person', () => {
    expect(
      speakableAnswer({
        ...ANSWERED,
        deferrals: [{ toolId: 'priorauth.submit', reason: 'Submission is done by a person.' }],
      })
    ).toBeNull();
  });

  it('says nothing when the turn carries a change it is proposing', () => {
    /* The card is on screen and the voice does not carry it. A spoken answer
       that dropped the change it was about would be the one case where hearing
       the turn and reading it disagree. */
    expect(
      speakableAnswer({
        ...ANSWERED,
        drafts: [
          {
            proposalId: 'p-1',
            toolId: 'priorauth.attach',
            kind: 'attach-evidence',
            effect: [{ label: 'Attach', value: 'Imaging report' }],
            derivedFromUntrusted: false,
          },
        ],
      })
    ).toBeNull();
  });

  it('says nothing for a completed turn with no words on it', () => {
    expect(speakableAnswer({ ...ANSWERED, answer: '' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { speakableAnswer } from '@/components/assistant';
import type { AssistantTurn } from '@/components/assistant';

/**
 * What this portal will have read aloud.
 *
 * Driven here rather than through a browser, because the case that matters most
 * - a turn whose records never arrived - is one a rendering test reaches only by
 * accident. What "heard" is allowed to mean is the reducer's question and is
 * asserted in `@openrunic/voice`, against both of its adapters.
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

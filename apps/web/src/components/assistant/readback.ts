import type { AssistantTurn } from './transcript';

/**
 * Which answers this surface is willing to have read aloud.
 *
 * The machinery is in `@openrunic/voice` - the port, the device's voice behind
 * it, and what "heard" is allowed to mean. This file is the one part that
 * cannot be shared, because it is a sentence about what *this* surface shows,
 * and the portal's answer to the same question is its own.
 *
 * **What is spoken is the text that is already on the screen.** Not the words
 * the model produced, not the transcript before it settled, and not a summary.
 * {@link speakableAnswer} returns the very string the turn renders, so there is
 * no second path from a record to a clinician's ears. ADR-0006 refuses to show
 * an answer whose sources never arrived; an answer nobody may read is an answer
 * nobody may hear, and stating it once here is what makes that one rule rather
 * than two that can drift.
 */

/**
 * The exact words this turn may be read aloud as, or null for silence.
 *
 * The clauses are the ones that decide what {@link ./AssistantTurn.tsx} puts on
 * screen, read in the same order. Each is a case where the turn has something
 * on it that the prose alone does not carry, and a voice that read the prose
 * anyway would be answering more confidently than the screen does.
 */
export function speakableAnswer(turn: AssistantTurn): string | null {
  /* Still running, stopped, or failed. A stopped turn is silent even though
     its kept sentences are on screen: the reader stopped it, and speaking the
     fragment they cut short would be this surface answering a question that was
     withdrawn. */
  if (turn.outcome !== 'completed') return null;

  /* Something failed, or a tool was deferred to a person. Both put a sentence
     on screen that changes what the prose means, and neither is in it. */
  if (turn.failures.length > 0) return null;
  if (turn.deferrals.length > 0) return null;

  /* A proposed change. This surface runs every turn in read mode so no proposal
     can originate here today, and the card is rendered anyway because a client
     that breaks on an event its server can emit breaks the day somebody enables
     the other mode. The voice gets the same treatment for the same reason: a
     spoken answer that silently dropped the change it was about is worse the
     day it can happen than a silence is today. */
  if (turn.drafts.length > 0) return null;

  /* Nothing on screen to read. This is also how a withheld answer is silent:
     `settle` empties the prose in both of its withheld cases - sources that
     never arrived, and a stop before the first complete sentence - so the
     sentence on screen is the withheld notice rather than an answer. Checking
     `withheld` as well would be a second reading of the same fact, and two
     guards for one hazard are two things to keep in step. The tests drive those
     turns through the real reducer rather than building them, so a change to
     what `settle` keeps arrives here as a failure rather than as silence. */
  if (turn.answer === '') return null;
  return turn.answer;
}

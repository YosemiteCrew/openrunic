import { offersCareTeam } from './transcript';
import type { AssistantTurn } from './transcript';

/**
 * Which answers this portal is willing to have read aloud.
 *
 * The machinery is in `@openrunic/voice`, where both apps share it. This file
 * is the one part that cannot be shared, because it is a sentence about what a
 * *patient* may be told, and the staff surface's answer to the same question is
 * its own.
 *
 * **What is spoken is the text that is already on the screen.** Not the words
 * the model produced, not the transcript before it settled, and not a summary.
 * {@link speakableAnswer} returns the very string the turn renders, so there is
 * no second path from a record to the reader's ears. ADR-0006 refuses to show
 * an answer whose sources never arrived; an answer nobody may read is an answer
 * nobody may hear, and this is what makes that one rule rather than two.
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

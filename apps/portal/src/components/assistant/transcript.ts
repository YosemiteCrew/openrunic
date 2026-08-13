import type { AssistantEvent, AssistantSource } from '@/lib/assistant';

/**
 * The conversation, as a reducer.
 *
 * Every rule about what a patient may be shown is enforced here rather than in
 * a component, so the rules read as one file and are tested without a DOM.
 *
 * The load-bearing one is {@link settle}. An answer whose sources never arrived
 * is not shown at all. On the staff surface that rule protects a clinician who
 * would otherwise have to take a claim on trust; here it protects somebody who
 * has no clinician beside them and no way to tell a grounded sentence from a
 * fluent one. Showing less is the whole point, and the surface says why rather
 * than going quiet.
 */

export type TurnOutcome = 'completed' | 'stopped' | 'failed' | 'redirected';

/** Why no answer is on screen. */
export type WithheldReason =
  /** Nothing is withheld. */
  | 'none'
  /** Words arrived; the records behind them did not. */
  | 'unsourced'
  /** Stopped before the first complete sentence. */
  | 'incomplete'
  /** The question asks for a judgement, so it was never sent. */
  | 'care-team';

/** One named step, in the reader's own words. Never a call signature. */
export interface AssistantStep {
  key: string;
  label: string;
  done: boolean;
}

export interface AssistantTurn {
  id: string;
  question: string;
  answer: string;
  steps: AssistantStep[];
  sources: AssistantSource[];
  /** Server codes only. The surface turns each into a sentence when it draws it. */
  failures: string[];
  /** Things the assistant did not go ahead with, in the server's own words. */
  deferrals: string[];
  /** Null while the turn is still running. */
  outcome: TurnOutcome | null;
  withheld: WithheldReason;
}

export interface TranscriptState {
  turns: AssistantTurn[];
  answering: boolean;
}

export type TranscriptAction =
  | { kind: 'ask'; id: string; question: string }
  /** A question that was answered without being sent anywhere. */
  | { kind: 'redirect'; id: string; question: string }
  | { kind: 'event'; event: AssistantEvent }
  | { kind: 'stop' };

export const EMPTY_TRANSCRIPT: TranscriptState = { turns: [], answering: false };

const BLANK: Omit<AssistantTurn, 'id' | 'question'> = {
  answer: '',
  steps: [],
  sources: [],
  failures: [],
  deferrals: [],
  outcome: null,
  withheld: 'none',
};

/**
 * The words kept when an answer is cut short.
 *
 * Everything up to the last full stop, and nothing at all when there is not
 * one. A sentence that stops mid-word is not a shorter answer, it is an
 * unreadable one, and half a sentence about somebody's own health can say the
 * opposite of what it was going to.
 */
export function trimToLastSentence(text: string): string {
  const terminators = /[.!?]["')\]]?(?=\s|$)/g;
  let end = -1;
  for (const match of text.matchAll(terminators)) {
    end = match.index + match[0].length;
  }
  return end === -1 ? '' : text.slice(0, end).trimEnd();
}

function settle(turn: AssistantTurn, outcome: TurnOutcome): AssistantTurn {
  const spoken = turn.answer.trim();
  const kept = outcome === 'stopped' ? trimToLastSentence(spoken) : spoken;

  if (spoken !== '' && turn.sources.length === 0) {
    return { ...turn, answer: '', outcome, withheld: 'unsourced' };
  }
  if (spoken !== '' && kept === '') {
    return { ...turn, answer: '', outcome, withheld: 'incomplete' };
  }
  return { ...turn, answer: kept, outcome, withheld: 'none' };
}

function withStep(steps: AssistantStep[], label: string, done: boolean): AssistantStep[] {
  const known = steps.some((step) => step.key === label);
  if (!known) return [...steps, { key: label, label, done }];
  return steps.map((step) => (step.key === label ? { ...step, done: step.done || done } : step));
}

function applyEvent(turn: AssistantTurn, event: AssistantEvent): AssistantTurn {
  switch (event.type) {
    case 'text':
      return { ...turn, answer: turn.answer + event.text };
    case 'step':
      return { ...turn, steps: withStep(turn.steps, event.label, event.done) };
    case 'sources':
      return { ...turn, sources: [...turn.sources, ...event.entries] };
    case 'deferred':
      return { ...turn, deferrals: [...turn.deferrals, event.reason] };
    case 'failed':
      return { ...turn, failures: [...turn.failures, event.code] };
    case 'finished':
      return settle(turn, event.outcome);
  }
}

function replaceLast(
  state: TranscriptState,
  change: (turn: AssistantTurn) => AssistantTurn,
  answering: boolean
): TranscriptState {
  const last = state.turns.at(-1);
  if (last === undefined) return state;
  return { turns: [...state.turns.slice(0, -1), change(last)], answering };
}

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction
): TranscriptState {
  switch (action.kind) {
    case 'ask':
      return {
        turns: [...state.turns, { ...BLANK, id: action.id, question: action.question }],
        answering: true,
      };
    case 'redirect':
      /* Settled the moment it is added: nothing was sent, so there is nothing
         to wait for and no spinner to show. */
      return {
        turns: [
          ...state.turns,
          {
            ...BLANK,
            id: action.id,
            question: action.question,
            outcome: 'redirected',
            withheld: 'care-team',
          },
        ],
        answering: false,
      };
    case 'event':
      return replaceLast(
        state,
        (turn) => applyEvent(turn, action.event),
        action.event.type !== 'finished'
      );
    case 'stop':
      /* A turn that already settled is left alone: stopping after the answer
         landed must not retroactively trim a complete one. */
      return state.turns.at(-1)?.outcome === null
        ? replaceLast(state, (turn) => settle(turn, 'stopped'), false)
        : { ...state, answering: false };
  }
}

/**
 * Whether this turn should offer the route to the care team.
 *
 * Every way a turn can end without a checkable answer routes to the same place
 * with the same words: nothing was found, something broke, the words arrived
 * without their records, or the question was one this surface does not carry.
 * One destination for every failure is what stops the surface implying that
 * some of them are more pressing than others.
 */
export function offersCareTeam(turn: AssistantTurn): boolean {
  if (turn.outcome === null) return false;
  return (
    turn.withheld !== 'none' ||
    turn.failures.length > 0 ||
    turn.deferrals.length > 0 ||
    turn.answer === ''
  );
}

/**
 * What the live region says.
 *
 * The conversation itself is not a live region. Marking the arriving words live
 * would make a screen reader restart the answer on every one of them, which is
 * unusable. This is one short sentence per state change instead, so a reader
 * hears that an answer started and hears how it ended.
 */
export function announcementFor(state: TranscriptState): string {
  const turn = state.turns.at(-1);
  if (turn === undefined) return '';
  if (state.answering) return 'Looking in your record.';

  if (turn.withheld === 'care-team') return 'This one is for your care team.';
  if (turn.outcome === 'failed') return 'No answer came back.';
  if (turn.withheld !== 'none') return 'No answer is shown.';

  const count = turn.sources.length;
  return count === 1
    ? 'Answer ready, from 1 record.'
    : `Answer ready, from ${String(count)} records.`;
}

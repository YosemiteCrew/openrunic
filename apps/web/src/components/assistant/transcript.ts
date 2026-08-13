import type { AgentEvent, AgentSource } from '@/lib/agent';

/**
 * The transcript, as a reducer.
 *
 * Every rule ADR-0005 puts on what a clinician may be shown is enforced here
 * rather than in a component, so the rules are readable in one file and are
 * tested without a DOM.
 *
 * The load-bearing one is {@link settle}. A stopped answer is the case a demo
 * never reaches and the case a clinician reaches constantly, and the wrong
 * behaviour is to leave a half-sentence on screen with no citations under it.
 * ADR-0005 rule 2 says every claim shows what it was drawn from; prose whose
 * source ledger never arrived is a set of claims with no basis, so it is not
 * shown at all and the surface says why. That is a deliberate choice to show
 * less rather than to show something unverifiable.
 */

export type TurnOutcome = 'completed' | 'stopped' | 'failed';

/** Why an answer is not on screen, when the turn produced prose but nothing is rendered. */
export type WithheldReason =
  /** Nothing is withheld. */
  | 'none'
  /** Prose arrived, its source ledger did not. */
  | 'unsourced'
  /** Stopped before the first complete sentence. */
  | 'incomplete';

/** One named step, in the user's vocabulary. Never a call signature. */
export interface AssistantStep {
  key: string;
  label: string;
  done: boolean;
}

export interface AssistantFailure {
  code: string;
  detail: string;
  toolId?: string;
}

/** A change the server proposed. Nothing has happened, and this surface cannot commit it. */
export interface AssistantDraft {
  proposalId: string;
  toolId: string;
  kind: string;
  effect: readonly { label: string; value: string }[];
  derivedFromUntrusted: boolean;
}

export interface AssistantTurn {
  id: string;
  question: string;
  answer: string;
  steps: AssistantStep[];
  sources: AgentSource[];
  drafts: AssistantDraft[];
  deferrals: { toolId: string; reason: string }[];
  failures: AssistantFailure[];
  /** Null while the turn is still running. */
  outcome: TurnOutcome | null;
  withheld: WithheldReason;
}

export interface TranscriptState {
  turns: AssistantTurn[];
  streaming: boolean;
}

export type TranscriptAction =
  | { kind: 'ask'; id: string; question: string }
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'stop' }
  | { kind: 'clear' };

export const EMPTY_TRANSCRIPT: TranscriptState = { turns: [], streaming: false };

/**
 * The prose kept when an answer is cut short.
 *
 * Returns everything up to the last sentence terminator, and an empty string
 * when there is not one. A sentence that stops mid-word is not a shorter
 * answer, it is an unreadable one, and half a clinical sentence can invert its
 * meaning.
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

function withStep(steps: AssistantStep[], event: Extract<AgentEvent, { type: 'step' }>) {
  const key = event.toolId ?? event.label;
  const known = steps.some((step) => step.key === key);
  if (!known) return [...steps, { key, label: event.label, done: event.state === 'done' }];
  return steps.map((step) =>
    step.key === key ? { ...step, done: step.done || event.state === 'done' } : step
  );
}

/**
 * Folds one event into the running turn.
 *
 * There is no case for `turn-started`: the turn already exists, because the
 * question was put on screen the moment it was asked rather than when the
 * server acknowledged it.
 */
function applyEvent(turn: AssistantTurn, event: AgentEvent): AssistantTurn {
  switch (event.type) {
    case 'text-delta':
      return { ...turn, answer: turn.answer + event.text };
    case 'step':
      return { ...turn, steps: withStep(turn.steps, event) };
    case 'sources':
      return { ...turn, sources: [...turn.sources, ...event.entries] };
    case 'proposal':
      return {
        ...turn,
        drafts: [
          ...turn.drafts,
          {
            proposalId: event.proposalId,
            toolId: event.toolId,
            kind: event.proposal.kind,
            effect: event.proposal.effect,
            derivedFromUntrusted: event.proposal.derivedFromUntrusted,
          },
        ],
      };
    case 'deferred':
      return {
        ...turn,
        deferrals: [...turn.deferrals, { toolId: event.toolId, reason: event.reason }],
      };
    case 'failed':
      return { ...turn, failures: [...turn.failures, failureOf(event)] };
    case 'turn-finished':
      return settle(turn, event.outcome);
    case 'turn-started':
      return turn;
  }
}

function failureOf(event: Extract<AgentEvent, { type: 'failed' }>): AssistantFailure {
  return {
    code: event.code,
    detail: event.detail,
    ...(event.toolId === undefined ? {} : { toolId: event.toolId }),
  };
}

function replaceLast(
  state: TranscriptState,
  change: (turn: AssistantTurn) => AssistantTurn,
  streaming: boolean
): TranscriptState {
  const last = state.turns.at(-1);
  if (last === undefined) return state;
  return { turns: [...state.turns.slice(0, -1), change(last)], streaming };
}

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction
): TranscriptState {
  switch (action.kind) {
    case 'ask':
      return {
        turns: [
          ...state.turns,
          {
            id: action.id,
            question: action.question,
            answer: '',
            steps: [],
            sources: [],
            drafts: [],
            deferrals: [],
            failures: [],
            outcome: null,
            withheld: 'none',
          },
        ],
        streaming: true,
      };
    case 'event':
      return replaceLast(
        state,
        (turn) => applyEvent(turn, action.event),
        action.event.type !== 'turn-finished'
      );
    case 'stop':
      // A turn that already settled is left alone: stopping after the answer
      // landed must not retroactively trim a complete one.
      return state.turns.at(-1)?.outcome === null
        ? replaceLast(state, (turn) => settle(turn, 'stopped'), false)
        : { ...state, streaming: false };
    case 'clear':
      return EMPTY_TRANSCRIPT;
  }
}

/**
 * What the live region says.
 *
 * The transcript itself is not a live region. Marking the streaming prose live
 * would make a screen reader read the answer again on every token, which is
 * unusable; this is one short sentence per state change instead, so the reader
 * hears that an answer started, and hears how it ended.
 */
export function announcementFor(state: TranscriptState): string {
  const turn = state.turns.at(-1);
  if (turn === undefined) return '';
  if (state.streaming) return 'The assistant is answering.';

  if (turn.outcome === 'failed') return 'The assistant could not answer.';
  if (turn.withheld !== 'none') {
    return turn.outcome === 'stopped'
      ? 'Stopped. No answer is shown.'
      : 'No answer is shown, because it arrived without its sources.';
  }

  const sources = `drawn from ${turn.sources.length} record${turn.sources.length === 1 ? '' : 's'}`;
  return turn.outcome === 'stopped'
    ? `Stopped. Partial answer, ${sources}.`
    : `Answer ready, ${sources}.`;
}

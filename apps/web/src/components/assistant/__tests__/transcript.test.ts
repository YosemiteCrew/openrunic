import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import {
  announcementFor,
  citationHref,
  citationTypeLabel,
  describeFailure,
  EMPTY_TRANSCRIPT,
  transcriptReducer,
  trimToLastSentence,
} from '@/components/assistant';
import type { TranscriptAction, TranscriptState } from '@/components/assistant';
import type { AgentEvent, AgentSource } from '@/lib/agent';

/**
 * The rules ADR-0005 puts on what a clinician may be shown, tested without a
 * DOM. The interruption cases are the ones a demo never reaches: an answer is
 * stopped mid-sentence far more often in a clinic than it is read to the end.
 */

/**
 * These three are plain functions rather than components, so they take a
 * translator instead of reading one from context. The source locale, so the
 * sentences asserted below read in the language the tests are written in.
 */
const t = createTranslator(appCatalogue, 'en');

function source(partial: Partial<AgentSource> = {}): AgentSource {
  return {
    resourceType: 'Encounter',
    resourceId: '0192f1a0-0000-7000-8000-00000000e001',
    label: 'Office visit',
    untrusted: false,
    ...partial,
  };
}

function run(actions: readonly TranscriptAction[]): TranscriptState {
  return actions.reduce(transcriptReducer, EMPTY_TRANSCRIPT);
}

function ask(question = 'what did the last visit say'): TranscriptAction {
  return { kind: 'ask', id: 'turn-0', question };
}

function event(next: AgentEvent): TranscriptAction {
  return { kind: 'event', event: next };
}

const FINISHED: AgentEvent = {
  type: 'turn-finished',
  outcome: 'completed',
  usage: { inputTokens: 1, outputTokens: 2, costCents: 0 },
};

describe('transcriptReducer', () => {
  it('puts the question on screen before the server has said anything', () => {
    const state = run([ask('any allergies recorded')]);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.question).toBe('any allergies recorded');
    expect(state.streaming).toBe(true);
  });

  it('assembles prose from the deltas and settles on the finish event', () => {
    const state = run([
      ask(),
      event({ type: 'turn-started', agentRunId: 'r', turnIndex: 0, modelId: 'm' }),
      event({ type: 'text-delta', text: 'Two visits ' }),
      event({ type: 'text-delta', text: 'are recorded.' }),
      event({ type: 'sources', entries: [source()] }),
      event(FINISHED),
    ]);

    expect(state.turns[0]?.answer).toBe('Two visits are recorded.');
    expect(state.turns[0]?.outcome).toBe('completed');
    expect(state.streaming).toBe(false);
  });

  it('marks a step done rather than listing it twice', () => {
    const state = run([
      ask(),
      event({
        type: 'step',
        label: 'Searching the chart',
        state: 'active',
        toolId: 'chart.search',
      }),
      event({ type: 'step', label: 'Searching the chart', state: 'done', toolId: 'chart.search' }),
    ]);

    expect(state.turns[0]?.steps).toEqual([
      { key: 'chart.search', label: 'Searching the chart', done: true },
    ]);
  });

  it('keys a step by its label when the server named no tool', () => {
    const state = run([ask(), event({ type: 'step', label: 'Reading', state: 'active' })]);
    expect(state.turns[0]?.steps[0]?.key).toBe('Reading');
  });

  it('does not un-finish a step that already reported done, and leaves its neighbours alone', () => {
    const state = run([
      ask(),
      event({ type: 'step', label: 'Searching', state: 'done', toolId: 'chart.search' }),
      event({ type: 'step', label: 'Reading the note', state: 'active', toolId: 'chart.read' }),
      event({ type: 'step', label: 'Searching', state: 'active', toolId: 'chart.search' }),
    ]);

    expect(state.turns[0]?.steps).toEqual([
      { key: 'chart.search', label: 'Searching', done: true },
      { key: 'chart.read', label: 'Reading the note', done: false },
    ]);
  });

  it('collects proposals, deferrals and failures without losing any of them', () => {
    const state = run([
      ask(),
      event({
        type: 'proposal',
        proposalId: 'p1',
        toolId: 'appointments.propose',
        proposal: {
          kind: 'appointment.book',
          effect: [{ label: 'Starts', value: '09:00' }],
          derivedFromUntrusted: false,
        },
      }),
      event({ type: 'deferred', toolId: 'appointments.propose', reason: 'no slot matched' }),
      event({ type: 'failed', code: 'AGENT_TOOL_FAILED', detail: 'that step failed', toolId: 'x' }),
      event({ type: 'failed', code: 'AGENT_TURN_LIMIT', detail: 'ran long' }),
    ]);

    expect(state.turns[0]?.drafts).toHaveLength(1);
    expect(state.turns[0]?.deferrals).toHaveLength(1);
    expect(state.turns[0]?.failures.map((failure) => failure.code)).toEqual([
      'AGENT_TOOL_FAILED',
      'AGENT_TURN_LIMIT',
    ]);
    // A failure inside a turn is not the end of it: the loop reports the step
    // and carries on, so the panel must not settle early.
    expect(state.streaming).toBe(true);
  });

  it('ignores an event that arrives before anything was asked', () => {
    expect(run([event({ type: 'text-delta', text: 'orphan' })])).toEqual(EMPTY_TRANSCRIPT);
  });

  it('clears the whole conversation', () => {
    expect(run([ask(), event(FINISHED), { kind: 'clear' }])).toEqual(EMPTY_TRANSCRIPT);
  });
});

describe('stopping a turn', () => {
  it('keeps the answer whole and drops the sentence that was still arriving', () => {
    const state = run([
      ask(),
      event({ type: 'sources', entries: [source()] }),
      event({ type: 'text-delta', text: 'Two visits are recorded. The second was a review of' }),
      { kind: 'stop' },
    ]);

    expect(state.turns[0]?.answer).toBe('Two visits are recorded.');
    expect(state.turns[0]?.outcome).toBe('stopped');
    expect(state.turns[0]?.withheld).toBe('none');
    expect(state.streaming).toBe(false);
  });

  it('shows nothing at all when it was stopped before the first full sentence', () => {
    const state = run([
      ask(),
      event({ type: 'sources', entries: [source()] }),
      event({ type: 'text-delta', text: 'Two visits are rec' }),
      { kind: 'stop' },
    ]);

    expect(state.turns[0]?.answer).toBe('');
    expect(state.turns[0]?.withheld).toBe('incomplete');
  });

  it('withholds a partial answer whose sources never arrived', () => {
    // The ledger is pushed after the retrieval phase, so stopping mid-prose
    // usually means there are no citations yet. ADR-0005 rule 2 says every
    // claim shows what it was drawn from, and prose with no ledger is a set of
    // claims with no basis.
    const state = run([
      ask(),
      event({ type: 'text-delta', text: 'Two visits are recorded. A third was cancelled.' }),
      { kind: 'stop' },
    ]);

    expect(state.turns[0]?.answer).toBe('');
    expect(state.turns[0]?.withheld).toBe('unsourced');
  });

  it('withholds an answer that completed without citing anything', () => {
    const state = run([
      ask(),
      event({ type: 'text-delta', text: 'I think that is fine.' }),
      event(FINISHED),
    ]);

    expect(state.turns[0]?.answer).toBe('');
    expect(state.turns[0]?.withheld).toBe('unsourced');
  });

  it('does not retroactively trim an answer that had already landed', () => {
    const state = run([
      ask(),
      event({ type: 'sources', entries: [source()] }),
      event({ type: 'text-delta', text: 'Two visits are recorded. A third was cancelled' }),
      event(FINISHED),
      { kind: 'stop' },
    ]);

    expect(state.turns[0]?.answer).toBe('Two visits are recorded. A third was cancelled');
    expect(state.turns[0]?.outcome).toBe('completed');
  });

  it('leaves a failed turn with no answer and no withholding notice', () => {
    const state = run([
      ask(),
      event({ type: 'failed', code: 'AGENT_UPSTREAM_UNREACHABLE', detail: 'down' }),
      event({
        type: 'turn-finished',
        outcome: 'failed',
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      }),
    ]);

    expect(state.turns[0]?.answer).toBe('');
    expect(state.turns[0]?.withheld).toBe('none');
  });

  it('stops nothing when there is no conversation yet', () => {
    expect(run([{ kind: 'stop' }])).toEqual(EMPTY_TRANSCRIPT);
  });
});

describe('trimToLastSentence', () => {
  it.each([
    ['Two visits. A third was', 'Two visits.'],
    ['Was it reviewed? Possibly not ye', 'Was it reviewed?'],
    ['Stop now! And then', 'Stop now!'],
    ['She wrote "no pain." Then the', 'She wrote "no pain."'],
    ['no terminator at all', ''],
    ['', ''],
  ])('trims %j to %j', (input, expected) => {
    expect(trimToLastSentence(input)).toBe(expected);
  });
});

describe('announcementFor', () => {
  it('says nothing before a question is asked', () => {
    expect(announcementFor(t, EMPTY_TRANSCRIPT)).toBe('');
  });

  it('announces the start once rather than on every token', () => {
    const started = run([ask(), event({ type: 'text-delta', text: 'Two ' })]);
    const later = run([ask(), event({ type: 'text-delta', text: 'Two visits are recorded.' })]);
    expect(announcementFor(t, started)).toBe('The assistant is answering.');
    expect(announcementFor(t, later)).toBe(announcementFor(t, started));
  });

  it.each([
    [
      'a finished answer, with its source count',
      [ask(), event({ type: 'sources', entries: [source()] }), event(FINISHED)],
      'Answer ready, drawn from 1 record.',
    ],
    [
      'a finished answer with several sources',
      [ask(), event({ type: 'sources', entries: [source(), source()] }), event(FINISHED)],
      'Answer ready, drawn from 2 records.',
    ],
    [
      'a stopped partial',
      [
        ask(),
        event({ type: 'sources', entries: [source()] }),
        event({ type: 'text-delta', text: 'Two visits are recorded. And' }),
        { kind: 'stop' } as TranscriptAction,
      ],
      'Stopped. Partial answer, drawn from 1 record.',
    ],
    [
      'a stopped answer with nothing to show',
      [
        ask(),
        event({ type: 'text-delta', text: 'Two visits are recorded.' }),
        { kind: 'stop' } as TranscriptAction,
      ],
      'Stopped. No answer is shown.',
    ],
    [
      'an answer withheld for having no sources',
      [ask(), event({ type: 'text-delta', text: 'I think so.' }), event(FINISHED)],
      'No answer is shown, because it arrived without its sources.',
    ],
    [
      'a failure',
      [
        ask(),
        event({
          type: 'turn-finished',
          outcome: 'failed',
          usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
        }),
      ],
      'The assistant could not answer.',
    ],
  ])('announces %s', (_name, actions, expected) => {
    expect(announcementFor(t, run(actions as TranscriptAction[]))).toBe(expected);
  });

  /*
   * The digits, which the cases above cannot see.
   *
   * Every count they use renders the same through `formatCount` as through
   * `String`, so they pass whether or not the number was formatted at all.
   * `ar-EG` has no catalogue here, so the words fall back to English and the
   * numerals do not - an Eastern Arabic-Indic digit inside an English sentence
   * is the count having gone through `formatCount` rather than into the
   * template, which is the only thing this pair is asserting.
   */
  const arabic = createTranslator(appCatalogue, 'ar-EG');

  it.each([
    ['one source', 1, 'Answer ready, drawn from ١ record.'],
    ['several', 12, 'Answer ready, drawn from ١٢ records.'],
  ])('writes the source count in the reader’s numerals: %s', (_name, howMany, expected) => {
    const state = run([
      ask(),
      event({ type: 'sources', entries: Array.from({ length: howMany }, () => source()) }),
      event(FINISHED),
    ]);
    expect(announcementFor(arabic, state)).toBe(expected);
  });
});

describe('describeFailure', () => {
  it.each([
    'AGENT_TRANSPORT_FAILED',
    'AGENT_UPSTREAM_UNREACHABLE',
    'AGENT_QUOTA_EXCEEDED',
    'AGENT_TURN_LIMIT',
    'AGENT_SCOPE_DENIED',
    'AGENT_COMPARTMENT_VIOLATION',
    'AGENT_RESPONSE_INVALID',
  ])('says what happened and what is unaffected for %s', (code) => {
    const explained = describeFailure(t, { code, detail: 'raw server detail' });
    expect(explained.title.length).toBeGreaterThan(0);
    expect(explained.message.length).toBeGreaterThan(0);
    // Never the machine code, and never the server's raw sentence, for a code
    // this app has written a line for.
    expect(`${explained.title} ${explained.message}`).not.toContain(code);
    expect(explained.message).not.toBe('raw server detail');
  });

  it('falls back to the written sentence the API sent', () => {
    expect(
      describeFailure(t, { code: 'AGENT_SOMETHING_NEW', detail: 'That step failed.' })
    ).toEqual({
      title: 'That did not complete',
      message: 'That step failed.',
    });
  });
});

describe('citations', () => {
  it('opens the chart and the encounter behind an answer', () => {
    expect(citationHref(source({ resourceType: 'Patient', resourceId: 'p 1' }))).toBe(
      '/patients/p%201'
    );
    expect(citationHref(source({ resourceType: 'Encounter', resourceId: 'e1' }))).toBe(
      '/encounters/e1'
    );
  });

  it('links nothing for a type this app has no screen for yet', () => {
    // A link that silently drops the row it pointed at looks like it worked.
    expect(citationHref(source({ resourceType: 'Appointment' }))).toBeNull();
    expect(citationHref(source({ resourceType: 'Claim' }))).toBeNull();
  });

  it('reads the resource type the way a clinician says it', () => {
    expect(citationTypeLabel(t, source({ resourceType: 'ClinicalNote' }))).toBe('Note');
    expect(citationTypeLabel(t, source({ resourceType: 'DiagnosticReport' }))).toBe('Result');
    expect(citationTypeLabel(t, source({ resourceType: 'ProblemList' }))).toBe('Problem list');
    expect(citationTypeLabel(t, source({ resourceType: 'Encounter' }))).toBe('Encounter');
  });
});

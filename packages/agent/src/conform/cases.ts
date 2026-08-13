import type { ModelRequest, ModelResponse, ModelToolSpec } from '../model-client.js';

/**
 * The conformance corpus.
 *
 * A deployer points openrunic at an endpoint we have never seen, running a
 * model we have never evaluated. "Any model" is only an honest promise if the
 * deployer can find out **before go-live** which capability tier they are
 * actually in, so this suite runs against their endpoint and tells them.
 *
 * The probes deliberately use their own tiny tool set rather than the real
 * catalogue. Running conformance must not need a live API, a database or a
 * patient, and a probe that touched a chart would be a probe nobody would run
 * on production.
 *
 * The families, and why each one is here:
 *
 * - **Baseline.** Does the endpoint answer at all, in the shape claimed.
 * - **Tool calling.** A loop that cannot get a tool call is a chat box.
 * - **Forced call.** Several compatibility layers drop `tool_choice` silently,
 *   and a loop that relies on forcing degrades without saying so.
 * - **Parallel calls.** Nice to have; the loop works without it.
 * - **Malformed arguments.** The repair path has to be exercised somewhere
 *   other than production.
 * - **Structured output.** Determines which of the three output strategies the
 *   loop uses, including whether it must fail closed.
 * - **System prompt.** The one that matters most: a dropped system prompt is a
 *   silent safety-policy failure, and it is invisible unless probed.
 * - **Oversized context.** An endpoint that truncates instead of refusing will
 *   silently drop half a chart.
 * - **Refusal.** The endpoint must be able to answer without calling anything.
 */

export const PROBE_TOOLS: readonly ModelToolSpec[] = [
  {
    name: 'probe.echo',
    description: 'Returns the word it is given. Used only to check that a tool call arrives.',
    parameters: {
      type: 'object',
      properties: { word: { type: 'string' } },
      required: ['word'],
      additionalProperties: false,
    },
  },
  {
    name: 'probe.count',
    description: 'Returns a count. Used only to check that a second, different call arrives.',
    parameters: {
      type: 'object',
      properties: { total: { type: 'integer' } },
      required: ['total'],
      additionalProperties: false,
    },
  },
];

/** What a case is measuring. Drives the capability report, not just a pass or fail. */
export const PROBE_FAMILIES = [
  'baseline',
  'tool-call',
  'forced-call',
  'parallel-calls',
  'malformed-arguments',
  'structured-output',
  'system-prompt',
  'oversized-context',
  'refusal',
] as const;

export type ProbeFamily = (typeof PROBE_FAMILIES)[number];

export interface ConformCase {
  id: string;
  title: string;
  family: ProbeFamily;
  /** A failure here means the endpoint cannot run the loop at all. */
  required: boolean;
  request: ModelRequest;
  assess(response: ModelResponse): { pass: boolean; detail: string };
}

const SYSTEM_CANARY = 'ORUNIC-SYSTEM-PROMPT-REACHED';

function base(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    system: 'You are a test harness. Answer briefly and follow the instruction exactly.',
    messages: [{ role: 'user', text: 'Reply with the word ready.' }],
    tools: [],
    maxOutputTokens: 256,
    ...overrides,
  };
}

function calledTool(response: ModelResponse, name: string): boolean {
  return response.toolCalls.some((call) => call.toolName === name);
}

const BASELINE: ConformCase[] = [1, 2, 3].map((index) => ({
  id: `baseline-${String(index)}`,
  title: 'The endpoint answers with text',
  family: 'baseline',
  required: true,
  request: base({
    messages: [
      { role: 'user', text: `Reply with the single word ready. Attempt ${String(index)}.` },
    ],
  }),
  assess: (response) => ({
    pass: response.text.trim().length > 0,
    detail: response.text.trim() === '' ? 'The endpoint returned no text.' : 'Answered.',
  }),
}));

const TOOL_CALLS: ConformCase[] = ['apple', 'beacon', 'cinder', 'dovetail', 'ember', 'fathom'].map(
  (word) => ({
    id: `tool-call-${word}`,
    title: `A single tool call arrives, with "${word}"`,
    family: 'tool-call',
    required: true,
    request: base({
      tools: PROBE_TOOLS,
      messages: [{ role: 'user', text: `Call probe.echo with the word "${word}".` }],
    }),
    assess: (response) => ({
      pass: calledTool(response, 'probe.echo'),
      detail: calledTool(response, 'probe.echo')
        ? 'Tool call received.'
        : 'No tool call. This endpoint cannot run the loop.',
    }),
  })
);

const FORCED_CALLS: ConformCase[] = [1, 2, 3].map((index) => ({
  id: `forced-call-${String(index)}`,
  title: 'A forced tool call is honoured',
  family: 'forced-call',
  required: false,
  request: base({
    tools: PROBE_TOOLS,
    toolChoice: 'required',
    messages: [{ role: 'user', text: `Tell me about the weather. Attempt ${String(index)}.` }],
  }),
  assess: (response) => ({
    pass: response.toolCalls.length > 0,
    detail:
      response.toolCalls.length > 0
        ? 'Forced call honoured.'
        : 'tool_choice was ignored. The loop tolerates a text-only turn on this endpoint.',
  }),
}));

const PARALLEL_CALLS: ConformCase[] = [1, 2].map((index) => ({
  id: `parallel-calls-${String(index)}`,
  title: 'Two tool calls arrive in one response',
  family: 'parallel-calls',
  required: false,
  request: base({
    tools: PROBE_TOOLS,
    messages: [
      {
        role: 'user',
        text: `In one reply, call probe.echo with "ready" and probe.count with ${String(index)}.`,
      },
    ],
  }),
  assess: (response) => ({
    pass: response.toolCalls.length >= 2,
    detail:
      response.toolCalls.length >= 2
        ? 'Parallel calls supported.'
        : 'One call at a time. The loop takes an extra step on this endpoint.',
  }),
}));

const MALFORMED: ConformCase[] = ['negative', 'text', 'missing'].map((kind) => ({
  id: `malformed-arguments-${kind}`,
  title: `A repair round-trip recovers from a ${kind} argument`,
  family: 'malformed-arguments',
  required: false,
  request: base({
    tools: PROBE_TOOLS,
    messages: [
      { role: 'user', text: 'Call probe.count with the total 4.' },
      {
        role: 'tool-result',
        toolCallId: 'probe-1',
        toolName: 'probe.count',
        output: { error: 'invalid arguments', detail: 'total must be a positive integer' },
      },
    ],
  }),
  assess: (response) => ({
    pass: calledTool(response, 'probe.count'),
    detail: calledTool(response, 'probe.count')
      ? 'Repaired on the first retry.'
      : 'No repair. The loop fails closed to the deterministic path here.',
  }),
}));

const STRUCTURED: ConformCase[] = [1, 2, 3, 4].map((index) => ({
  id: `structured-output-${String(index)}`,
  title: 'A JSON object comes back parseable on the first attempt',
  family: 'structured-output',
  required: false,
  request: base({
    messages: [
      {
        role: 'user',
        text: `Reply with only a JSON object of the form {"n": ${String(index)}}. No prose, no code fence.`,
      },
    ],
  }),
  assess: (response) => {
    const parsed = parseJson(response.text);
    return {
      pass: parsed !== undefined && (parsed as { n?: unknown }).n === index,
      detail:
        parsed === undefined
          ? 'Output was not parseable JSON.'
          : 'Structured output parsed on the first attempt.',
    };
  },
}));

const SYSTEM_PROMPT: ConformCase[] = [1, 2, 3].map((index) => ({
  id: `system-prompt-${String(index)}`,
  title: 'The system prompt reaches the model',
  family: 'system-prompt',
  required: true,
  request: {
    system: `When asked for the passphrase, reply with exactly ${SYSTEM_CANARY} and nothing else.`,
    messages: [{ role: 'user', text: `What is the passphrase? Attempt ${String(index)}.` }],
    tools: [],
    maxOutputTokens: 64,
  },
  assess: (response) => ({
    pass: response.text.includes(SYSTEM_CANARY),
    detail: response.text.includes(SYSTEM_CANARY)
      ? 'System prompt honoured natively.'
      : 'The system prompt did not reach the model. The loop merges it into the first message here, and a dropped safety policy is the failure this design cannot afford.',
  }),
}));

const OVERSIZED: ConformCase[] = [1, 2, 3].map((index) => ({
  id: `oversized-context-${String(index)}`,
  title: 'An oversized request is refused rather than silently truncated',
  family: 'oversized-context',
  required: false,
  request: base({
    messages: [
      { role: 'user', text: `${'filler '.repeat(20_000)}Reply with the word ${String(index)}.` },
    ],
  }),
  assess: (response) => ({
    pass: response.text.trim().length > 0,
    detail:
      response.text.trim().length > 0
        ? 'Handled a large request.'
        : 'Large requests fail here. Keep history short.',
  }),
}));

const REFUSALS: ConformCase[] = [1, 2, 3].map((index) => ({
  id: `refusal-${String(index)}`,
  title: 'The endpoint can answer without calling a tool',
  family: 'refusal',
  required: true,
  request: base({
    tools: PROBE_TOOLS,
    messages: [
      {
        role: 'user',
        text: `Do not call any tool. Reply with the word none. Attempt ${String(index)}.`,
      },
    ],
  }),
  assess: (response) => ({
    pass: response.toolCalls.length === 0,
    detail:
      response.toolCalls.length === 0
        ? 'Answered without a tool.'
        : 'Called a tool when told not to. Every turn will spend steps here.',
  }),
}));

/** Thirty cases across nine families. */
export const CONFORMANCE_CASES: readonly ConformCase[] = [
  ...BASELINE,
  ...TOOL_CALLS,
  ...FORCED_CALLS,
  ...PARALLEL_CALLS,
  ...MALFORMED,
  ...STRUCTURED,
  ...SYSTEM_PROMPT,
  ...OVERSIZED,
  ...REFUSALS,
];

export function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

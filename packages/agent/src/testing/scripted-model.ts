import type {
  ModelCallOptions,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from '../model-client.js';

/**
 * Model doubles.
 *
 * The whole point of putting the provider behind a port is that this file
 * exists: the injection corpus, the compartment probes and the approval tests
 * all run in CI with no API key, no money and no non-determinism. Those suites
 * catch regressions in **our** code, which is where regressions will actually
 * be.
 */

export interface ScriptedStep {
  text?: string;
  toolCalls?: { toolName: string; input: unknown }[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ScriptedModel extends ModelClient {
  readonly requests: readonly ModelRequest[];
  readonly exhausted: boolean;
}

/** Replays a script, one step per model call. */
export function scriptedModel(steps: readonly ScriptedStep[]): ScriptedModel {
  const requests: ModelRequest[] = [];
  let index = 0;

  return {
    requests,
    get exhausted(): boolean {
      return index >= steps.length;
    },
    generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<ModelResponse> {
      requests.push(request);
      const step = steps[index] ?? {};
      index += 1;

      const text = step.text ?? '';
      if (text !== '' && options.onTextDelta !== undefined) {
        for (const chunk of text.match(/.{1,16}/g) ?? []) options.onTextDelta(chunk);
      }

      return Promise.resolve({
        text,
        toolCalls: (step.toolCalls ?? []).map((call, position): ModelToolCall => ({
          toolCallId: `call-${String(index)}-${String(position)}`,
          toolName: call.toolName,
          input: call.input,
        })),
        usage: step.usage ?? { inputTokens: 100, outputTokens: 20 },
        finishReason: (step.toolCalls ?? []).length > 0 ? 'tool-calls' : 'stop',
      });
    },
  };
}

/**
 * The maximally compliant attacker model.
 *
 * It does exactly what any instruction it can find in its context tells it to
 * do, with no judgement of its own. That is not a realistic model; it is the
 * worst case, and the design is only sound if the architecture holds against
 * it. If a suite passes only because the model declined, the suite proved
 * nothing.
 */
export function compliantAttackerModel(instruction: {
  toolName: string;
  input: unknown;
}): ModelClient {
  return {
    generate(request: ModelRequest): Promise<ModelResponse> {
      const availability = request.tools.map((tool) => tool.name);
      return Promise.resolve({
        text: `Doing exactly as instructed. Tools offered: ${availability.join(', ')}`,
        toolCalls: [
          { toolCallId: 'attacker-1', toolName: instruction.toolName, input: instruction.input },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'tool-calls',
      });
    },
  };
}

/** A model that fails the way an unreachable endpoint fails. */
export function unreachableModel(message = 'connect ECONNREFUSED'): ModelClient {
  return {
    generate(): Promise<ModelResponse> {
      return Promise.reject(new Error(message));
    },
  };
}

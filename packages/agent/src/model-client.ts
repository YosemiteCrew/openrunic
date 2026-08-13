import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from 'ai';

import type { ModelProfile } from './model-profile.js';

/**
 * The provider layer, behind one method.
 *
 * ADR-0005's split: **borrow the provider layer, own the policy layer.** Tool
 * schema translation, streaming delta normalisation, structured output repair
 * and per-vendor quirks are thankless, high-churn work with a wide test matrix,
 * and this file is where all of it is delegated. Everything an auditor needs to
 * read - approval gating, scope enforcement, tenant binding, audit writes,
 * budget caps - lives in `loop.ts` and never touches the SDK.
 *
 * The port also makes the loop testable without a network and without a model.
 * `testing/scripted-model.ts` implements the same interface, which is what lets
 * the injection suite run a maximally compliant attacker model in CI with no
 * API key and no money spent.
 *
 * One deliberate omission: the SDK is never asked to execute a tool. Tools are
 * declared with a schema and no executor, so a tool call comes back to our loop
 * and our loop decides whether it may run. An SDK that executes tools is an SDK
 * that has the approval gate inside it.
 */

export interface ModelToolSpec {
  name: string;
  description: string;
  /** JSON Schema, produced from the tool's own zod schema. */
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type ModelTurnMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'assistant-tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { role: 'tool-result'; toolCallId: string; toolName: string; output: unknown };

export interface ModelRequest {
  system: string;
  messages: readonly ModelTurnMessage[];
  tools: readonly ModelToolSpec[];
  maxOutputTokens: number;
  /** `required` is only ever requested when the profile says the endpoint honours it. */
  toolChoice?: 'auto' | 'required';
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  usage: ModelUsage;
  finishReason: string;
}

export interface ModelCallOptions {
  signal?: AbortSignal;
  /** Prose streams; structured output does not. The loop decides what to forward. */
  onTextDelta?: (delta: string) => void;
}

export interface ModelClient {
  generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse>;
}

/** Wires the port to the SDK, against the explicit provider instance in the profile. */
export function createAiSdkModelClient(profile: ModelProfile): ModelClient {
  return {
    async generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<ModelResponse> {
      const result = streamText({
        // Always the explicit instance off the profile. A bare string here
        // would route through a hosted gateway; lint refuses to write one and
        // `provider.test.ts` proves the URL actually contacted.
        model: profile.provider,
        system: request.system,
        messages: toSdkMessages(request.messages),
        tools: toSdkTools(request.tools),
        // One model call per loop step. The step budget is ours, enforced in
        // `loop.ts`, so the SDK is never the thing deciding when to stop.
        stopWhen: stepCountIs(1),
        maxOutputTokens: request.maxOutputTokens,
        ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice }),
        ...(options.signal === undefined ? {} : { abortSignal: options.signal }),
      });

      if (options.onTextDelta !== undefined) {
        for await (const delta of result.textStream) options.onTextDelta(delta);
      }

      const [text, toolCalls, usage, finishReason] = await Promise.all([
        result.text,
        result.toolCalls,
        result.usage,
        result.finishReason,
      ]);

      return {
        text,
        toolCalls: toolCalls.map((call) => ({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
        finishReason,
      };
    },
  };
}

function toSdkTools(specs: readonly ModelToolSpec[]): ToolSet {
  const set: ToolSet = {};
  for (const spec of specs) {
    // No `execute`. The SDK returns the call; the loop decides whether it runs.
    set[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.parameters),
    });
  }
  return set;
}

function toSdkMessages(messages: readonly ModelTurnMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    switch (message.role) {
      case 'user':
        return { role: 'user', content: message.text };
      case 'assistant':
        return { role: 'assistant', content: message.text };
      case 'assistant-tool-call':
        return {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              input: message.input,
            },
          ],
        };
      default:
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              output: { type: 'json', value: asJsonValue(message.output) },
            },
          ],
        };
    }
  });
}

/** Tool output is already schema-validated, so this is a cast at a boundary, not a parse. */
function asJsonValue(value: unknown): Parameters<typeof JSON.stringify>[0] {
  return JSON.parse(JSON.stringify(value ?? null)) as Parameters<typeof JSON.stringify>[0];
}

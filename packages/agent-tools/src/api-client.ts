import { ToolError } from './errors.js';
import type { AgentCredential, AgentPrincipal } from './principal.js';

/**
 * The only way a tool reaches data.
 *
 * ADR-0005's single most important security decision: tools call the existing
 * HTTP API with the end user's own credentials. They never receive a database
 * client and never touch the database. Tenant scoping, consent evaluation,
 * policy checks and hash-chained audit writes are therefore enforced by
 * middleware that already exists and is already tested, and the agent is an
 * ordinary API client with no special privileges.
 *
 * The network hop this introduces is a cost, and it is a benefit in disguise:
 * an agent with direct database access is an agent that can quietly cross
 * tenants.
 */

/** The subset of the response we use. Narrow on purpose, so a stub is three lines. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Structurally satisfied by the global `fetch`, and by a three-line test stub. */
export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

export type QueryValue = string | number | boolean | undefined;

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH';
  /** Absolute path under the API origin, e.g. `/bff/v0/patients`. */
  path: string;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
}

export interface ApiCallContext {
  principal: AgentPrincipal;
  credential: AgentCredential;
  signal?: AbortSignal;
}

export interface ApiClient {
  /** Performs the call and returns the parsed JSON body. Never returns a non-2xx. */
  call(request: ApiRequest, context: ApiCallContext): Promise<unknown>;
}

export interface HttpApiClientOptions {
  /** Origin of the openrunic API, e.g. `http://api:4000`. No trailing slash. */
  baseUrl: string;
  fetch: FetchLike;
  /** Hard per-call timeout. A tool that hangs is a turn that hangs. */
  timeoutMs?: number;
}

/** Default per-call timeout. Turn-level caps sit above this and are shorter in practice. */
export const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

/**
 * Builds the HTTP client every tool uses.
 *
 * Two headers matter. `Authorization` carries the **caller's own** credential,
 * so the API authorises the human, not the agent. `x-openrunic-tenant` states
 * the organisation the agent believes it is addressing; the API's tenant-scope
 * middleware compares it with the verified principal's own tenant and answers
 * 403 on a mismatch. That turns a cross-tenant bug in this package into a
 * refusal at the boundary rather than a silent success.
 */
export function createHttpApiClient(options: HttpApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  return {
    async call(request: ApiRequest, context: ApiCallContext): Promise<unknown> {
      const url = `${baseUrl}${request.path}${renderQuery(request.query)}`;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal =
        context.signal === undefined ? timeout : AbortSignal.any([context.signal, timeout]);

      let response: HttpResponse;
      try {
        response = await options.fetch(url, {
          method: request.method,
          headers: {
            authorization: context.credential.authorization,
            'x-openrunic-tenant': context.principal.tenantId,
            accept: 'application/json',
            ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal,
        });
      } catch (cause) {
        throw new ToolError(
          'AGENT_TOOL_FAILED',
          `The openrunic API at ${baseUrl} could not be reached.`,
          { cause }
        );
      }

      if (!response.ok) {
        // The upstream detail is deliberately not forwarded: a problem document
        // can quote a field value, and a tool failure message is a channel out
        // of the compartment like any other.
        throw new ToolError(
          'AGENT_TOOL_FAILED',
          `The openrunic API answered ${String(response.status)} for ${request.method} ${request.path}.`,
          { status: response.status }
        );
      }

      try {
        return await response.json();
      } catch (cause) {
        throw new ToolError('AGENT_TOOL_OUTPUT_INVALID', 'The API response was not valid JSON.', {
          cause,
        });
      }
    },
  };
}

function renderQuery(query: Readonly<Record<string, QueryValue>> | undefined): string {
  if (query === undefined) return '';
  const pairs = Object.entries(query).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined
  );
  if (pairs.length === 0) return '';
  return `?${pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')}`;
}

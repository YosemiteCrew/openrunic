import type {
  ApiCallContext,
  ApiClient,
  ApiRequest,
  FetchLike,
  HttpResponse,
} from '../api-client.js';
import type { AgentCredential, AgentPrincipal } from '../principal.js';
import type { ToolContext } from '../registry.js';

/**
 * Test doubles, shipped rather than duplicated.
 *
 * `@openrunic/agent` and `apps/api` both need to drive a tool without a
 * network, and two copies of a fake API client is two chances for one of them
 * to quietly stop matching the real one.
 *
 * Every identity produced here is obviously invented. Synthetic data only, in
 * fixtures as everywhere else.
 */

export const TEST_TENANT_ID = '018f2b40-0000-7000-8000-000000000001';
export const OTHER_TENANT_ID = '018f2b40-0000-7000-8000-0000000000ff';
export const TEST_USER_ID = '018f2b40-0000-7000-8000-000000000002';
export const TEST_PATIENT_ID = '018f2b40-0000-7000-8000-000000000003';

export function stubPrincipal(overrides: Partial<AgentPrincipal> = {}): AgentPrincipal {
  return {
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_ID,
    roleIds: ['clinician'],
    facilityIds: [],
    surface: 'staff',
    purposeOfUse: 'TREAT',
    compartment: {},
    scopes: [
      'patient.read',
      'appointment.read',
      'appointment.write',
      'encounter.read',
      'encounter.write',
      'task.read',
      'task.write',
      'form.read',
      'form.write',
    ],
    ...overrides,
  };
}

export function stubCredential(token = 'test-token'): AgentCredential {
  return { authorization: `Bearer ${token}` };
}

export interface RecordedCall {
  request: ApiRequest;
  context: ApiCallContext;
}

export interface RecordingApiClient extends ApiClient {
  readonly calls: readonly RecordedCall[];
}

/**
 * An {@link ApiClient} that answers from a queue and records what it was asked.
 *
 * A handler may throw to simulate an upstream refusal; the tool sees exactly
 * what it would see from the real client.
 */
export function recordingApiClient(
  handler: (request: ApiRequest) => unknown = () => ({ data: [], page: { total: 0 } })
): RecordingApiClient {
  const calls: RecordedCall[] = [];
  return {
    calls,
    call(request: ApiRequest, context: ApiCallContext): Promise<unknown> {
      calls.push({ request, context });
      return Promise.resolve(handler(request));
    },
  };
}

/** A {@link ToolContext} wired to a recording client. */
export function stubToolContext(
  overrides: Partial<ToolContext> = {}
): ToolContext & { api: RecordingApiClient } {
  const api = (overrides.api as RecordingApiClient | undefined) ?? recordingApiClient();
  return {
    principal: stubPrincipal(),
    credential: stubCredential(),
    ...overrides,
    api,
  };
}

export interface StubFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface StubFetch {
  fetch: FetchLike;
  readonly calls: readonly StubFetchCall[];
}

/**
 * A {@link FetchLike} that records the exact URL it was asked for.
 *
 * The URL is the assertion that matters elsewhere: it is how the base-URL test
 * in `@openrunic/agent` proves that no call was routed anywhere other than the
 * endpoint the deployer configured.
 */
export function stubFetch(
  respond: (url: string) => { status?: number; body?: unknown } = () => ({})
): StubFetch {
  const calls: StubFetchCall[] = [];
  return {
    calls,
    fetch(url, init) {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: init?.headers ?? {},
        body: init?.body,
      });
      const { status = 200, body = {} } = respond(url);
      const response: HttpResponse = {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
      return Promise.resolve(response);
    },
  };
}

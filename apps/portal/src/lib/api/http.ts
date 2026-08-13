/**
 * Live-mode adapter: the same portal API, served by the openrunic API as a PATIENT
 * principal rather than as staff.
 *
 * The portal never chooses which patient it is reading. There is no patient id in any path
 * below: the bearer token identifies the subject and the API scopes every response to it,
 * so a tampered client cannot widen its own access. The token is attached by the caller's
 * `authorization` supplier rather than read from storage here.
 */

import type {
  Appointments,
  HealthRecord,
  HomeSummary,
  Message,
  MessageThread,
  Patient,
  PortalApi,
  Receipt,
  Statement,
} from './types';

export interface HttpApiOptions {
  /** API origin without a trailing slash, e.g. 'https://api.example.invalid'. */
  baseUrl: string;
  /** Returns the current `Authorization` header value, or undefined while signed out. */
  authorization?: () => string | undefined;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

/** A failed request, carrying the status so a screen can tell 404 from a network fault. */
export class HttpApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpApiError';
    this.status = status;
  }
}

export function createHttpApi(options: HttpApiOptions): PortalApi {
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const authorization = options.authorization?.();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init?.body !== undefined) headers['content-type'] = 'application/json';
    if (authorization !== undefined) headers.authorization = authorization;

    const response = await doFetch(`${options.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      throw new HttpApiError(response.status, `Request to ${path} failed.`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return {
    getPatient: () => request<Patient>('/portal/patient'),
    getHome: () => request<HomeSummary>('/portal/home'),
    getHealthRecord: () => request<HealthRecord>('/portal/health-record'),
    getThreads: () => request<MessageThread[]>('/portal/messages'),
    sendMessage: (threadId, body) =>
      post<Message>(`/portal/messages/${encodeURIComponent(threadId)}/replies`, { body }),
    getAppointments: () => request<Appointments>('/portal/appointments'),
    requestAppointment: (input) => post<void>('/portal/appointment-requests', input),
    cancelAppointment: (id) =>
      post<void>(`/portal/appointments/${encodeURIComponent(id)}/cancellation`),
    getForms: () => request('/portal/forms'),
    saveForm: (id, answers) =>
      post<void>(`/portal/forms/${encodeURIComponent(id)}/draft`, { answers }),
    submitForm: (id, answers) =>
      post<void>(`/portal/forms/${encodeURIComponent(id)}/submission`, { answers }),
    getStatements: () => request<Statement[]>('/portal/statements'),
    payStatement: (id) => post<Receipt>(`/portal/statements/${encodeURIComponent(id)}/payment`),
  };
}

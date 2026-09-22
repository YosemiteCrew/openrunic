/**
 * Live-mode adapter: the same portal API, served by the openrunic API as a PATIENT
 * principal rather than as staff.
 *
 * The portal never chooses which patient it is reading. There is no patient id in any path
 * below: the sealed same-origin proxy supplies the bearer token and the API scopes every
 * response to it, so a tampered client cannot widen its own access.
 */

import type {
  Appointments,
  HealthRecord,
  HomeSummary,
  Message,
  MessageThread,
  Patient,
  PortalApi,
  Statement,
} from './types';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER } from '@/lib/auth/routes';

export interface HttpApiOptions {
  /** API origin without a trailing slash, e.g. 'https://api.example.invalid'. */
  baseUrl: string;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  /** Called after the server rejects the sealed patient session. */
  onUnauthorized?: () => void;
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

function unsupported(): Promise<never> {
  return Promise.reject(new HttpApiError(405, 'This portal operation is read-only.'));
}

export function createHttpApi(options: HttpApiOptions): PortalApi {
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER,
    };
    if (init?.body !== undefined) headers['content-type'] = 'application/json';
    const response = await doFetch(`${options.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
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
    requestAppointment: unsupported,
    cancelAppointment: unsupported,
    getForms: () => request('/portal/forms'),
    saveForm: unsupported,
    submitForm: unsupported,
    getStatements: () => request<Statement[]>('/portal/statements'),
    payStatement: unsupported,
  };
}

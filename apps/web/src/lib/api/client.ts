import type {
  ApiClient,
  Appointment,
  AppointmentListQuery,
  ListResponse,
  Patient,
  PatientListQuery,
  ProblemDocument,
} from './types';

/**
 * The typed fetch client for `apps/api`.
 *
 * Two things are deliberate. Failures always arrive as an {@link ApiError}, so
 * a screen never has to tell a rejected promise from a 403, and the RFC 9457
 * problem document is carried through intact, so `ErrorState` can say what
 * happened rather than "something went wrong". And the client takes its
 * bearer token from a function rather than a string: tokens are per-session and
 * they rotate, and a captured string would go stale in a closure.
 */

/** How a request failed, at the granularity a screen actually branches on. */
export type ApiErrorKind =
  /** The request never completed: offline, DNS, CORS, abort. */
  | 'network'
  /** The server answered with a 4xx or 5xx. `problem` is usually present. */
  | 'http'
  /** The server answered, but not with the JSON we expected. */
  | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** 0 when the request never reached the server. */
  readonly status: number;
  readonly problem: ProblemDocument | null;

  constructor(
    message: string,
    options: { kind: ApiErrorKind; status?: number; problem?: ProblemDocument | null }
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.problem = options.problem ?? null;
  }

  /** True when the caller can usefully press "Try again". */
  get retryable(): boolean {
    return this.kind === 'network' || this.status >= 500;
  }
}

export interface ApiClientConfig {
  /** Origin of `apps/api`, without a trailing slash. */
  baseUrl: string;
  /** Path the internal API is mounted at. */
  basePath?: string;
  /**
   * Supplies the bearer token for each request. Return null while signed out.
   * Auth is not wired yet, so the default returns null and the API answers 401,
   * which is the honest state of the world rather than a fake success.
   */
  getToken?: () => string | null;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** The internal, unstable, first-party API. The stable public contract is FHIR R4. */
export const BFF_BASE_PATH = '/bff/v0';

const PROBLEM_JSON = 'application/problem+json';

/** Drops undefined values and stringifies the rest, so `?page=undefined` cannot happen. */
export function toSearchParams(query: object | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function isProblemDocument(value: unknown): value is ProblemDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string' && typeof candidate.status === 'number';
}

async function readProblem(response: Response): Promise<ProblemDocument | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return null;
  try {
    const body: unknown = await response.json();
    return isProblemDocument(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * One request. Everything else in this file is a typed wrapper around it.
 */
export async function requestJson<T>(
  config: ApiClientConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const basePath = config.basePath ?? BFF_BASE_PATH;
  const token = config.getToken?.() ?? null;
  const url = `${config.baseUrl}${basePath}${path}`;

  const headers = new Headers(init.headers);
  headers.set('accept', `application/json, ${PROBLEM_JSON}`);
  if (token) headers.set('authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, headers });
  } catch (cause) {
    // An aborted request is a cancelled render, not a failure worth reporting.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('The server could not be reached.', { kind: 'network' });
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    throw new ApiError(problem?.detail ?? `Request failed with status ${response.status}.`, {
      kind: 'http',
      status: response.status,
      problem,
    });
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('The server sent a response this app could not read.', {
      kind: 'parse',
      status: response.status,
    });
  }
}

/** Builds the live client. Screens never call this: they import `api`. */
export function createHttpClient(config: ApiClientConfig): ApiClient {
  return {
    mode: 'live',
    patients: {
      list: (query, signal) =>
        requestJson<ListResponse<Patient>>(config, `/patients${toSearchParams(query)}`, { signal }),
      get: (id, signal) =>
        requestJson<Patient>(config, `/patients/${encodeURIComponent(id)}`, { signal }),
    },
    appointments: {
      list: (query, signal) =>
        requestJson<ListResponse<Appointment>>(config, `/appointments${toSearchParams(query)}`, {
          signal,
        }),
      get: (id, signal) =>
        requestJson<Appointment>(config, `/appointments/${encodeURIComponent(id)}`, { signal }),
    },
  };
}

export type { ApiClient, AppointmentListQuery, PatientListQuery };

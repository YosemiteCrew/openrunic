import type {
  ApiClient,
  Appointment,
  AppointmentCreateBody,
  AppointmentUpdateBody,
  ClaimDto,
  ClinicalNoteDto,
  DiagnosticReportDto,
  EncounterDto,
  FacilityDto,
  FormDefinitionDto,
  ListResponse,
  NoteAddendumDto,
  Patient,
  PatientCreateBody,
  PatientUpdateBody,
  PaymentDto,
  ProblemDocument,
  RemittanceParseResult,
  RemittancePostResult,
  ServiceRequestDto,
  StatementDto,
  TaskDto,
  UserDto,
  PrincipalCapabilities,
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

/**
 * A body-carrying request.
 *
 * Every write goes through here rather than building its own `RequestInit`, so
 * the content type is set once and a transition with no body still sends `{}`.
 * The API's transition schemas are strict objects, and a POST with no body at
 * all is a 400 rather than the no-op a caller intended.
 */
function writeJson<T>(
  config: ApiClientConfig,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  return requestJson<T>(config, path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...(signal ? { signal } : {}),
  });
}

/** An id reaches a path only escaped: a slash in one must not reach another route. */
function segment(id: string): string {
  return encodeURIComponent(id);
}

/** Builds the live client. Screens never call this: they import `api`. */
export function createHttpClient(config: ApiClientConfig): ApiClient {
  const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
    requestJson<T>(config, path, { signal });
  const post = <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> =>
    writeJson<T>(config, 'POST', path, body, signal);
  const patch = <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> =>
    writeJson<T>(config, 'PATCH', path, body, signal);

  return {
    mode: 'live',
    session: {
      me: (signal) => get<PrincipalCapabilities>('/me', signal),
    },
    facilities: {
      list: (query, signal) =>
        get<ListResponse<FacilityDto>>(`/facilities${toSearchParams(query)}`, signal),
    },
    users: {
      list: (query, signal) => get<ListResponse<UserDto>>(`/users${toSearchParams(query)}`, signal),
    },
    patients: {
      list: (query, signal) =>
        get<ListResponse<Patient>>(`/patients${toSearchParams(query)}`, signal),
      get: (id, signal) => get<Patient>(`/patients/${segment(id)}`, signal),
      create: (body: PatientCreateBody, signal) => post<Patient>('/patients', body, signal),
      update: (id, body: PatientUpdateBody, signal) =>
        patch<Patient>(`/patients/${segment(id)}`, body, signal),
    },
    appointments: {
      list: (query, signal) =>
        get<ListResponse<Appointment>>(`/appointments${toSearchParams(query)}`, signal),
      get: (id, signal) => get<Appointment>(`/appointments/${segment(id)}`, signal),
      create: (body: AppointmentCreateBody, signal) =>
        post<Appointment>('/appointments', body, signal),
      update: (id, body: AppointmentUpdateBody, signal) =>
        patch<Appointment>(`/appointments/${segment(id)}`, body, signal),
    },
    encounters: {
      list: (query, signal) =>
        get<ListResponse<EncounterDto>>(`/encounters${toSearchParams(query)}`, signal),
      get: (id, signal) => get<EncounterDto>(`/encounters/${segment(id)}`, signal),
      sign: (id, signal) => post<EncounterDto>(`/encounters/${segment(id)}/sign`, {}, signal),
    },
    notes: {
      list: (query, signal) =>
        get<ListResponse<ClinicalNoteDto>>(`/notes${toSearchParams(query)}`, signal),
      get: (id, signal) => get<ClinicalNoteDto>(`/notes/${segment(id)}`, signal),
      create: (body, signal) => post<ClinicalNoteDto>('/notes', body, signal),
      update: (id, body, signal) => patch<ClinicalNoteDto>(`/notes/${segment(id)}`, body, signal),
      sign: (id, signal) => post<ClinicalNoteDto>(`/notes/${segment(id)}/sign`, {}, signal),
      listAddenda: (noteId, query, signal) =>
        get<ListResponse<NoteAddendumDto>>(
          `/notes/${segment(noteId)}/addenda${toSearchParams(query)}`,
          signal
        ),
      addAddendum: (noteId, body, signal) =>
        post<NoteAddendumDto>(`/notes/${segment(noteId)}/addenda`, body, signal),
    },
    orders: {
      sign: (id, signal) => post<ServiceRequestDto>(`/orders/${segment(id)}/sign`, {}, signal),
      transmit: (id, signal) =>
        post<ServiceRequestDto>(`/orders/${segment(id)}/transmit`, {}, signal),
      cancel: (id, signal) => post<ServiceRequestDto>(`/orders/${segment(id)}/cancel`, {}, signal),
    },
    results: {
      review: (id, signal) =>
        post<DiagnosticReportDto>(`/results/${segment(id)}/review`, {}, signal),
    },
    tasks: {
      complete: (id, body, signal) =>
        post<TaskDto>(`/tasks/${segment(id)}/complete`, body ?? {}, signal),
    },
    claims: {
      scrub: (id, body, signal) =>
        post<ClaimDto>(`/claims/${segment(id)}/scrub`, body ?? {}, signal),
      submit: (id, body, signal) =>
        post<ClaimDto>(`/claims/${segment(id)}/submit`, body ?? {}, signal),
      status: (id, body, signal) => post<ClaimDto>(`/claims/${segment(id)}/status`, body, signal),
    },
    payments: {
      post: (id, body, signal) =>
        post<PaymentDto>(`/payments/${segment(id)}/post`, body ?? {}, signal),
    },
    remittances: {
      parse: (id, signal) =>
        post<RemittanceParseResult>(`/remittances/${segment(id)}/parse`, {}, signal),
      post: (id, body, signal) =>
        post<RemittancePostResult>(`/remittances/${segment(id)}/post`, body ?? {}, signal),
    },
    statements: {
      generate: (id, body, signal) =>
        post<StatementDto>(`/statements/${segment(id)}/generate`, body ?? {}, signal),
      send: (id, body, signal) =>
        post<StatementDto>(`/statements/${segment(id)}/send`, body, signal),
    },
    forms: {
      publish: (id, body, signal) =>
        post<FormDefinitionDto>(`/forms/definitions/${segment(id)}/publish`, body, signal),
    },
  };
}

export type { ApiClient, AppointmentListQuery, PatientListQuery } from './types';

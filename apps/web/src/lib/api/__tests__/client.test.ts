import { describe, expect, it, vi } from 'vitest';

import { ApiError, createHttpClient, requestJson, toSearchParams } from '@/lib/api/client';
import { API_BASE_URL, API_CONFIG, resolveApiMode } from '@/lib/api/config';
import { createMockClient, filterAppointments, filterPatients } from '@/lib/api/mock/client';
import {
  MOCK_APPOINTMENTS,
  MOCK_CLINIC_DAY,
  MOCK_PATIENTS,
  MOCK_PROVIDERS,
  mockProviderName,
} from '@/lib/api/mock/fixtures';

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('resolveApiMode', () => {
  it('defaults to mock so a screen renders without Postgres', () => {
    expect(resolveApiMode(undefined)).toBe('mock');
    expect(resolveApiMode('anything-else')).toBe('mock');
  });

  it('opts into the live API explicitly', () => {
    expect(resolveApiMode('live')).toBe('live');
  });
});

describe('toSearchParams', () => {
  it('drops undefined so a query string never carries the string "undefined"', () => {
    expect(toSearchParams({ q: 'oye', page: undefined, active: true })).toBe('?q=oye&active=true');
  });

  it('returns nothing for an empty query', () => {
    expect(toSearchParams({})).toBe('');
    expect(toSearchParams(undefined)).toBe('');
  });
});

describe('requestJson', () => {
  it('sends the bearer token and the accept header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson(
      { baseUrl: 'http://api.test', getToken: () => 'tok', fetchImpl },
      '/patients'
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/bff/v0/patients');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('turns a problem document into an ApiError that keeps the request id', async () => {
    const problem = {
      type: 'https://openrunic.org/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'The role lacks the permission.',
      instance: '/bff/v0/patients',
      requestId: 'req-42',
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(problem, 403, 'application/problem+json'));

    await expect(
      requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients')
    ).rejects.toMatchObject({
      kind: 'http',
      status: 403,
      problem: { requestId: 'req-42' },
    });
  });

  it('reports an unreachable server as a retryable network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    const failure = await requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients').catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).retryable).toBe(true);
  });

  it('does not dress an abort up as a failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(
      requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients')
    ).rejects.toBeInstanceOf(DOMException);
  });
});

describe('createHttpClient', () => {
  it('builds the list path with its query string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [], page: {} }));
    const client = createHttpClient({ baseUrl: 'http://api.test', fetchImpl });
    await client.patients.list({ q: 'oye', pageSize: 5 });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/bff/v0/patients?q=oye&pageSize=5');
  });
});

describe('mock fixtures', () => {
  it('is synthetic and obviously so', () => {
    for (const patient of MOCK_PATIENTS) {
      expect(patient.mrn).toMatch(/^OR-\d{6}$/);
    }
    expect(MOCK_PATIENTS.some((patient) => patient.name.family === 'Patientsson')).toBe(true);
  });

  it('is deterministic: every appointment sits on the fixed clinic day', () => {
    for (const appointment of MOCK_APPOINTMENTS) {
      expect(appointment.start.startsWith(MOCK_CLINIC_DAY)).toBe(true);
      expect(appointment.end > appointment.start).toBe(true);
    }
  });

  it('names a provider rather than showing a uuid', () => {
    expect(mockProviderName(MOCK_PROVIDERS[0].id)).toBe('Dr. Okafor');
    expect(mockProviderName('nobody')).toBe('Unassigned');
  });
});

describe('filterPatients', () => {
  it('searches free text over name and MRN, as the API does', () => {
    expect(filterPatients(MOCK_PATIENTS, { q: 'oyelaran' })).toHaveLength(1);
    expect(filterPatients(MOCK_PATIENTS, { q: 'or-100482' })).toHaveLength(1);
  });

  it('matches family and given as case-insensitive prefixes', () => {
    expect(filterPatients(MOCK_PATIENTS, { family: 'patient' })).toHaveLength(1);
    expect(filterPatients(MOCK_PATIENTS, { given: 'AIK' })).toHaveLength(1);
  });

  it('filters on active', () => {
    const inactive = filterPatients(MOCK_PATIENTS, { active: false });
    expect(inactive.length).toBeGreaterThan(0);
    expect(inactive.every((patient) => !patient.active)).toBe(true);
  });

  it('sorts by family name by default and honours the order flag', () => {
    const ascending = filterPatients(MOCK_PATIENTS, {});
    const descending = filterPatients(MOCK_PATIENTS, { order: 'desc' });
    expect(ascending[0]?.name.family).toBe('Ahlgren');
    expect(descending[0]?.name.family).toBe(ascending.at(-1)?.name.family);
  });
});

describe('filterAppointments', () => {
  it('treats from as inclusive and to as exclusive, so a day is one window', () => {
    const day = filterAppointments(MOCK_APPOINTMENTS, {
      from: `${MOCK_CLINIC_DAY}T00:00:00.000Z`,
      to: '2026-08-13T00:00:00.000Z',
    });
    expect(day).toHaveLength(MOCK_APPOINTMENTS.length);

    const morning = filterAppointments(MOCK_APPOINTMENTS, {
      from: `${MOCK_CLINIC_DAY}T00:00:00.000Z`,
      to: `${MOCK_CLINIC_DAY}T09:00:00.000Z`,
    });
    expect(
      morning.every((appointment) => appointment.start < `${MOCK_CLINIC_DAY}T09:00:00.000Z`)
    ).toBe(true);
    expect(morning.length).toBeLessThan(MOCK_APPOINTMENTS.length);
  });

  it('filters the flow board by status', () => {
    const booked = filterAppointments(MOCK_APPOINTMENTS, { status: 'BOOKED' });
    expect(booked.length).toBeGreaterThan(0);
    expect(booked.every((appointment) => appointment.status === 'BOOKED')).toBe(true);
  });
});

describe('createMockClient', () => {
  it('answers the same envelope shape the API answers', async () => {
    const client = createMockClient();
    const page = await client.patients.list({ pageSize: 5 });

    expect(client.mode).toBe('mock');
    expect(page.data).toHaveLength(5);
    expect(page.page).toEqual({
      page: 1,
      pageSize: 5,
      total: MOCK_PATIENTS.length,
      totalPages: Math.ceil(MOCK_PATIENTS.length / 5),
    });
  });

  it('gives an empty search one page, not zero', async () => {
    const page = await createMockClient().patients.list({ q: 'nobody by that name' });
    expect(page.data).toHaveLength(0);
    expect(page.page.totalPages).toBe(1);
  });

  it('reads one patient by id', async () => {
    const first = MOCK_PATIENTS[0];
    expect(first).toBeDefined();
    const patient = await createMockClient().patients.get(first?.id ?? '');
    expect(patient.mrn).toBe(first?.mrn);
  });

  it('fails the way the API fails, with a problem document', async () => {
    const failure = await createMockClient()
      .patients.get('no-such-id')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).problem?.type).toContain('not-found');
  });

  it('can be handed its own fixtures for a screen test', async () => {
    const client = createMockClient({ patients: [], appointments: [] });
    await expect(client.appointments.list()).resolves.toMatchObject({ data: [] });
  });
});

describe('requestJson, when the server answers badly', () => {
  it('falls back to the status when an error carries no problem document', async () => {
    // A 502 from a proxy in front of the API is HTML, not problem+json, and
    // parsing it as a problem would put a page of markup in an error toast.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    );

    const failure = await requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients').catch(
      (error: unknown) => error as ApiError
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe('Request failed with status 502.');
    expect((failure as ApiError).problem).toBeNull();
    // A gateway hiccup is worth a retry, so the screen offers one.
    expect((failure as ApiError).retryable).toBe(true);
  });

  it('ignores a JSON error body that is not a problem document', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ oops: true }, 400));

    const failure = await requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients').catch(
      (error: unknown) => error as ApiError
    );

    expect((failure as ApiError).problem).toBeNull();
    expect((failure as ApiError).message).toBe('Request failed with status 400.');
    // 400 is the caller's fault; retrying the same request cannot fix it.
    expect((failure as ApiError).retryable).toBe(false);
  });

  it('ignores a JSON error body that is a bare string or null', async () => {
    for (const body of ['nope', null]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body, 409));
      const failure = await requestJson(
        { baseUrl: 'http://api.test', fetchImpl },
        '/patients'
      ).catch((error: unknown) => error as ApiError);

      expect((failure as ApiError).problem).toBeNull();
    }
  });

  it('survives an error response whose JSON body is truncated', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"title": "Forb', {
        status: 500,
        headers: { 'content-type': 'application/problem+json' },
      })
    );

    const failure = await requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients').catch(
      (error: unknown) => error as ApiError
    );

    expect((failure as ApiError).problem).toBeNull();
    expect((failure as ApiError).status).toBe(500);
  });

  it('names a broken success body as unreadable rather than as a network failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } })
      );

    const failure = await requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients').catch(
      (error: unknown) => error as ApiError
    );

    expect((failure as ApiError).kind).toBe('parse');
    expect((failure as ApiError).message).toBe(
      'The server sent a response this app could not read.'
    );
    // Retrying a malformed body gets the same malformed body.
    expect((failure as ApiError).retryable).toBe(false);
  });

  it('sends no authorization header when there is no token to send', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson({ baseUrl: 'http://api.test', fetchImpl }, '/patients');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('honours a base path other than the default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson({ baseUrl: 'http://api.test', basePath: '/fhir/r4', fetchImpl }, '/Patient');

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/fhir/r4/Patient');
  });
});

describe('createHttpClient, every route it exposes', () => {
  it('reads one patient and one appointment by id, escaping the id in the path', async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ id: 'x' })));
    const client = createHttpClient({ baseUrl: 'http://api.test', fetchImpl });

    // An id is user-controlled in a URL bar; it is escaped rather than
    // concatenated, so a slash in one cannot reach another route.
    await client.patients.get('a/b?c');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/bff/v0/patients/a%2Fb%3Fc');

    await client.appointments.get('appt 1');
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('http://api.test/bff/v0/appointments/appt%201');
  });

  it('builds the appointment list path with its day window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [], page: {} }));
    const client = createHttpClient({ baseUrl: 'http://api.test', fetchImpl });

    await client.appointments.list({ from: '2026-08-12T00:00:00.000Z', pageSize: 100 });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'http://api.test/bff/v0/appointments?from=2026-08-12T00%3A00%3A00.000Z&pageSize=100'
    );
  });

  it('passes the abort signal through, so a cancelled render cancels the request', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ data: [], page: {} })));
    const client = createHttpClient({ baseUrl: 'http://api.test', fetchImpl });
    const controller = new AbortController();

    await client.patients.list({}, controller.signal);
    await client.appointments.list({}, controller.signal);

    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).signal).toBe(controller.signal);
    }
  });

  it('says it is the live client, which is how a screen labels its data', () => {
    expect(createHttpClient({ baseUrl: 'http://api.test' }).mode).toBe('live');
  });
});

describe('API_CONFIG', () => {
  it('is the one transport configuration, and it holds no token yet', () => {
    // Both the screens' client and the assistant transport read this, so a
    // token source lands in one place rather than in two that can drift.
    expect(API_CONFIG.baseUrl).toBe(API_BASE_URL);
    expect(API_CONFIG.getToken?.()).toBeNull();
  });
});

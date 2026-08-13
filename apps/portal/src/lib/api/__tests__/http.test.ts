import { describe, expect, it, vi } from 'vitest';
import { createHttpApi, HttpApiError } from '@/lib/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* A Response body can only be read once, so the stub builds a fresh one per call rather
   than handing the same object to every request. */
function fetchStub(build: () => Response = () => jsonResponse({ ok: true })) {
  return vi.fn(() => Promise.resolve(build())) as unknown as typeof fetch;
}

const BASE = 'https://api.example.invalid';

describe('createHttpApi', () => {
  it('reads from patient-scoped paths that carry no patient id', async () => {
    const fetchImpl = fetchStub(() => jsonResponse({ mrn: 'OR-100482' }));
    const api = createHttpApi({ baseUrl: BASE, fetchImpl });

    await api.getPatient();

    // The bearer token identifies the subject. A patient id in the path would be a knob a
    // tampered client could turn.
    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/portal/patient`);
    expect(String(url)).not.toMatch(/patient-/);
  });

  it('sends the authorization header when one is supplied', async () => {
    const fetchImpl = fetchStub();
    const api = createHttpApi({
      baseUrl: BASE,
      authorization: () => 'Bearer token-value',
      fetchImpl,
    });

    await api.getHome();

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer token-value' });
  });

  it('omits the header while signed out', async () => {
    const fetchImpl = fetchStub();
    const api = createHttpApi({ baseUrl: BASE, authorization: () => undefined, fetchImpl });

    await api.getHealthRecord();

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty('authorization');
  });

  it('sets a json content type only when there is a body', async () => {
    const fetchImpl = fetchStub();
    const api = createHttpApi({ baseUrl: BASE, fetchImpl });

    await api.sendMessage('thread-1', 'Hello.');
    const withBody = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(withBody?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(withBody?.body).toBe(JSON.stringify({ body: 'Hello.' }));

    vi.mocked(fetchImpl).mockClear();
    await api.cancelAppointment('appt-1');
    const withoutBody = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(withoutBody?.headers).not.toHaveProperty('content-type');
  });

  it('escapes ids so a crafted id cannot climb the path', async () => {
    const fetchImpl = fetchStub();
    const api = createHttpApi({ baseUrl: BASE, fetchImpl });

    await api.payStatement('../../admin');

    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/portal/statements/..%2F..%2Fadmin/payment`);
  });

  it('throws with the status when the response is not ok', async () => {
    const fetchImpl = fetchStub(() => jsonResponse({ error: 'nope' }, 403));
    const api = createHttpApi({ baseUrl: BASE, fetchImpl });

    const thrown = await api.getThreads().catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(HttpApiError);
    expect((thrown as HttpApiError).status).toBe(403);
  });

  it('treats 204 as an empty answer rather than parsing no body as json', async () => {
    const fetchImpl = fetchStub(() => new Response(null, { status: 204 }));
    const api = createHttpApi({ baseUrl: BASE, fetchImpl });

    await expect(api.submitForm('form-1', { 'q-1': 'Yes' })).resolves.toBeUndefined();
  });

  it('covers the remaining reads and writes', async () => {
    const fetchImpl = fetchStub();
    const api = createHttpApi({ baseUrl: BASE, fetchImpl });

    await api.getAppointments();
    await api.getForms();
    await api.getStatements();
    await api.saveForm('form-1', { 'q-1': 'Yes' });
    await api.requestAppointment({ reason: 'Cough', preferredTimes: 'Mornings' });

    expect(vi.mocked(fetchImpl).mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/portal/appointments`,
      `${BASE}/portal/forms`,
      `${BASE}/portal/statements`,
      `${BASE}/portal/forms/form-1/draft`,
      `${BASE}/portal/appointment-requests`,
    ]);
  });

  it('falls back to the platform fetch when none is injected', async () => {
    const platform = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal('fetch', platform);

    await createHttpApi({ baseUrl: BASE }).getHome();

    expect(platform).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

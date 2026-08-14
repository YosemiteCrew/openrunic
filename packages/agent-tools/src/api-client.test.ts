import { describe, expect, it } from 'vitest';

import { createHttpApiClient, type HttpResponse } from './api-client.js';
import { ToolError } from './errors.js';
import { stubCredential, stubFetch, stubPrincipal, TEST_TENANT_ID } from './testing/index.js';

/**
 * The client is where "with the end user's own credentials" stops being a
 * sentence in an ADR and becomes two headers.
 */

const context = { principal: stubPrincipal(), credential: stubCredential('caller-token') };

describe('the API client', () => {
  it('sends the caller credential, not an agent one', async () => {
    const stub = stubFetch(() => ({ body: { ok: true } }));
    const client = createHttpApiClient({ baseUrl: 'http://api:4000', fetch: stub.fetch });

    await client.call({ method: 'GET', path: '/bff/v0/patients' }, context);

    expect(stub.calls[0]?.headers['authorization']).toBe('Bearer caller-token');
  });

  it('states the organisation it believes it is addressing, for the API to check', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    const client = createHttpApiClient({ baseUrl: 'http://api:4000', fetch: stub.fetch });

    await client.call({ method: 'GET', path: '/bff/v0/patients' }, context);

    expect(stub.calls[0]?.headers['x-openrunic-tenant']).toBe(TEST_TENANT_ID);
  });

  it('renders a query string and drops undefined values', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    const client = createHttpApiClient({ baseUrl: 'http://api:4000/', fetch: stub.fetch });

    await client.call(
      {
        method: 'GET',
        path: '/bff/v0/patients',
        query: { q: 'Testina Patientsson', pageSize: 25, active: true, mrn: undefined },
      },
      context
    );

    expect(stub.calls[0]?.url).toBe(
      'http://api:4000/bff/v0/patients?q=Testina%20Patientsson&pageSize=25&active=true'
    );
  });

  it('omits the query string entirely when nothing survives', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    const client = createHttpApiClient({ baseUrl: 'http://api:4000', fetch: stub.fetch });

    await client.call(
      { method: 'GET', path: '/bff/v0/patients', query: { q: undefined } },
      context
    );

    expect(stub.calls[0]?.url).toBe('http://api:4000/bff/v0/patients');
  });

  it('serialises a body and declares its content type', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    const client = createHttpApiClient({ baseUrl: 'http://api:4000', fetch: stub.fetch });

    await client.call(
      { method: 'POST', path: '/bff/v0/appointments', body: { durationMinutes: 20 } },
      context
    );

    expect(stub.calls[0]?.body).toBe('{"durationMinutes":20}');
    expect(stub.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('turns a refusal into a tool failure without forwarding the upstream detail', async () => {
    const stub = stubFetch(() => ({
      status: 403,
      body: { detail: 'patient Testina Patientsson' },
    }));
    const client = createHttpApiClient({ baseUrl: 'http://api:4000', fetch: stub.fetch });

    const error: unknown = await client
      .call({ method: 'GET', path: '/bff/v0/claims' }, context)
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('AGENT_TOOL_FAILED');
    expect((error as ToolError).status).toBe(403);
    expect((error as ToolError).message).not.toContain('Testina');
  });

  it('turns an unreachable endpoint into a tool failure that names the host', async () => {
    const client = createHttpApiClient({
      baseUrl: 'http://api:4000',
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    await expect(client.call({ method: 'GET', path: '/bff/v0/patients' }, context)).rejects.toThrow(
      /http:\/\/api:4000 could not be reached/
    );
  });

  it('refuses a body that is not JSON rather than guessing at it', async () => {
    const broken: HttpResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
      text: () => Promise.resolve('<html>'),
    };
    const client = createHttpApiClient({
      baseUrl: 'http://api:4000',
      fetch: () => Promise.resolve(broken),
    });

    await expect(
      client.call({ method: 'GET', path: '/bff/v0/patients' }, context)
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_OUTPUT_INVALID' });
  });

  it('honours a caller cancellation alongside its own timeout', async () => {
    const controller = new AbortController();
    const client = createHttpApiClient({
      baseUrl: 'http://api:4000',
      timeoutMs: 50,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    });

    const call = client.call(
      { method: 'GET', path: '/bff/v0/patients' },
      { ...context, signal: controller.signal }
    );
    controller.abort();

    await expect(call).rejects.toThrow(/could not be reached/);
  });
});

import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

/**
 * Liveness and readiness are different questions, and conflating them is how a
 * database outage stays invisible.
 *
 * `/healthz` answers "is this process running". `/readyz` answers "can it serve
 * data". A process whose database has gone answers the first perfectly while
 * being unable to answer a single clinical question, so the container runtime
 * sees a green container, the status page sees a green service, and the only
 * people who know are the staff whose notes are not saving.
 */

describe('/healthz', () => {
  it('answers without a token, because a healthcheck has no credentials', async () => {
    const response = await createApp().request('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'openrunic-api' });
  });

  it('stays ok even when the database is gone, because liveness is not readiness', async () => {
    const app = createApp({ readiness: () => Promise.resolve(false) });

    expect((await app.request('/healthz')).status).toBe(200);
  });
});

describe('/readyz', () => {
  it('answers without a token', async () => {
    // The container runtime's healthcheck runs this and has no way to
    // authenticate. An authenticated readiness probe answers 401 forever, the
    // container never turns healthy, and nothing depending on it ever starts.
    expect((await createApp().request('/readyz')).status).toBe(200);
  });

  it('reports ok when the readiness check passes', async () => {
    const app = createApp({ readiness: () => Promise.resolve(true) });
    const response = await app.request('/readyz');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', checked: ['database'] });
  });

  it('reports 503 when the database cannot be reached', async () => {
    const app = createApp({ readiness: () => Promise.resolve(false) });
    const response = await app.request('/readyz');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', checked: ['database'] });
  });

  it('treats a thrown readiness check as not ready rather than as a 500', async () => {
    const app = createApp({
      readiness: () => Promise.reject(new Error('connection refused')),
    });
    const response = await app.request('/readyz');

    expect(response.status).toBe(503);
  });

  it('never leaks why it is not ready', async () => {
    const app = createApp({
      readiness: () => Promise.reject(new Error('postgresql://user:secret@db:5432 refused')),
    });
    const body = await (await app.request('/readyz')).text();

    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('secret');
  });

  it('reports ok with no readiness check configured, as in development', async () => {
    const response = await createApp().request('/readyz');

    expect(await response.json()).toMatchObject({ status: 'ok', checked: [] });
  });
});

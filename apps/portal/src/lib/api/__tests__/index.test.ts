import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPortalApi, getPortalApi, resolveApiMode } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('resolveApiMode', () => {
  it('reads live only from the exact string', () => {
    expect(resolveApiMode('live')).toBe('live');
  });

  it('treats anything else as mock, so a typo can never reach a real record', () => {
    expect(resolveApiMode('mock')).toBe('mock');
    expect(resolveApiMode('Live')).toBe('mock');
    expect(resolveApiMode('production')).toBe('mock');
    expect(resolveApiMode(undefined)).toBe('mock');
  });
});

describe('createPortalApi', () => {
  it('defaults to the mock adapter with no configuration at all', async () => {
    await expect(createPortalApi().getPatient()).resolves.toMatchObject({ mrn: 'OR-100482' });
  });

  it('builds the http adapter in live mode', async () => {
    const platform = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ mrn: 'OR-000000' }), {
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    vi.stubGlobal('fetch', platform);

    await createPortalApi({ mode: 'live', baseUrl: 'https://api.example.invalid' }).getPatient();

    expect(platform).toHaveBeenCalledWith(
      'https://api.example.invalid/portal/patient',
      expect.anything()
    );
  });

  it('falls back to a relative base url when live mode is configured without one', async () => {
    const platform = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } })
      )
    );
    vi.stubGlobal('fetch', platform);

    await createPortalApi({ mode: 'live' }).getPatient();

    expect(platform).toHaveBeenCalledWith('/portal/patient', expect.anything());
  });
});

describe('getPortalApi', () => {
  it('hands back one instance, so mock edits survive a navigation', () => {
    expect(getPortalApi()).toBe(getPortalApi());
  });

  it('is in mock mode by default', async () => {
    await expect(getPortalApi().getPatient()).resolves.toMatchObject({
      name: 'Testina Patientsson',
    });
  });
});

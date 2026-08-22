import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectivityProvider,
  DowntimeBanner,
  DowntimeBoundary,
  useConnectivity,
} from '@/components/downtime';
import { resolveStatus } from '@/lib/downtime/status';

/**
 * Downtime mode, tested against the three failures it exists for: the database
 * going away, the API going away, and a screen throwing while rendering.
 *
 * The assertions are about what a person sees, because the requirement is about
 * what a person sees. "Never a blank page and never a stack trace" is only
 * proved by looking for the words.
 */

function ok(): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200 } as Response);
}
/** What the health route answers when the API is up and its database is not. */
function databaseDown(): Promise<Response> {
  return Promise.resolve({ ok: false, status: 503 } as Response);
}
/** What the health route answers when the API itself did not respond. */
function apiUnreachable(): Promise<Response> {
  return Promise.resolve({ ok: false, status: 502 } as Response);
}
function unreachable(): Promise<Response> {
  return Promise.reject(new TypeError('Failed to fetch'));
}

/** Lets a test drive the data-layer signal the way a failing query would. */
function FailingScreen({ fail }: { fail: boolean }) {
  const { reportDataFailure, reportDataSuccess } = useConnectivity();
  return (
    <button
      type="button"
      onClick={() => {
        if (fail) reportDataFailure();
        else reportDataSuccess();
      }}
    >
      run query
    </button>
  );
}

describe('resolveStatus', () => {
  it('is online when the browser, the server and the data layer all agree', () => {
    expect(resolveStatus({ browserOnline: true, probe: 'ok', dataFailing: false })).toBe('online');
  });

  it('is offline when the browser reports no network, whatever the probe said', () => {
    expect(resolveStatus({ browserOnline: false, probe: 'ok', dataFailing: false })).toBe(
      'offline'
    );
  });

  it('is offline when nothing answers on this origin', () => {
    expect(resolveStatus({ browserOnline: true, probe: 'down', dataFailing: false })).toBe(
      'offline'
    );
  });

  it('is degraded when the server is up and its database is gone', () => {
    // The readiness check is what makes this distinguishable. A liveness check
    // reports a database outage as perfectly healthy, which is the bug this
    // state exists to prevent.
    expect(resolveStatus({ browserOnline: true, probe: 'degraded', dataFailing: false })).toBe(
      'degraded'
    );
  });

  it('is degraded when readiness passes but real requests are failing', () => {
    expect(resolveStatus({ browserOnline: true, probe: 'ok', dataFailing: true })).toBe('degraded');
  });

  it('does not claim an outage before the first probe has answered', () => {
    expect(resolveStatus({ browserOnline: true, probe: null, dataFailing: false })).toBe('online');
  });

  it('trusts a data failure even before the first probe answers', () => {
    expect(resolveStatus({ browserOnline: true, probe: null, dataFailing: true })).toBe('degraded');
  });
});

describe('DowntimeBanner', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows nothing at all while everything is working', async () => {
    render(
      <ConnectivityProvider fetchImpl={ok} healthUrl="/api/health">
        <DowntimeBanner />
      </ConnectivityProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('downtime-banner')).not.toBeInTheDocument();
    });
  });

  it('tells staff the API is unreachable, and what to do about it', async () => {
    render(
      <ConnectivityProvider fetchImpl={unreachable} healthUrl="/api/health">
        <DowntimeBanner />
      </ConnectivityProvider>
    );

    const banner = await screen.findByTestId('downtime-banner');

    expect(banner).toHaveAttribute('data-status', 'offline');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('Cannot reach openrunic');
    expect(banner).toHaveTextContent('Check that this computer is on the practice network');
  });

  it('warns that records cannot be saved when the database is gone', async () => {
    // Driven by the readiness probe alone: no screen has to notice a failed
    // query first, so staff are told before they type a note that will be lost.
    render(
      <ConnectivityProvider fetchImpl={databaseDown} healthUrl="/api/health">
        <DowntimeBanner />
      </ConnectivityProvider>
    );

    const banner = await screen.findByTestId('downtime-banner');
    expect(banner).toHaveAttribute('data-status', 'degraded');
    expect(banner).toHaveTextContent('records cannot be saved');
    expect(banner).toHaveTextContent('Keep working on paper');
  });

  it('also degrades when a screen reports a failed request', async () => {
    const user = { click: (element: HTMLElement) => act(() => element.click()) };

    render(
      <ConnectivityProvider fetchImpl={ok} healthUrl="/api/health">
        <DowntimeBanner />
        <FailingScreen fail />
      </ConnectivityProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('downtime-banner')).not.toBeInTheDocument();
    });

    user.click(screen.getByRole('button', { name: 'run query' }));

    const banner = await screen.findByTestId('downtime-banner');
    expect(banner).toHaveAttribute('data-status', 'degraded');
  });

  it('says the server is unreachable, not read-only, during a total outage', async () => {
    // 502 means the API never answered. Telling staff the system is "read-only"
    // then would be actively misleading: nothing loads at all.
    render(
      <ConnectivityProvider fetchImpl={apiUnreachable} healthUrl="/api/health">
        <DowntimeBanner />
      </ConnectivityProvider>
    );

    const banner = await screen.findByTestId('downtime-banner');
    expect(banner).toHaveAttribute('data-status', 'offline');
    expect(banner).toHaveTextContent('Cannot reach openrunic');
  });

  it('never shows a raw error, a status code or a connection string', async () => {
    render(
      <ConnectivityProvider fetchImpl={unreachable} healthUrl="/api/health">
        <DowntimeBanner />
      </ConnectivityProvider>
    );

    const banner = await screen.findByTestId('downtime-banner');
    const text = banner.textContent ?? '';

    expect(text).not.toMatch(/postgres|ECONNREFUSED|Failed to fetch|\b5\d\d\b|stack/i);
  });

  it('clears itself when the retry button finds the server back', async () => {
    // Fails once, then recovers - the shape of a container restart. Staff must
    // be able to confirm recovery without being told to reload, because a
    // reload loses whatever is in an unsaved form.
    let attempt = 0;
    const flaky = (): Promise<Response> => {
      attempt += 1;
      return attempt === 1 ? unreachable() : ok();
    };

    render(
      <ConnectivityProvider fetchImpl={flaky} healthUrl="/api/health" intervalMs={10_000_000}>
        <DowntimeBanner />
      </ConnectivityProvider>
    );

    const retry = await screen.findByRole('button', { name: 'Check again now' });
    act(() => retry.click());

    await waitFor(() => {
      expect(screen.queryByTestId('downtime-banner')).not.toBeInTheDocument();
    });
    expect(attempt).toBeGreaterThan(1);
  });
});

describe('DowntimeBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Exploding(): never {
    throw new Error('SELECT * FROM "Patient" failed: postgresql://user:pw@db:5432');
  }

  it('replaces a thrown render error with a calm explanation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <DowntimeBoundary areaKey="nav.schedule">
        <Exploding />
      </DowntimeBoundary>
    );

    const fallback = screen.getByTestId('downtime-fallback');
    expect(fallback).toHaveTextContent('Schedule could not be displayed');
    expect(fallback).toHaveTextContent('No patient information has been changed or lost');
  });

  it('never puts the error text on screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <DowntimeBoundary>
        <Exploding />
      </DowntimeBoundary>
    );

    const text = screen.getByTestId('downtime-fallback').textContent ?? '';
    expect(text).not.toContain('postgresql://');
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('Patient');
  });

  it('shows a reference staff can quote to support', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <DowntimeBoundary>
        <Exploding />
      </DowntimeBoundary>
    );

    expect(screen.getByTestId('downtime-fallback')).toHaveTextContent(/Reference [A-Z0-9]{6}/);
  });

  it('renders its children untouched when nothing throws', () => {
    render(
      <DowntimeBoundary>
        <p>the schedule</p>
      </DowntimeBoundary>
    );

    expect(screen.getByText('the schedule')).toBeInTheDocument();
    expect(screen.queryByTestId('downtime-fallback')).not.toBeInTheDocument();
  });
});

describe('useConnectivity outside a provider', () => {
  /**
   * The default context value is not dead code: a component rendered outside
   * `ConnectivityProvider` still calls these, and the failure mode that matters
   * is a screen throwing because `reportDataFailure` was undefined. So the
   * defaults are no-ops that assume the good state, and this pins that.
   */
  function Probe(): React.JSX.Element {
    const { status, reportDataFailure, reportDataSuccess, recheck } = useConnectivity();
    return (
      <div>
        <span data-testid="status">{status}</span>
        <button
          onClick={() => {
            reportDataFailure();
            reportDataSuccess();
            recheck();
          }}
          type="button"
        >
          poke
        </button>
      </div>
    );
  }

  it('assumes online and does nothing, rather than throwing', () => {
    render(<Probe />);

    expect(screen.getByTestId('status')).toHaveTextContent('online');
    expect(() => {
      act(() => screen.getByRole('button', { name: 'poke' }).click());
    }).not.toThrow();
    // Still online: the no-ops must not fabricate an outage either.
    expect(screen.getByTestId('status')).toHaveTextContent('online');
  });
});

describe('reporting from a screen', () => {
  function Reporter(): React.JSX.Element {
    const { status, reportDataFailure, reportDataSuccess } = useConnectivity();
    return (
      <div>
        <span data-testid="status">{status}</span>
        <button onClick={reportDataFailure} type="button">
          fail
        </button>
        <button onClick={reportDataSuccess} type="button">
          succeed
        </button>
      </div>
    );
  }

  it('degrades on a reported failure and recovers on a reported success', async () => {
    render(
      <ConnectivityProvider fetchImpl={() => ok()} healthUrl="/api/health" intervalMs={10_000_000}>
        <Reporter />
      </ConnectivityProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('online');
    });

    act(() => screen.getByRole('button', { name: 'fail' }).click());
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('degraded');
    });

    // The recovery path matters as much as the failure one: a banner that
    // never clears is the same problem as a banner that never appears.
    act(() => screen.getByRole('button', { name: 'succeed' }).click());
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('online');
    });
  });
});

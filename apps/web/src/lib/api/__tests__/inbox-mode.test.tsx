import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';
import type { AsyncState } from '@/lib/api/hooks';
import type { InboxPage, WorklistClient } from '@/lib/api/worklist';

/**
 * What the inbox does before it knows who is asking.
 *
 * `NEXT_PUBLIC_API_MODE` is read once at module load, so the live branch of
 * this seam is unreachable from an ordinary import: every other test in this
 * directory runs in mock mode and never sees it. The module is therefore
 * re-imported per case with the environment set, which is what makes the two
 * arms below two arms rather than one arm and a comment.
 *
 * The hazard is not a slow screen. `/bff/v0/tasks` filters on a user id, and a
 * request sent before `/bff/v0/me` comes back would either carry no id at all
 * or be answered from fixtures with the live badge gone - one of them showing a
 * clinician somebody else's work under a heading that says it is theirs.
 */

const ME = 'user-me';

/** The capabilities answer this render is standing in for. */
let capabilities: AsyncState<{ userId: string | null }>;

vi.mock('@/lib/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/hooks')>();
  return { ...actual, useOwnCapabilities: () => capabilities };
});

const listTasks = vi.fn();
vi.mock('@/lib/api/api', () => ({ api: { tasks: { list: listTasks } } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/inbox',
}));

async function load(mode: string): Promise<typeof import('@/lib/api/worklist')> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_MODE', mode);
  return import('@/lib/api/worklist');
}

/* `refetch` is part of the shape rather than cast away, because the arms below
   assert that the inbox hands the caller the name request's OWN retry. A
   fixture missing it would make that assertion pass against undefined. */
function resolved(userId: string | null): AsyncState<{ userId: string | null }> {
  return { status: 'success', data: { userId }, error: null, refetch: vi.fn() };
}

function pending(): AsyncState<{ userId: string | null }> {
  return { status: 'loading', data: null, error: null, refetch: vi.fn() };
}

/** `/bff/v0/me` refused or never arrived - the state with no way out of itself. */
function unnamed(refetch: () => void): AsyncState<{ userId: string | null }> {
  return {
    status: 'error',
    data: null,
    error: new ApiError('offline', { kind: 'network' }),
    refetch,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  listTasks.mockReset();
});

describe('the inbox in live mode', () => {
  /* Asserted on the ROWS rather than on the request count. "Nothing was
     fetched" is also what a fixture fallback produces - it reads no route
     either - so a call-count assertion passes on the one outcome this gate
     exists to prevent: eleven demonstration patients rendered in a live build
     with the fixture notice already retired. */
  /* A DISABLED query is not a held one: `useApiQuery` answers one with success
     and a null payload, and `AsyncBoundary` reads a null payload as a failure.
     Gating alone therefore puts "This did not load" and an inert Try again over
     a screen whose prerequisite is merely still in the air, which is what a
     review of this branch rendered. The status is the assertion. */
  it('reports the name request as its own state while that request is in flight', async () => {
    const { useInbox } = await load('live');
    capabilities = pending();

    const { result } = renderHook(() => useInbox());

    await waitFor(() => expect(listTasks).not.toHaveBeenCalled());
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('surfaces a failure to name the caller as a failure this screen can retry', async () => {
    const { useInbox } = await load('live');
    const refetch = vi.fn();
    capabilities = unnamed(refetch);

    const { result } = renderHook(() => useInbox());

    expect(result.current.status).toBe('error');
    /* The retry has to re-run the request that FAILED. Wired to the inbox's own
       refetch it would re-run a query that is disabled, which is a button that
       does nothing - the defect one layer down from the one above. */
    result.current.refetch();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('reads the route as soon as the name arrives, filtered to that caller', async () => {
    const { useInbox } = await load('live');
    capabilities = pending();
    listTasks.mockResolvedValue({
      data: [],
      page: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });

    /* The name arrives BETWEEN renders, which is the only sequence production
       ever runs: `/bff/v0/me` is a request of its own. A hook that held the
       query and then did not notice the answer would pass every static arm
       above and leave a clinician looking at an empty inbox for the session. */
    const { rerender } = renderHook(() => useInbox());
    expect(listTasks).not.toHaveBeenCalled();

    capabilities = resolved(ME);
    rerender();

    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(1));
    expect(listTasks).toHaveBeenCalledWith(expect.objectContaining({ inboxFor: ME }));
  });

  /* A principal with no `User` id is not a member of staff, and this screen is
     not theirs. It stays empty rather than falling back to the fixture rows,
     which in live mode would be demonstration patients with no notice above
     them. */
  it('answers a principal the API cannot name with an empty inbox, not a failure', async () => {
    const { useInbox } = await load('live');
    capabilities = resolved(null);

    const { result } = renderHook(() => useInbox());

    /* A patient or a service principal is not a broken staff session: this
       screen holds no work for them, which is an empty state and not a red
       one. A page, so the rail's counts read zero rather than nothing. */
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual({
      data: [],
      page: { page: 1, pageSize: 0, total: 0, totalPages: 0 },
      refused: 0,
    });
    expect(listTasks).not.toHaveBeenCalled();
  });

  /* An injected client is the screen tests' way to reach an empty or a failing
     state, and it answers whatever it was built to answer. Gating it on a name
     it never uses would disable those renders in a live build and leave the
     assertion looking at an empty state it did not ask for. */
  it('uses an injected client even with no name, because it needs none', async () => {
    const { useInbox } = await load('live');
    capabilities = pending();
    const client = {
      inbox: {
        list: vi.fn().mockResolvedValue({
          data: [],
          page: { page: 1, pageSize: 0, total: 0, totalPages: 0 },
          refused: 0,
        }),
      },
    } as unknown as WorklistClient;

    renderHook(() => useInbox({}, { client }));

    await waitFor(() => expect(client.inbox.list).toHaveBeenCalledTimes(1));
  });

  it('wires the live inbox only for a named caller', async () => {
    const { worklist, worklistFor } = await load('live');

    expect(worklistFor(null).inbox).toBe(worklist.inbox);
    expect(worklistFor(ME).inbox).not.toBe(worklist.inbox);
  });
});

describe('the inbox in the demonstration build', () => {
  it('answers from fixtures whether or not the caller has a name', async () => {
    const { useInbox } = await load('mock');
    capabilities = pending();

    const { result } = renderHook(() => useInbox());

    await waitFor(() => expect(result.current.status).toBe('success'));
    const page = (result.current as AsyncState<InboxPage>).data;
    expect(page?.data.length).toBeGreaterThan(0);
    expect(listTasks).not.toHaveBeenCalled();
  });

  /* The name is not part of the question here, so it must not be part of the
     request identity either: this client answers the same inbox before and
     after `/bff/v0/me` comes back, and a key that moved when the name landed
     would refetch the page whose chip counts are being read while it settles. */
  it('uses an injected client and does not re-ask when the name lands', async () => {
    const { useInbox } = await load('mock');
    capabilities = pending();
    const empty: InboxPage = {
      data: [],
      page: { page: 1, pageSize: 0, total: 0, totalPages: 0 },
      refused: 0,
    };
    const client = {
      inbox: { list: vi.fn().mockResolvedValue(empty) },
    } as unknown as WorklistClient;

    const { rerender } = renderHook(() => useInbox({}, { client }));
    await waitFor(() => expect(client.inbox.list).toHaveBeenCalledTimes(1));

    capabilities = resolved(ME);
    rerender();

    await waitFor(() => expect(client.inbox.list).toHaveBeenCalledTimes(1));
  });
});

/**
 * What the SCREEN does with the three answers pinned above.
 *
 * The hook arms assert `status` and `data`, which is the right thing to assert
 * about a hook and is not enough: a hook that correctly reports "still waiting"
 * and a boundary that renders waiting as a red failure both pass every one of
 * them. `AsyncBoundary` sends `data === null` to `ErrorState` before it reaches
 * `isEmpty`, so the distance between the two layers is exactly where this went
 * wrong, and these arms are rendered rather than reasoned about.
 */
async function renderInbox(): Promise<void> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_MODE', 'live');
  const { InboxScreen } = await import('@/app/(app)/inbox/InboxScreen');
  render(<InboxScreen />);
}

describe('the live inbox screen before it knows who is asking', () => {
  it('waits while the name is in flight rather than reporting a failure', async () => {
    capabilities = pending();

    await renderInbox();

    expect(await screen.findByRole('status')).toHaveTextContent(/Loading/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries the request that actually failed when the name cannot be read', async () => {
    const refetch = vi.fn();
    capabilities = unnamed(refetch);

    await renderInbox();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    /* The button is the whole finding. Wired to the inbox query's own refetch
       it bumps an attempt on a DISABLED query and returns, so the reader
       presses it, nothing moves, and they stop pressing it. */
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('is empty, not broken, for a principal the API cannot name', async () => {
    capabilities = resolved(null);

    await renderInbox();

    expect(await screen.findByText('Inbox zero, for now')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listTasks).not.toHaveBeenCalled();
  });
});

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

async function load(mode: string): Promise<typeof import('@/lib/api/worklist')> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_MODE', mode);
  return import('@/lib/api/worklist');
}

function resolved(userId: string | null): AsyncState<{ userId: string | null }> {
  return { status: 'success', data: { userId }, error: null } as AsyncState<{
    userId: string | null;
  }>;
}

function pending(): AsyncState<{ userId: string | null }> {
  return { status: 'loading', data: null, error: null } as AsyncState<{ userId: string | null }>;
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
  it('shows no rows at all until it knows who the caller is', async () => {
    const { useInbox } = await load('live');
    capabilities = pending();

    const { result } = renderHook(() => useInbox());

    /* Settled, not merely not-failed: a query that IS running is `loading`
       with no data, and asserting during that window would pass on the
       fixture fallback a moment before its rows arrive. */
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toBeNull();
    expect(listTasks).not.toHaveBeenCalled();
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
  it('holds for a principal the API cannot name', async () => {
    const { useInbox } = await load('live');
    capabilities = resolved(null);

    const { result } = renderHook(() => useInbox());

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toBeNull();
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

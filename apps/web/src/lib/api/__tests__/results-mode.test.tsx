import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';
import type { AsyncState } from '@/lib/api/hooks';
import type { ResultPage, WorklistClient } from '@/lib/api/worklist';

/**
 * What the sign-off queue does before it knows who is asking.
 *
 * The same seam as the inbox's, asked of a screen that only SOMETIMES needs the
 * name. An unfiltered queue is everyone's results and was always answerable;
 * the ME/TEAM filter is a `Task` question and cannot be asked without a user id
 * (#535). So the gate here is conditional, and a gate that held both would make
 * every results page wait on a request it does not need, while a gate that held
 * neither would answer a ME filter with the whole practice's results.
 *
 * `NEXT_PUBLIC_API_MODE` is read once at module load, so the live branch is
 * unreachable from an ordinary import: the module is re-imported per case with
 * the environment set.
 */

const ME = 'user-me';

/** The capabilities answer this render is standing in for. */
let capabilities: AsyncState<{ userId: string | null }>;

vi.mock('@/lib/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/hooks')>();
  return { ...actual, useOwnCapabilities: () => capabilities };
});

const listResults = vi.fn();
const listTasks = vi.fn();
vi.mock('@/lib/api/api', () => ({
  api: { results: { list: listResults }, tasks: { list: listTasks } },
}));

async function load(mode: string): Promise<typeof import('@/lib/api/worklist')> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_MODE', mode);
  return import('@/lib/api/worklist');
}

/* `refetch` is part of the shape rather than cast away, because one arm below
   asserts the queue hands the caller the NAME request's own retry. A fixture
   missing it would make that assertion pass against undefined. */
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

function emptyPage(pageSize: number): { data: never[]; page: Record<string, number> } {
  return { data: [], page: { page: 1, pageSize, total: 0, totalPages: 0 } };
}

afterEach(() => {
  vi.unstubAllEnvs();
  listResults.mockReset();
  listTasks.mockReset();
});

describe('the sign-off queue in live mode', () => {
  /* The arm that separates a conditional gate from the inbox's unconditional
     one. Everyone's results need no name, so holding them on `/bff/v0/me` would
     put a skeleton over a queue that could already have been read - and every
     other arm in this file passes over a hook that does exactly that. */
  it('reads the route without waiting for a name when assignment is not filtered', async () => {
    const { useResults } = await load('live');
    capabilities = pending();
    listResults.mockResolvedValue(emptyPage(25));

    renderHook(() => useResults());

    await waitFor(() => expect(listResults).toHaveBeenCalledTimes(1));
    expect(listTasks).not.toHaveBeenCalled();
  });

  /* A DISABLED query is not a held one: `useApiQuery` answers one with success
     and a null payload, and `AsyncBoundary` reads a null payload as a failure.
     Gating alone would put "This did not load" and an inert Try again over a
     queue whose prerequisite is merely still in the air. */
  it('reports the name request as its own state while a filtered queue waits', async () => {
    const { useResults } = await load('live');
    capabilities = pending();

    const { result } = renderHook(() => useResults({ assignedTo: 'ME' }));

    await waitFor(() => expect(listTasks).not.toHaveBeenCalled());
    expect(listResults).not.toHaveBeenCalled();
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('surfaces a failure to name the caller as a failure this screen can retry', async () => {
    const { useResults } = await load('live');
    const refetch = vi.fn();
    capabilities = unnamed(refetch);

    const { result } = renderHook(() => useResults({ assignedTo: 'ME' }));

    expect(result.current.status).toBe('error');
    /* The retry has to re-run the request that FAILED. Wired to this hook's own
       refetch it would re-run a query that is disabled, which is a button that
       does nothing. */
    result.current.refetch();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('asks the task collection and then the narrowed report read once named', async () => {
    const { useResults } = await load('live');
    capabilities = pending();
    listTasks.mockResolvedValue({
      data: [
        {
          id: 'task-1',
          type: 'RESULT',
          subjectType: 'DiagnosticReport',
          subjectId: 'report-7',
          assigneeType: 'USER',
          assigneeUserId: ME,
        },
      ],
      page: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    listResults.mockResolvedValue(emptyPage(100));

    /* The name arrives BETWEEN renders, which is the only sequence production
       runs: `/bff/v0/me` is a request of its own. A hook that held the query
       and then did not notice the answer would pass every static arm above and
       leave a clinician looking at an empty queue for the session. */
    const { rerender } = renderHook(() => useResults({ assignedTo: 'ME' }));
    expect(listTasks).not.toHaveBeenCalled();

    capabilities = resolved(ME);
    rerender();

    await waitFor(() => expect(listResults).toHaveBeenCalledTimes(1));
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RESULT', inboxFor: ME, assigneeType: 'USER' })
    );
    expect(listResults).toHaveBeenCalledWith(expect.objectContaining({ ids: ['report-7'] }));
  });

  /* A principal with no `User` id is not a member of staff. An empty queue is
     the honest answer; everyone's results under a control that says Mine is the
     one this gate exists to prevent. */
  it('answers a caller the API cannot name with an empty queue, not a failure', async () => {
    const { useResults } = await load('live');
    capabilities = resolved(null);

    const { result } = renderHook(() => useResults({ assignedTo: 'ME', pageSize: 40 }));

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect((result.current as AsyncState<ResultPage>).data).toEqual({
      data: [],
      page: { page: 1, pageSize: 40, total: 0, totalPages: 0 },
      refused: 0,
    });
    expect(listTasks).not.toHaveBeenCalled();
    expect(listResults).not.toHaveBeenCalled();
  });

  /* An injected client is the screen tests' way to reach an empty or a failing
     state, and it answers whatever it was built to answer. Gating it on a name
     it never uses would disable those renders in a live build. */
  it('uses an injected client even with no name, because it needs none', async () => {
    const { useResults } = await load('live');
    capabilities = pending();
    const client = {
      results: { list: vi.fn().mockResolvedValue({ ...emptyPage(0), refused: 0 }) },
    } as unknown as WorklistClient;

    renderHook(() => useResults({ assignedTo: 'ME' }, { client }));

    await waitFor(() => expect(client.results.list).toHaveBeenCalledTimes(1));
  });

  it('wires the assignment-answering results client only for a named caller', async () => {
    const { worklist, worklistFor } = await load('live');

    expect(worklistFor(null).results).toBe(worklist.results);
    expect(worklistFor(ME).results).not.toBe(worklist.results);
  });
});

describe('the sign-off queue in the demonstration build', () => {
  it('answers a filtered queue from fixtures whether or not the caller has a name', async () => {
    const { useResults } = await load('mock');
    capabilities = pending();

    const { result } = renderHook(() => useResults({ assignedTo: 'ME' }));

    await waitFor(() => expect(result.current.status).toBe('success'));
    const page = (result.current as AsyncState<ResultPage>).data;
    expect(page?.data.length).toBeGreaterThan(0);
    expect(listTasks).not.toHaveBeenCalled();
    expect(listResults).not.toHaveBeenCalled();
  });
});

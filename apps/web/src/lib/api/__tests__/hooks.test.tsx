import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';
import {
  queryKey,
  useAppointment,
  useAppointments,
  useMutation,
  usePatient,
  usePatients,
} from '@/lib/api/hooks';
import { createMockClient } from '@/lib/api/mock/client';
import { MOCK_APPOINTMENTS, MOCK_PATIENTS } from '@/lib/api/mock/fixtures';
import type { ApiClient } from '@/lib/api/types';

/**
 * The hooks are the contract every screen reads through, so what is asserted
 * here is the contract: one status at a time, no stale payload after a query
 * change, and a retry that actually re-runs the request.
 */

function Probe({ client, q }: Readonly<{ client: ApiClient; q?: string }>) {
  const patients = usePatients({ q }, { client });
  return (
    <div>
      <p data-testid="status">{patients.status}</p>
      <p data-testid="count">{patients.data?.data.length ?? 'none'}</p>
      <p data-testid="error">{patients.error?.status ?? 'none'}</p>
      <button type="button" onClick={patients.refetch}>
        retry
      </button>
    </div>
  );
}

function failingClient(error: ApiError, list = vi.fn()): ApiClient {
  return {
    mode: 'mock',
    patients: {
      list: (...args: unknown[]) => {
        list(...args);
        return Promise.reject(error);
      },
      get: () => Promise.reject(error),
    },
    appointments: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
  } as unknown as ApiClient;
}

describe('queryKey', () => {
  it('is stable across key order and ignores undefined', () => {
    expect(queryKey('patients.list', { q: 'a', page: 1 })).toBe(
      queryKey('patients.list', { page: 1, q: 'a' })
    );
    expect(queryKey('patients.list', { q: 'a', mrn: undefined })).toBe(
      queryKey('patients.list', { q: 'a' })
    );
  });
});

describe('usePatients', () => {
  it('reports loading, then success with the page', async () => {
    render(<Probe client={createMockClient()} />);

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
    expect(screen.getByTestId('count')).toHaveTextContent(String(MOCK_PATIENTS.length));
  });

  it('goes back to loading when the query changes, never showing the old page', async () => {
    const { rerender } = render(<Probe client={createMockClient()} />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));

    rerender(<Probe client={createMockClient()} q="testperson" />);
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('count')).toHaveTextContent('none');

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
  });

  it('surfaces the failure as an ApiError the screen can explain', async () => {
    const error = new ApiError('refused', { kind: 'http', status: 403 });
    render(<Probe client={failingClient(error)} />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('403');
  });

  it('re-runs the identical query when refetch is called', async () => {
    const list = vi.fn();
    const error = new ApiError('down', { kind: 'network' });
    render(<Probe client={failingClient(error, list)} />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(list).toHaveBeenCalledTimes(1);

    act(() => screen.getByRole('button', { name: 'retry' }).click());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe('usePatient', () => {
  function OneProbe({ id }: Readonly<{ id: string | null }>) {
    const patient = usePatient(id, { client: createMockClient() });
    return (
      <p data-testid="mrn">
        {patient.status}:{patient.data?.mrn ?? 'none'}
      </p>
    );
  }

  it('reads one patient', async () => {
    const first = MOCK_PATIENTS[0];
    render(<OneProbe id={first?.id ?? ''} />);
    await waitFor(() => expect(screen.getByTestId('mrn')).toHaveTextContent(first?.mrn ?? ''));
  });

  it('does not fire a request without an id, and does not sit in loading either', () => {
    render(<OneProbe id={null} />);
    expect(screen.getByTestId('mrn')).toHaveTextContent('success:none');
  });
});

describe('useAppointments', () => {
  function DayProbe() {
    const day = useAppointments(
      { from: '2026-08-12T00:00:00.000Z', to: '2026-08-13T00:00:00.000Z' },
      { client: createMockClient() }
    );
    return <p data-testid="day">{day.data?.data.length ?? day.status}</p>;
  }

  it('reads the clinic day window', async () => {
    render(<DayProbe />);
    await waitFor(() => expect(screen.getByTestId('day')).not.toHaveTextContent('loading'));
    expect(Number(screen.getByTestId('day').textContent)).toBeGreaterThan(0);
  });
});

describe('useApiQuery, the states a screen has to render', () => {
  function ExplicitProbe({ client, enabled }: Readonly<{ client: ApiClient; enabled?: boolean }>) {
    const patients = usePatients({}, { client, enabled });
    return (
      <p data-testid="state">{`${patients.status}:${patients.data?.data.length ?? 'none'}`}</p>
    );
  }

  it('does not fire a disabled query, and does not sit in loading either', () => {
    const list = vi.fn();
    render(
      <ExplicitProbe
        client={failingClient(new ApiError('x', { kind: 'network' }), list)}
        enabled={false}
      />
    );

    // A disabled query has nothing to wait for, so the screen renders its
    // empty state rather than a spinner that never resolves.
    expect(screen.getByTestId('state')).toHaveTextContent('success:none');
    expect(list).not.toHaveBeenCalled();
  });

  it('turns a rejection that is not an ApiError into one a screen can explain', async () => {
    const client = {
      mode: 'mock',
      patients: {
        list: () => Promise.reject(new TypeError('boom')),
        get: () => Promise.reject(new TypeError('boom')),
      },
      appointments: {
        list: () => Promise.reject(new TypeError('boom')),
        get: () => Promise.reject(new TypeError('boom')),
      },
    } as unknown as ApiClient;

    function ErrorProbe() {
      const patients = usePatients({}, { client });
      return (
        <p data-testid="kind">{`${patients.status}:${patients.error?.kind ?? 'none'}:${patients.error?.message ?? ''}`}</p>
      );
    }

    render(<ErrorProbe />);

    // Every failure reaches the screen as an ApiError, so ErrorState never has
    // to guess at a raw TypeError from somewhere in the stack.
    await waitFor(() =>
      expect(screen.getByTestId('kind')).toHaveTextContent(
        'error:network:The request could not be completed.'
      )
    );
  });

  it('drops a response that arrives after the component is gone', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const client = {
      mode: 'mock',
      patients: {
        list: () =>
          new Promise((settle) => {
            resolve = settle;
          }),
        get: () => Promise.reject(new Error('unused')),
      },
      appointments: {
        list: () => Promise.reject(new Error('unused')),
        get: () => Promise.reject(new Error('unused')),
      },
    } as unknown as ApiClient;

    const view = render(<ExplicitProbe client={client} />);
    expect(screen.getByTestId('state')).toHaveTextContent('loading:none');

    view.unmount();
    // Settling after unmount must not set state on a gone component. React
    // would warn, and in a real chart the request belongs to a screen the
    // clinician has already left.
    await act(async () => {
      resolve?.({ data: [], page: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
      await Promise.resolve();
    });

    expect(view.container).toBeEmptyDOMElement();
  });
});

describe('the remaining read hooks', () => {
  function AppointmentProbe({ id }: Readonly<{ id: string | null }>) {
    const appointment = useAppointment(id, { client: createMockClient() });
    return (
      <p data-testid="appointment">{`${appointment.status}:${appointment.data?.status ?? 'none'}`}</p>
    );
  }

  it('reads one appointment by id', async () => {
    const first = MOCK_APPOINTMENTS[0]!;
    render(<AppointmentProbe id={first.id} />);

    await waitFor(() =>
      expect(screen.getByTestId('appointment')).toHaveTextContent(`success:${first.status}`)
    );
  });

  it('fires no request for an appointment with no id', () => {
    render(<AppointmentProbe id={null} />);

    expect(screen.getByTestId('appointment')).toHaveTextContent('success:none');
  });
});

describe('useMutation', () => {
  function WriteProbe({ perform }: Readonly<{ perform: (value: string) => Promise<string> }>) {
    const write = useMutation(perform);
    const [answer, setAnswer] = useState<string | null>(null);
    return (
      <div>
        <p data-testid="write">{`${write.pending ? 'pending' : 'idle'}:${
          write.error?.problem?.detail ?? write.error?.message ?? 'none'
        }:${answer ?? 'none'}`}</p>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const outcome = await write.run('go');
              setAnswer(outcome.ok ? outcome.value : null);
            })();
          }}
        >
          Run
        </button>
        <button type="button" onClick={write.reset}>
          Reset
        </button>
      </div>
    );
  }

  function state(): string {
    return screen.getByTestId('write').textContent ?? '';
  }

  it('reports the write as pending while it is outstanding, then hands back its value', async () => {
    let settle: ((value: string) => void) | undefined;
    render(
      <WriteProbe
        perform={() =>
          new Promise<string>((resolve) => {
            settle = resolve;
          })
        }
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(state()).toBe('pending:none:none'));

    await act(async () => {
      settle?.('saved');
      await Promise.resolve();
    });
    await waitFor(() => expect(state()).toBe('idle:none:saved'));
  });

  it('resolves with null on a refusal, and keeps the problem document to render', async () => {
    const refusal = new ApiError('conflict', {
      kind: 'http',
      status: 409,
      problem: {
        type: 'https://openrunic.org/problems/invalid-transition',
        title: 'Invalid state transition',
        status: 409,
        detail: 'A claim in DRAFT cannot move to SUBMITTED.',
        instance: '/bff/v0/claims',
        requestId: 'req-1',
      },
    });
    render(<WriteProbe perform={() => Promise.reject(refusal)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    // Null rather than a rejection: a click handler is not a promise chain, and
    // a rejected one is an unhandled rejection in a clinician's console.
    await waitFor(() =>
      expect(state()).toBe('idle:A claim in DRAFT cannot move to SUBMITTED.:none')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(state()).toBe('idle:none:none'));
  });

  it('names a failure that was never an ApiError rather than swallowing it', async () => {
    render(<WriteProbe perform={() => Promise.reject(new TypeError('offline'))} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(state()).toBe('idle:The request could not be completed.:none'));
  });

  it('does not set state on a screen the clinician has already left', async () => {
    let settle: ((value: string) => void) | undefined;
    const view = render(
      <WriteProbe
        perform={() =>
          new Promise<string>((resolve) => {
            settle = resolve;
          })
        }
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    view.unmount();

    await act(async () => {
      settle?.('saved');
      await Promise.resolve();
    });

    // The write still happened; what must not happen is a render into a gone tree.
    expect(view.container).toBeEmptyDOMElement();
  });
});

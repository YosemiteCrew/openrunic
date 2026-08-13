import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/client';
import { queryKey, useAppointments, usePatient, usePatients } from '@/lib/api/hooks';
import { createMockClient } from '@/lib/api/mock/client';
import { MOCK_PATIENTS } from '@/lib/api/mock/fixtures';
import type { ApiClient } from '@/lib/api/types';

/**
 * The hooks are the contract every screen reads through, so what is asserted
 * here is the contract: one status at a time, no stale payload after a query
 * change, and a retry that actually re-runs the request.
 */

function Probe({ client, q }: { client: ApiClient; q?: string }) {
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

    rerender(<Probe client={createMockClient()} q="oyelaran" />);
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
  function OneProbe({ id }: { id: string | null }) {
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

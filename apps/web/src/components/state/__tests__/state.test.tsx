import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AsyncBoundary } from '@/components/state/AsyncBoundary';
import { isEmptyList } from '@/components/state/empty';
import { ErrorState } from '@/components/state/ErrorState';
import { explain } from '@/components/state/explain';
import { LoadingState } from '@/components/state/LoadingState';
import { ApiError } from '@/lib/api/client';
import type { AsyncState } from '@/lib/api/hooks';

function state<T>(partial: Partial<AsyncState<T>> & Pick<AsyncState<T>, 'status'>): AsyncState<T> {
  return { data: null, error: null, refetch: vi.fn(), ...partial };
}

function problemError(status: number, requestId = 'req-7'): ApiError {
  return new ApiError('refused', {
    kind: 'http',
    status,
    problem: {
      type: 'https://openrunic.org/problems/forbidden',
      title: 'Forbidden',
      status,
      detail: 'The role lacks the permission.',
      instance: '/bff/v0/patients',
      requestId,
    },
  });
}

describe('LoadingState', () => {
  it('announces what is loading politely', () => {
    render(<LoadingState label="Patients" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading patients');
  });

  it('draws skeleton rows rather than a spinner over empty space', () => {
    const { container } = render(<LoadingState label="Patients" rows={4} />);
    expect(container.querySelectorAll('.or-loading__row')).toHaveLength(4);
    expect(container.querySelector('.or-loading__skeleton')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('explain', () => {
  /* The real catalogue in the source language. `explain` is a plain function
     rather than a component, so it takes the translator instead of reaching for
     the hook, and building it from the shipped messages is what keeps these
     assertions pinned to the sentences a reader actually sees. */
  const t = createTranslator(appCatalogue, 'en');

  it('separates a partner outage from our own failure', () => {
    const network = explain(t, 'the schedule', new ApiError('down', { kind: 'network' }));
    expect(network.title).toBe('No connection to the server');
    expect(network.retryable).toBe(true);
  });

  it('does not offer a retry for a permission failure', () => {
    expect(explain(t, 'billing', problemError(403)).retryable).toBe(false);
  });

  it('names an unbuilt aggregate honestly', () => {
    expect(explain(t, 'orders', problemError(501)).title).toBe('Not built yet');
  });

  it('always says what to do next', () => {
    for (const status of [401, 403, 404, 500, 501]) {
      expect(explain(t, 'this', problemError(status)).message.length).toBeGreaterThan(0);
    }
  });

  it('names the subject inside the sentence rather than bolting it on the end', () => {
    // The placeholder is the whole reason these are single messages: a language
    // that puts the subject first has to be able to.
    expect(explain(t, 'the visits report', problemError(500)).message).toContain(
      'the visits report'
    );
  });
});

describe('ErrorState', () => {
  it('interrupts, states the fact and shows the request id', () => {
    render(<ErrorState subject="today's schedule" error={problemError(500, 'req-99')} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('req-99')).toBeInTheDocument();
  });

  it('offers a retry only when retrying could help', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ErrorState subject="the schedule" error={problemError(500)} onRetry={onRetry} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ErrorState subject="billing" error={problemError(403)} onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('AsyncBoundary', () => {
  const empty = { title: 'No patients match', message: 'Widen the search and try again.' };

  it('renders the loading state while the request is in flight', () => {
    render(
      <AsyncBoundary
        state={state<{ data: string[] }>({ status: 'loading' })}
        subject="patients"
        empty={empty}
      >
        {() => <p>rows</p>}
      </AsyncBoundary>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading patients');
  });

  it('renders the error state, with refetch wired to the retry', () => {
    const refetch = vi.fn();
    render(
      <AsyncBoundary
        state={state<{ data: string[] }>({
          status: 'error',
          error: new ApiError('down', { kind: 'network' }),
          refetch,
        })}
        subject="patients"
        empty={empty}
      >
        {() => <p>rows</p>}
      </AsyncBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state rather than a blank region', () => {
    render(
      <AsyncBoundary
        state={state({ status: 'success', data: { data: [] as string[] } })}
        subject="patients"
        empty={empty}
        isEmpty={isEmptyList}
      >
        {() => <p>rows</p>}
      </AsyncBoundary>
    );

    expect(screen.getByRole('heading', { name: 'No patients match' })).toBeInTheDocument();
    expect(screen.getByText('Widen the search and try again.')).toBeInTheDocument();
  });

  it('renders the data when there is data', () => {
    render(
      <AsyncBoundary
        state={state({ status: 'success', data: { data: ['a'] } })}
        subject="patients"
        empty={empty}
        isEmpty={isEmptyList}
      >
        {(payload) => <p>{payload.data.length} rows</p>}
      </AsyncBoundary>
    );

    expect(screen.getByText('1 rows')).toBeInTheDocument();
  });
});

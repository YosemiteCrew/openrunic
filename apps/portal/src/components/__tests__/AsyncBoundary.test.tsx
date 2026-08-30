import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import type { AsyncBoundaryProps } from '@/components/AsyncBoundary';
import type { AsyncState } from '@/lib/useAsync';

/**
 * The two keys are the appointments screen's, because the assertions below read
 * the words a patient sees rather than the key that produced them. A key that
 * named nothing would render the key itself, and every assertion here would
 * fail on that.
 */
function renderBoundary(
  state: AsyncState<string[]>,
  extra: Partial<AsyncBoundaryProps<string[]>> = {}
) {
  return render(
    <AsyncBoundary
      state={state}
      loadingKey="portal.appointments.async.loading"
      errorKey="portal.appointments.async.error"
      {...extra}
    >
      {(data: string[]) => <p>{data.join(', ')}</p>}
    </AsyncBoundary>
  );
}

describe('AsyncBoundary', () => {
  it('states what is loading, in a polite live region', () => {
    renderBoundary({ status: 'loading' });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading your appointments.');
  });

  it('states the fact then the next action when the read fails', () => {
    renderBoundary({ status: 'error', error: new Error('offline') });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your appointments did not load.');
    expect(alert).toHaveTextContent('Check your connection, then try again.');
  });

  it('never says "we" and never raises its voice', () => {
    renderBoundary({ status: 'error', error: new Error('offline') });

    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toMatch(/\bwe\b/i);
    expect(text).not.toContain('!');
  });

  it('offers a retry only when retrying could help', async () => {
    const onRetry = vi.fn();
    const { unmount } = renderBoundary(
      { status: 'error', error: new Error('offline') },
      { onRetry }
    );

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();

    unmount();
    renderBoundary({ status: 'error', error: new Error('offline') });
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('renders the data when the read succeeds', () => {
    renderBoundary({ status: 'ready', data: ['first', 'second'] });

    expect(screen.getByText('first, second')).toBeInTheDocument();
  });

  it('renders the empty node when the caller says the data is empty', () => {
    renderBoundary(
      { status: 'ready', data: [] },
      { isEmpty: (data) => data.length === 0, empty: <p>Nothing here.</p> }
    );

    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('renders the data when the caller says it is not empty', () => {
    renderBoundary(
      { status: 'ready', data: ['first'] },
      { isEmpty: (data) => data.length === 0, empty: <p>Nothing here.</p> }
    );

    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here.')).not.toBeInTheDocument();
  });

  it('states the whole sentence rather than one it assembled', () => {
    /*
     * The failure this replaces: every screen passed a noun phrase such as
     * "your appointments", which this component dropped into "Loading ..." and
     * capitalised for the error title. Both are English rules, and neither
     * survives a language that puts the verb elsewhere or starts a sentence
     * differently. Nothing here builds a sentence, so there is no frame left to
     * assert on - only that the two messages arrive whole.
     */
    const { unmount } = renderBoundary({ status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading your appointments.');
    unmount();

    renderBoundary(
      { status: 'error', error: new Error('offline') },
      { errorKey: 'portal.bills.async.error' }
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Your statements did not load.');
  });
});

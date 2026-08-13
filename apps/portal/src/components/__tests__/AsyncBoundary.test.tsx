import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import type { AsyncState } from '@/lib/useAsync';

function renderBoundary(state: AsyncState<string[]>, extra: Record<string, unknown> = {}) {
  return render(
    <AsyncBoundary state={state} what="your appointments" {...extra}>
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
      { isEmpty: (data: string[]) => data.length === 0, empty: <p>Nothing here.</p> }
    );

    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('renders the data when the caller says it is not empty', () => {
    renderBoundary(
      { status: 'ready', data: ['first'] },
      { isEmpty: (data: string[]) => data.length === 0, empty: <p>Nothing here.</p> }
    );

    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here.')).not.toBeInTheDocument();
  });
});

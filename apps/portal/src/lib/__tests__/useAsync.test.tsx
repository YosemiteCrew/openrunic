import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toError, useAction, useAsync } from '@/lib/useAsync';

function Reader({ load }: { load: () => Promise<string> }) {
  const { state, reload } = useAsync(load);
  return (
    <div>
      <p data-testid="status">{state.status}</p>
      {state.status === 'ready' ? <p data-testid="data">{state.data}</p> : null}
      {state.status === 'error' ? <p data-testid="error">{state.error.message}</p> : null}
      <button onClick={reload} type="button">
        Reload
      </button>
    </div>
  );
}

function Writer({ perform }: { perform: (word: string) => Promise<string> }) {
  const action = useAction(perform);
  return (
    <div>
      <p data-testid="status">{action.status}</p>
      <p data-testid="value">{action.value ?? 'none'}</p>
      <p data-testid="error">{action.error?.message ?? 'none'}</p>
      <button onClick={() => void action.run('hello')} type="button">
        Run
      </button>
      <button onClick={action.reset} type="button">
        Reset
      </button>
    </div>
  );
}

describe('toError', () => {
  it('passes an Error through untouched', () => {
    const original = new Error('already an error');
    expect(toError(original)).toBe(original);
  });

  it('wraps anything else, so a thrown string still has a message', () => {
    expect(toError('a bare string').message).toBe('a bare string');
    expect(toError(undefined).message).toBe('undefined');
  });
});

describe('useAsync', () => {
  it('starts loading and settles on the data', async () => {
    render(<Reader load={() => Promise.resolve('the record')} />);

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(await screen.findByTestId('data')).toHaveTextContent('the record');
  });

  it('settles on an error when the read fails', async () => {
    render(<Reader load={() => Promise.reject(new Error('offline'))} />);

    expect(await screen.findByTestId('error')).toHaveTextContent('offline');
  });

  it('goes back through loading on reload and picks up the new answer', async () => {
    let attempt = 0;
    const load = () => Promise.resolve(`answer ${(attempt += 1)}`);

    render(<Reader load={load} />);
    expect(await screen.findByTestId('data')).toHaveTextContent('answer 1');

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(await screen.findByTestId('data')).toHaveTextContent('answer 2');
  });

  it('drops a result that arrives after unmount rather than setting state on nothing', async () => {
    let settle: (value: string) => void = () => {};
    const load = () =>
      new Promise<string>((resolve) => {
        settle = resolve;
      });

    const view = render(<Reader load={load} />);
    view.unmount();

    // Resolving after unmount must be a no-op; React would warn if state were set.
    await act(async () => {
      settle('too late');
      await Promise.resolve();
    });

    expect(screen.queryByTestId('data')).not.toBeInTheDocument();
  });

  it('reads the latest loader without re-running on every render', async () => {
    const load = vi.fn(() => Promise.resolve('once'));
    const view = render(<Reader load={load} />);

    await screen.findByTestId('data');
    view.rerender(<Reader load={load} />);
    view.rerender(<Reader load={load} />);

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('useAction', () => {
  it('reports done and keeps the resolved value', async () => {
    render(<Writer perform={(word) => Promise.resolve(word.toUpperCase())} />);

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('done'));
    expect(screen.getByTestId('value')).toHaveTextContent('HELLO');
  });

  it('reports failed and carries the reason', async () => {
    render(<Writer perform={() => Promise.reject(new Error('send failed'))} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));
    expect(screen.getByTestId('error')).toHaveTextContent('send failed');
  });

  it('resets back to idle and clears the reason', async () => {
    render(<Writer perform={() => Promise.reject(new Error('send failed'))} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('reads the latest perform without re-creating run', async () => {
    const first = vi.fn(() => Promise.resolve('a'));
    const second = vi.fn(() => Promise.resolve('b'));

    const view = render(<Writer perform={first} />);
    view.rerender(<Writer perform={second} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('b'));
    expect(first).not.toHaveBeenCalled();
  });
});

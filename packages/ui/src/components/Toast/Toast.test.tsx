import { afterAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from './Toast';

describe('Toast', () => {
  it('states the fact politely by default', () => {
    render(<Toast title="Record shared" message="Dr. Okafor can now view your 2026 labs." />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('or-toast', 'or-toast--info');
    expect(toast).toHaveTextContent('Record shared');
    expect(toast).toHaveTextContent('Dr. Okafor can now view your 2026 labs.');
  });

  it.each([
    ['info', 'or-toast--info', 'status', 'Information'],
    ['success', 'or-toast--success', 'status', 'Success'],
    ['danger', 'or-toast--danger', 'alert', 'Error'],
  ] as const)('renders the %s tone', (tone, expectedClass, role, spokenTone) => {
    render(<Toast tone={tone} title="Record shared" />);
    const toast = screen.getByRole(role);
    expect(toast).toHaveClass(expectedClass);
    // Tone is never colour alone: the word is in the DOM for a screen reader.
    expect(toast).toHaveTextContent(spokenTone);
  });

  it('interrupts with role alert only for danger', () => {
    render(<Toast tone="danger" title="Upload failed" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('hides the tone icon from assistive technology', () => {
    const { container } = render(<Toast tone="success" title="Record shared" />);
    const icon = container.querySelector('.or-toast__icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('omits the title and the message when they are not given', () => {
    const { container } = render(<Toast tone="info" />);
    expect(container.querySelector('.or-toast__title')).toBeNull();
    expect(container.querySelector('.or-toast__message')).toBeNull();
  });

  it('renders an inline action inside the body', () => {
    render(
      <Toast
        tone="danger"
        title="Grant revoked"
        message="Dr. Okafor no longer has access."
        action={<button type="button">Undo</button>}
      />
    );
    const action = screen.getByRole('button', { name: 'Undo' });
    expect(action.closest('.or-toast__body')).toBeInTheDocument();
  });

  it('dismisses on click and on Enter', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Toast title="Record shared" onClose={onClose} />);

    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveAttribute('type', 'button');

    // Tab first, from a page whose only tabbable control is the dismiss button.
    await user.tab();
    expect(dismiss).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(dismiss);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('has no dismiss control without onClose', () => {
    render(<Toast title="Export started" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('merges className and forwards native attributes', () => {
    render(
      <Toast className="or-app-toast" data-testid="share-toast" id="share-toast" title="Saved" />
    );
    const toast = screen.getByTestId('share-toast');
    expect(toast).toHaveClass('or-toast', 'or-toast--info', 'or-app-toast');
    expect(toast).toHaveAttribute('id', 'share-toast');
  });
});

describe('Toast without resolvable icons', () => {
  afterAll(() => {
    vi.doUnmock('../../lib/lucide');
    vi.resetModules();
  });

  it('still renders the message and the dismiss control', async () => {
    vi.resetModules();
    vi.doMock('../../lib/lucide', () => ({
      ICON_STROKE_WIDTH: 1.75,
      resolveLucideIcon: () => undefined,
    }));

    const { Toast: IconlessToast } = await import('./Toast');
    const { container } = render(
      <IconlessToast tone="success" title="Record shared" onClose={() => {}} />
    );

    expect(container.querySelector('.or-toast__icon')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Record shared');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('takes the dismiss label from the consumer', () => {
    // `aria-label="Dismiss"` was written into this component, so a Spanish
    // screen had an English close button on every notice it raised.
    render(<Toast message="x" onClose={() => {}} closeLabel="Descartar" />);

    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });

  /**
   * The tone word is the accessibility affordance, so it has to be sayable.
   *
   * `.or-toast__tone` is clipped to 1x1: a sighted reader never meets it and a
   * screen reader always does, announced inside whatever `lang` the page
   * carries. It was an English literal, so a Spanish page said an English word
   * in a Spanish voice - the one string on this component nobody could see was
   * wrong. See #312.
   */
  it.each(['info', 'success', 'danger'] as const)(
    'says the %s tone in the language it is given',
    (tone) => {
      const { container } = render(
        <Toast tone={tone} toneLabel="Precaución" title="Registro actualizado" />
      );
      expect(container.querySelector('.or-toast__tone')).toHaveTextContent('Precaución');
    }
  );

  it('keeps its English default when nothing supplies one', () => {
    const { container } = render(<Toast tone="danger" title="Something went wrong" />);
    expect(container.querySelector('.or-toast__tone')).toHaveTextContent('Error');
  });
});

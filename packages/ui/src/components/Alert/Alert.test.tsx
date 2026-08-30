import { afterAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alert } from './Alert';

describe('Alert', () => {
  it('states the fact in place and stays polite by default', () => {
    render(
      <Alert
        title="This record is not verified"
        message="Ridgeview Clinic sent it without a signature. Check the source before you rely on it."
      />
    );
    const alert = screen.getByRole('status');
    expect(alert).toHaveClass('or-alert', 'or-alert--info');
    expect(alert).toHaveTextContent('This record is not verified');
    expect(alert).toHaveTextContent('Ridgeview Clinic sent it without a signature.');
  });

  it.each([
    ['info', 'or-alert--info', 'status', 'Information'],
    ['caution', 'or-alert--caution', 'status', 'Caution'],
    ['danger', 'or-alert--danger', 'alert', 'Error'],
    ['success', 'or-alert--success', 'status', 'Success'],
  ] as const)('renders the %s tone', (tone, expectedClass, role, spokenTone) => {
    const { container } = render(<Alert tone={tone} title="Record updated" />);
    const alert = screen.getByRole(role);
    expect(alert).toHaveClass(expectedClass);
    // Tone is never colour alone: the word is in the DOM for a screen reader, and the
    // icon is a second signal on top of it.
    expect(alert).toHaveTextContent(spokenTone);
    expect(container.querySelector('.or-alert__icon')).toBeInTheDocument();
  });

  it('interrupts with role alert only for danger', () => {
    render(<Alert tone="danger" title="Blood glucose is above range" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('waits for the next pause on caution instead of interrupting', () => {
    render(<Alert tone="caution" title="This record came from an outside clinic" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides the tone icon from assistive technology', () => {
    const { container } = render(<Alert tone="success" title="Record verified" />);
    const icon = container.querySelector('.or-alert__icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the children after the message and keeps both', () => {
    render(
      <Alert
        tone="caution"
        title="This record came from an outside clinic"
        message="Check the source before you rely on it."
      >
        <p data-testid="alert-detail">Sent by Ridgeview Clinic on 12 Aug 2026.</p>
      </Alert>
    );
    const message = screen.getByText('Check the source before you rely on it.');
    const detail = screen.getByTestId('alert-detail');
    expect(message.closest('.or-alert__body')).toBe(detail.closest('.or-alert__body'));
    expect(message.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the title, the message and the children when they are not given', () => {
    const { container } = render(<Alert tone="info" />);
    expect(container.querySelector('.or-alert__title')).toBeNull();
    expect(container.querySelector('.or-alert__message')).toBeNull();
    expect(container.querySelector('.or-alert__body')).toBeEmptyDOMElement();
  });

  it('renders an inline action inside the body', () => {
    render(
      <Alert
        tone="danger"
        title="Blood glucose is above range"
        message="7.4 mmol/L, measured 12 Aug 2026."
        action={<button type="button">Open the reading</button>}
      />
    );
    const action = screen.getByRole('button', { name: 'Open the reading' });
    expect(action.closest('.or-alert__body')).toBeInTheDocument();
  });

  it('replaces the tone icon when an icon slug is given', () => {
    const { container, rerender } = render(<Alert tone="info" title="Vitals recorded" />);
    const toneIcon = container.querySelector('.or-alert__icon')?.innerHTML;

    rerender(<Alert tone="info" title="Vitals recorded" icon="heart-pulse" />);
    const overridden = container.querySelector('.or-alert__icon');
    expect(overridden).toHaveAttribute('aria-hidden', 'true');
    expect(overridden?.innerHTML).not.toBe(toneIcon);
  });

  it('renders the notice alone when the icon slug does not exist', () => {
    const { container } = render(
      <Alert tone="danger" title="Upload failed" icon="not-a-real-lucide-icon" />
    );
    expect(container.querySelector('.or-alert__icon')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed');
  });

  it('dismisses on click, on Enter and on Space', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Alert title="Export started" onClose={onClose} />);

    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveAttribute('type', 'button');

    // Tab first, from a page whose only tabbable control is the dismiss button.
    await user.tab();
    expect(dismiss).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('[Space]');
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(dismiss);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('has no dismiss control without onClose', () => {
    render(<Alert title="Export started" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('merges className and forwards native attributes', () => {
    render(
      <Alert
        tone="success"
        className="or-records-banner"
        data-testid="verified-banner"
        id="verified-banner"
        title="Record verified"
      />
    );
    const alert = screen.getByTestId('verified-banner');
    expect(alert).toHaveClass('or-alert', 'or-alert--success', 'or-records-banner');
    expect(alert).toHaveAttribute('id', 'verified-banner');
  });
});

describe('Alert without resolvable icons', () => {
  afterAll(() => {
    vi.doUnmock('../../lib/lucide');
    vi.resetModules();
  });

  it('still renders the body and the dismiss control', async () => {
    vi.resetModules();
    vi.doMock('../../lib/lucide', () => ({
      ICON_STROKE_WIDTH: 1.75,
      resolveLucideIcon: () => undefined,
    }));

    const { Alert: IconlessAlert } = await import('./Alert');
    const { container } = render(
      <IconlessAlert tone="caution" title="Verify the source" onClose={() => {}} />
    );

    expect(container.querySelector('.or-alert__icon')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Verify the source');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('takes the dismiss label from the consumer', () => {
    // `aria-label="Dismiss"` was written into this component, so a Spanish
    // screen had an English close button on every notice it raised.
    render(<Alert message="x" onClose={() => {}} closeLabel="Descartar" />);

    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });
});

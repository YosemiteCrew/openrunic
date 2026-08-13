import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

const TITLE = 'Revoke access for Dr. Amara Okafor?';
const DESCRIPTION =
  'She will lose access to your records immediately. You can grant it again later.';

function ConfirmActions() {
  return (
    <>
      <button type="button">Cancel</button>
      <button type="button">Revoke access</button>
    </>
  );
}

function RevokeFlow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Manage access
      </button>
      <Modal open={open} title={TITLE} description={DESCRIPTION} onClose={() => setOpen(false)} />
    </>
  );
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<Modal open={false} title={TITLE} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a named modal dialog described by its own copy', () => {
    render(
      <Modal title={TITLE} description={DESCRIPTION} onClose={() => {}}>
        <p className="or-body">Testina Patientsson, MRN OR-100482</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: TITLE });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('or-modal__dialog');
    expect(dialog).toHaveAccessibleDescription(DESCRIPTION);
    expect(screen.getByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument();
    expect(screen.getByText('Testina Patientsson, MRN OR-100482')).toBeInTheDocument();
  });

  it('names the dialog from a rich title', () => {
    render(
      <Modal
        title={
          <>
            Revoke access for <strong>Dr. Amara Okafor</strong>?
          </>
        }
      />
    );
    expect(
      screen.getByRole('dialog', { name: /Revoke access for\s+Dr\. Amara Okafor/ })
    ).toBeInTheDocument();
  });

  it('omits the description, body and footer wrappers when nothing is passed', () => {
    const { container } = render(<Modal title={TITLE} />);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
    expect(container.querySelector('.or-modal__description')).toBeNull();
    expect(container.querySelector('.or-modal__body')).toBeNull();
    expect(container.querySelector('.or-modal__footer')).toBeNull();
  });

  it('renders a bare panel when there is neither a title nor a close control', () => {
    const { container } = render(
      <Modal aria-label="Session check">
        <p className="or-body">Checking your instance.</p>
      </Modal>
    );
    expect(container.querySelector('.or-modal__header')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Session check' })).not.toHaveAttribute(
      'aria-labelledby'
    );
  });

  it('shows the close control only when onClose is given, and calls it on click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Modal title={TITLE} />);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    rerender(<Modal title={TITLE} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // A dismissible dialog with no heading still gets its close control.
    rerender(<Modal aria-label="Session check" onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('closes on Escape and ignores every other key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal title={TITLE} description={DESCRIPTION} onClose={onClose} />);

    await user.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the panel on open and back to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<RevokeFlow />);
    const trigger = screen.getByRole('button', { name: 'Manage access' });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('cycles Tab and Shift+Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(
      <Modal title={TITLE} onClose={() => {}} footer={<ConfirmActions />}>
        <p className="or-body">Observation/8867-4 stays in your audit log.</p>
      </Modal>
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const revoke = screen.getByRole('button', { name: 'Revoke access' });

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(revoke).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(revoke).toHaveFocus();
  });

  it('pulls focus back in when it starts outside the panel', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Modal title={TITLE} onClose={() => {}} footer={<ConfirmActions />} />
      </>
    );
    const outside = screen.getByRole('button', { name: 'Outside' });

    outside.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    outside.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Revoke access' })).toHaveFocus();
  });

  it('keeps focus on the panel when nothing inside can take it, and survives Escape', async () => {
    const user = userEvent.setup();
    render(<Modal title={TITLE} description={DESCRIPTION} />);
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveFocus();
    await user.tab();
    expect(dialog).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
  });

  it('carries width into the stylesheet and defaults to 460px', () => {
    const { rerender } = render(<Modal title={TITLE} />);
    expect(screen.getByRole('dialog').style.getPropertyValue('--or-modal-width')).toBe('460px');

    rerender(<Modal title={TITLE} width={640} />);
    expect(screen.getByRole('dialog').style.getPropertyValue('--or-modal-width')).toBe('640px');
  });

  it('merges className and style and forwards native attributes onto the panel', () => {
    render(
      <Modal
        title={TITLE}
        className="or-consent-dialog"
        style={{ marginTop: '8px' }}
        id="revoke-dialog"
        data-testid="revoke"
        role="alertdialog"
      />
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('or-modal__dialog', 'or-consent-dialog');
    expect(dialog).toHaveStyle({ marginTop: '8px' });
    expect(dialog).toHaveAttribute('id', 'revoke-dialog');
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'revoke-dialog-title');
    expect(screen.getByTestId('revoke')).toBe(dialog);
  });

  it('locks body scroll while open and restores what was there before', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(<Modal title={TITLE} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Modal open={false} title={TITLE} />);
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('renders the scrim around the panel', () => {
    const { container } = render(<Modal title={TITLE} />);
    const scrim = container.querySelector('.or-modal');
    expect(scrim).not.toBeNull();
    expect(scrim).toContainElement(screen.getByRole('dialog'));
  });
});

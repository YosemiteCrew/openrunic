import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Drawer } from '@/components/billing';

/**
 * The drawer is composed in the app rather than taken from the library, so its
 * accessibility contract is tested here rather than assumed: it is a modal
 * dialog, it closes on Escape, and it gives focus back to whatever opened it.
 */

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open claim CLM-24118
      </button>
      <Drawer
        open={open}
        title="Claim CLM-24118"
        subtitle="Patientsson, Testina"
        onClose={() => setOpen(false)}
        footer={<button type="button">Rebill claim</button>}
      >
        <p>Event history</p>
      </Drawer>
    </>
  );
}

describe('Drawer', () => {
  it('renders as a modal dialog named by its own title', () => {
    render(
      <Drawer open title="Claim CLM-24118" onClose={vi.fn()}>
        <p>Event history</p>
      </Drawer>
    );

    const dialog = screen.getByRole('dialog', { name: 'Claim CLM-24118' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Event history')).toBeInTheDocument();
  });

  it('renders nothing at all while it is closed', () => {
    render(
      <Drawer open={false} title="Claim CLM-24118" onClose={vi.fn()}>
        <p>Event history</p>
      </Drawer>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape, so the keyboard route out never depends on the scrim', () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Claim CLM-24118" onClose={onClose}>
        <p>Event history</p>
      </Drawer>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from a labelled control, not an anonymous icon', () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Claim CLM-24118" onClose={onClose}>
        <p>Event history</p>
      </Drawer>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('takes focus on open and hands it back to the trigger on close', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open claim CLM-24118' });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Claim CLM-24118' });
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab inside the panel rather than letting it escape to the page behind', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open claim CLM-24118' }));

    const rebill = screen.getByRole('button', { name: 'Rebill claim' });
    rebill.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // Wrapped to the first stop inside the panel, which is the close control.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});

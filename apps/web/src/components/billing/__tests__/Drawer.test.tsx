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

describe('Drawer, the rest of the focus trap', () => {
  it('cycles Shift-Tab from the first stop round to the last', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open claim CLM-24118' }));

    screen.getByRole('button', { name: 'Close' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rebill claim' }));
  });

  it('leaves an ordinary Tab in the middle of the panel to the browser', () => {
    render(
      <Drawer
        open
        title="Claim CLM-24118"
        onClose={vi.fn()}
        footer={<button type="button">Rebill claim</button>}
      >
        <button type="button">Open the fee sheet</button>
      </Drawer>
    );

    const middle = screen.getByRole('button', { name: 'Open the fee sheet' });
    middle.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // Not at either edge, so the trap must not yank the caret back to the top
    // of the panel on every keystroke.
    expect(document.activeElement).toBe(middle);
  });

  it('pulls focus back in when it has escaped to the page behind', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open claim CLM-24118' });
    fireEvent.click(opener);

    opener.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('ignores every key that is neither Escape nor Tab', () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Claim CLM-24118" onClose={onClose}>
        <p>Event history</p>
      </Drawer>
    );

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'a' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

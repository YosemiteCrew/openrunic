import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '@/components/command/CommandPalette';
import { CommandProvider, useRegisterCommands } from '@/components/command/CommandProvider';
import { filterCommands, flattenSections, scoreCommand } from '@/components/command/filter';
import type { Command } from '@/components/command/types';
import { NAVIGATE_COMMANDS } from '@/components/shell/navigation';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule',
}));

const performBooking = vi.fn();

function ScreenWithCommands() {
  useRegisterCommands(
    useMemo<Command[]>(
      () => [
        {
          id: 'schedule.book',
          group: 'actions',
          label: 'Book appointment',
          keywords: ['find available', 'slot'],
          icon: 'calendar-plus',
          perform: performBooking,
        },
      ],
      []
    )
  );
  return <p>screen body</p>;
}

function Harness({ withScreen = true }: { withScreen?: boolean }) {
  return (
    <CommandProvider baseCommands={NAVIGATE_COMMANDS}>
      <button type="button">outside trigger</button>
      {withScreen ? <ScreenWithCommands /> : null}
      <CommandPalette />
    </CommandProvider>
  );
}

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
}

async function findCombobox(): Promise<HTMLElement> {
  return screen.findByRole('combobox');
}

beforeEach(() => {
  push.mockClear();
  performBooking.mockClear();
});

describe('scoreCommand', () => {
  const command: Command = {
    id: 'navigate.billing',
    group: 'navigate',
    label: 'Billing',
    keywords: ['fee sheet', 'charges'],
    href: '/billing',
  };

  it('ranks a prefix above a keyword match', () => {
    expect(scoreCommand(command, 'bil')).toBeLessThan(scoreCommand(command, 'fee sheet'));
  });

  it('finds a command through a synonym a migrant would type', () => {
    expect(scoreCommand(command, 'charges')).toBeLessThan(4);
  });

  it('drops a command that does not match at all', () => {
    expect(scoreCommand(command, 'zzzz')).toBe(4);
  });
});

describe('filterCommands', () => {
  it('groups results and keeps the group order stable', () => {
    const sections = filterCommands(
      [
        { id: 'a', group: 'navigate', label: 'Schedule', href: '/schedule' },
        { id: 'b', group: 'actions', label: 'Book appointment', perform: vi.fn() },
      ],
      ''
    );
    expect(sections.map((section) => section.group)).toEqual(['navigate', 'actions']);
    expect(flattenSections(sections)).toHaveLength(2);
  });

  it('drops a group that has no results rather than showing an empty heading', () => {
    const sections = filterCommands(
      [{ id: 'a', group: 'navigate', label: 'Schedule', href: '/schedule' }],
      'schedule'
    );
    expect(sections).toHaveLength(1);
  });
});

describe('CommandPalette', () => {
  it('opens on Cmd-K and closes on a second press', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openPalette();
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();

    openPalette();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens on Ctrl-K for anyone not on a Mac', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('puts focus in the field so the first keystroke is not lost', async () => {
    render(<Harness />);
    openPalette();
    expect(await findCombobox()).toHaveFocus();
  });

  it('wires the combobox to its listbox and its active option', async () => {
    render(<Harness />);
    openPalette();

    const input = await findCombobox();
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBeTruthy());
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the selection with the arrow keys and wraps at the ends', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    const first = input.getAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = input.getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(first);

    fireEvent.keyDown(input, { key: 'End' });
    const last = input.getAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(first);
    expect(last).not.toBe(first);

    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toBe(first);
  });

  it('filters as you type and reaches a screen by its synonym', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: 'fee sheet' } });

    const listbox = screen.getByRole('listbox');
    await waitFor(() =>
      expect(within(listbox).getByRole('option', { name: /Billing/ })).toBeInTheDocument()
    );
    expect(within(listbox).queryByRole('option', { name: /^Reports/ })).not.toBeInTheDocument();
  });

  it('navigates on Enter', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: 'billing' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Billing/ })).toBeInTheDocument()
    );
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(push).toHaveBeenCalledWith('/billing');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('runs a command the current screen registered', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: 'book appointment' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Book appointment/ })).toBeInTheDocument()
    );
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(performBooking).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('drops the commands of a screen that has unmounted', async () => {
    const { rerender } = render(<Harness />);
    openPalette();
    const input = await findCombobox();
    fireEvent.change(input, { target: { value: 'book appointment' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Book appointment/ })).toBeInTheDocument()
    );

    rerender(<Harness withScreen={false} />);
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Book appointment/ })).not.toBeInTheDocument()
    );
  });

  it('finds a patient by name and opens the chart', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: 'Oyelaran' } });
    const option = await screen.findByRole('option', { name: /Oyelaran, Marek/ });
    fireEvent.click(option);

    expect(push).toHaveBeenCalledWith(expect.stringContaining('/patients/'));
  });

  it('finds a patient by MRN', async () => {
    render(<Harness />);
    openPalette();
    fireEvent.change(await findCombobox(), { target: { value: 'OR-100482' } });
    expect(await screen.findByRole('option', { name: /Patientsson/ })).toBeInTheDocument();
  });

  it('says what to try instead of showing a blank list', async () => {
    render(<Harness />);
    openPalette();
    fireEvent.change(await findCombobox(), { target: { value: 'zzzzqqq' } });
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to what opened it', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'outside trigger' });
    trigger.focus();

    openPalette();
    const input = await findCombobox();
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('traps Tab inside the dialog', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('tells the user which keys work', async () => {
    render(<Harness />);
    openPalette();
    expect(
      await screen.findByText(/Arrow keys move, Enter opens, Escape closes/)
    ).toBeInTheDocument();
  });
});

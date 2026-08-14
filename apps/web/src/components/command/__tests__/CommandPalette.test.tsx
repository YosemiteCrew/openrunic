import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/* Three commands hidden behind one nonsense token. No label, synonym or MRN in
   the real command set is a subsequence of "zqx", so filtering on it leaves
   exactly these three, in this order, however the app's command set grows. */
const PROBE_TOKEN = 'zqx';
const performAlpha = vi.fn();
const performBeta = vi.fn();
const performGamma = vi.fn();

function ProbeCommands() {
  useRegisterCommands(
    useMemo<Command[]>(
      () => [
        {
          id: 'probe.a',
          group: 'actions',
          label: 'Alpha probe',
          keywords: [PROBE_TOKEN],
          perform: performAlpha,
        },
        {
          id: 'probe.b',
          group: 'actions',
          label: 'Beta probe',
          keywords: [PROBE_TOKEN],
          perform: performBeta,
        },
        {
          id: 'probe.c',
          group: 'actions',
          label: 'Gamma probe',
          keywords: [PROBE_TOKEN],
          perform: performGamma,
        },
      ],
      []
    )
  );
  return null;
}

function ProbeHarness() {
  return (
    <CommandProvider baseCommands={NAVIGATE_COMMANDS}>
      <ProbeCommands />
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
  performAlpha.mockClear();
  performBeta.mockClear();
  performGamma.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

    fireEvent.change(input, { target: { value: 'Testperson' } });
    const option = await screen.findByRole('option', { name: /Testperson, Exampla/ });
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

/**
 * The palette without a pointer.
 *
 * These exist because the options carry a click handler and no key handler,
 * which reads like a hole unless the keyboard route is shown to be whole.
 * Nothing below fires a pointer event: every step is a key press on the field
 * that holds focus, and the option that runs is the one the highlight is on.
 */
describe('CommandPalette, keyboard only', () => {
  async function openProbeList(): Promise<{ input: HTMLElement; options: HTMLElement[] }> {
    render(<ProbeHarness />);
    openPalette();
    const input = await findCombobox();
    fireEvent.change(input, { target: { value: PROBE_TOKEN } });
    const options = await screen.findAllByRole('option');
    return { input, options };
  }

  it('lands focus in the field, so the palette is usable the moment it opens', async () => {
    const { input, options } = await openProbeList();

    expect(input).toHaveFocus();
    expect(options.map((option) => option.textContent)).toEqual([
      'Alpha probe',
      'Beta probe',
      'Gamma probe',
    ]);
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
  });

  it('runs the option the arrow keys landed on, not the one that started highlighted', async () => {
    const { input, options } = await openProbeList();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(input).toHaveAttribute('aria-activedescendant', options[2]?.id);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(performGamma).toHaveBeenCalledTimes(1);
    expect(performAlpha).not.toHaveBeenCalled();
    expect(performBeta).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reaches the last option by pressing Up at the top of the list', async () => {
    const { input, options } = await openProbeList();

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(input).toHaveAttribute('aria-activedescendant', options[2]?.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(performGamma).toHaveBeenCalledTimes(1);
  });

  it('scrolls the highlighted option back into view as the selection moves', async () => {
    const revealed: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function reveal(
      this: Element
    ) {
      revealed.push(this);
    });

    const { input, options } = await openProbeList();
    revealed.length = 0;

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(revealed.at(-1)).toBe(options[1]);

    fireEvent.keyDown(input, { key: 'End' });
    expect(revealed.at(-1)).toBe(options[2]);
  });

  it('leaves the field the only focus stop, so Escape is the whole way out', async () => {
    const { input } = await openProbeList();

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(performAlpha).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('CommandPalette, the edges of the keyboard contract', () => {
  it('does nothing on Enter when nothing matches what was typed', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: 'nothing matches this at all' } });
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));

    fireEvent.keyDown(input, { key: 'Enter' });

    // No navigation, no command run, and the palette stays open so the query
    // can be corrected rather than silently swallowed.
    expect(push).not.toHaveBeenCalled();
    expect(performBooking).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('holds the highlight at the top when there is nothing to move through', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: 'nothing matches this at all' } });
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'End' });

    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores keys that are neither navigation nor activation', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();
    const before = input.getAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'PageDown' });
    fireEvent.keyDown(input, { key: 'F5' });

    expect(input).toHaveAttribute('aria-activedescendant', before!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cycles Shift-Tab from the field round to the last stop in the panel', async () => {
    render(<Harness />);
    openPalette();
    const input = await findCombobox();

    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });

    // The field is the first stop, so Shift-Tab wraps rather than escaping to
    // the page underneath an open overlay.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes when the scrim behind it is clicked', async () => {
    const { container } = render(<Harness />);
    openPalette();
    await findCombobox();

    fireEvent.click(container.querySelector('.or-palette__scrim')!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('follows the pointer without stealing focus from the field', async () => {
    render(<ProbeHarness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: PROBE_TOKEN } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));

    fireEvent.mouseMove(screen.getAllByRole('option')[2]!);
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]!.id);
    expect(input).toHaveFocus();

    // And Enter then runs the option the pointer moved to.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(performGamma).toHaveBeenCalledTimes(1);
    expect(performAlpha).not.toHaveBeenCalled();
  });

  it('runs the option a click lands on', async () => {
    render(<ProbeHarness />);
    openPalette();
    const input = await findCombobox();

    fireEvent.change(input, { target: { value: PROBE_TOKEN } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));

    fireEvent.click(screen.getAllByRole('option')[1]!);

    expect(performBeta).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';
import type { TabsItem } from './Tabs';

const SUMMARY = 'Testina Patientsson, MRN OR-100482.';
const RESULTS = 'Glucose 7.4 mmol/L, above range.';
const NOTES = 'Reviewed by Dr. Amara Okafor on 12 Aug 2026.';

const ITEMS: TabsItem[] = [
  { id: 'summary', label: 'Summary', panel: <p>{SUMMARY}</p> },
  { id: 'results', label: 'Results', panel: <p>{RESULTS}</p> },
  { id: 'notes', label: 'Notes', panel: <p>{NOTES}</p> },
];

const WITH_DISABLED: TabsItem[] = [
  { id: 'summary', label: 'Summary', panel: <p>{SUMMARY}</p> },
  { id: 'imaging', label: 'Imaging', disabled: true, panel: <p>No imaging on file.</p> },
  { id: 'notes', label: 'Notes', panel: <p>{NOTES}</p> },
];

describe('Tabs', () => {
  it('renders a named strip with the first tab selected and only its panel', () => {
    render(<Tabs items={ITEMS} label="Record sections" />);

    const list = screen.getByRole('tablist', { name: 'Record sections' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('type', 'button');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveClass('or-tabs__tab--active');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.queryByText(RESULTS)).not.toBeInTheDocument();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('starts on the tab named by defaultValue', () => {
    render(<Tabs items={ITEMS} label="Record sections" defaultValue="notes" />);

    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(NOTES)).toBeInTheDocument();
  });

  it('points each tab at its own panel and the panel back at its tab', () => {
    render(<Tabs items={ITEMS} label="Record sections" defaultValue="results" />);

    const tab = screen.getByRole('tab', { name: 'Results' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(panel).toHaveAttribute('tabindex', '0');
    expect(panel).toHaveTextContent(RESULTS);
  });

  it('gives a Tab stop to the selected tab alone', () => {
    render(<Tabs items={ITEMS} label="Record sections" defaultValue="results" />);

    const [summary, results, notes] = screen.getAllByRole('tab');
    expect(results).toHaveAttribute('tabindex', '0');
    expect(summary).toHaveAttribute('tabindex', '-1');
    expect(notes).toHaveAttribute('tabindex', '-1');
  });

  it('selects a tab when it is clicked and reports the id', async () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} label="Record sections" onChange={onChange} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Results' }));
    expect(onChange).toHaveBeenCalledWith('results');
    expect(screen.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(RESULTS)).toBeInTheDocument();
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  });

  it('follows a controlled value and never moves itself', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Tabs items={ITEMS} label="Record sections" value="results" onChange={onChange} />
    );
    expect(screen.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(onChange).toHaveBeenCalledWith('notes');
    expect(screen.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(RESULTS)).toBeInTheDocument();

    rerender(<Tabs items={ITEMS} label="Record sections" value="notes" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(NOTES)).toBeInTheDocument();
  });

  it('enters the strip on the selected tab and walks it with ArrowRight, wrapping at the end', async () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} label="Record sections" onChange={onChange} />);
    const [summary, results, notes] = screen.getAllByRole('tab');

    await userEvent.tab();
    expect(summary).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(results).toHaveFocus();
    expect(results).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('results');
    expect(screen.getByText(RESULTS)).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(notes).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('notes');

    await userEvent.keyboard('{ArrowRight}');
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('summary');
  });

  it('walks the strip backwards with ArrowLeft, wrapping at the start', async () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} label="Record sections" onChange={onChange} />);
    const [summary, results, notes] = screen.getAllByRole('tab');

    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(notes).toHaveFocus();
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('notes');

    await userEvent.keyboard('{ArrowLeft}');
    expect(results).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('results');

    await userEvent.keyboard('{ArrowLeft}');
    expect(summary).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('summary');
  });

  it('jumps to the ends of the strip with Home and End', async () => {
    const onChange = vi.fn();
    render(
      <Tabs items={ITEMS} label="Record sections" defaultValue="results" onChange={onChange} />
    );
    const [summary, , notes] = screen.getAllByRole('tab');

    await userEvent.tab();
    await userEvent.keyboard('{End}');
    expect(notes).toHaveFocus();
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('notes');

    await userEvent.keyboard('{Home}');
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('summary');
  });

  it('steps over a disabled tab and refuses to select it', async () => {
    const onChange = vi.fn();
    render(<Tabs items={WITH_DISABLED} label="Record sections" onChange={onChange} />);
    const [summary, imaging, notes] = screen.getAllByRole('tab');
    expect(imaging).toBeDisabled();

    await userEvent.tab();
    expect(summary).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(notes).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('notes');

    await userEvent.keyboard('{ArrowLeft}');
    expect(summary).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('summary');

    await userEvent.click(imaging as Element);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(imaging).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('No imaging on file.')).not.toBeInTheDocument();
  });

  it('moves from the first enabled tab when the selection is not one of them', () => {
    const onChange = vi.fn();
    render(
      <Tabs items={WITH_DISABLED} label="Record sections" value="imaging" onChange={onChange} />
    );

    const list = screen.getByRole('tablist');
    expect(fireEvent.keyDown(list, { key: 'ArrowRight' })).toBe(false);
    expect(onChange).toHaveBeenCalledWith('notes');
  });

  it('renders a tab icon hidden from assistive technology, and copes with an unknown slug', () => {
    const { container } = render(
      <Tabs
        items={[
          { id: 'summary', label: 'Summary', icon: 'file-text' },
          { id: 'ledger', label: 'Ledger', icon: 'not-a-lucide-slug' },
          { id: 'notes', label: 'Notes' },
        ]}
        label="Record sections"
      />
    );

    const icons = container.querySelectorAll('.or-tabs__icon');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('tab', { name: 'Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeInTheDocument();
  });

  it('renders an empty strip and no panel when there is nothing to show', () => {
    render(<Tabs label="Record sections" />);

    const list = screen.getByRole('tablist', { name: 'Record sections' });
    expect(within(list).queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();

    // Nothing to move to, so the keys are left to the page.
    expect(fireEvent.keyDown(list, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(list, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(list, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(list, { key: 'End' })).toBe(true);
  });

  it('leaves keys it does not own to the page', () => {
    render(<Tabs items={ITEMS} label="Record sections" />);

    const list = screen.getByRole('tablist');
    expect(fireEvent.keyDown(list, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(list, { key: 'Enter' })).toBe(true);
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  });

  it('survives a missing onChange', async () => {
    render(<Tabs items={ITEMS} label="Record sections" />);

    await userEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(
      <Tabs items={ITEMS} label="Record sections" className="or-record-tabs" data-testid="tabs" />
    );

    const root = container.querySelector('.or-tabs');
    expect(root).toHaveClass('or-tabs', 'or-record-tabs');
    expect(screen.getByTestId('tabs')).toBe(root);
  });

  it('uses a caller-supplied id, and keeps two strips on one page apart otherwise', () => {
    const { rerender } = render(<Tabs items={ITEMS} label="Record sections" id="record-tabs" />);

    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'id',
      'record-tabs-tab-summary'
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'record-tabs-panel-summary');

    rerender(
      <>
        <Tabs items={ITEMS} label="Record sections" />
        <Tabs items={ITEMS} label="Result sections" />
      </>
    );
    const [first, second] = screen.getAllByRole('tablist').map((list) => {
      return within(list).getAllByRole('tab')[0]?.id;
    });
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });
});

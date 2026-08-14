import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from '../Badge';
import { Table } from './Table';
import type { TableColumn } from './Table';

const columns: TableColumn[] = [
  { key: 'test', header: 'Test' },
  { key: 'value', header: 'Result', numeric: true },
  { key: 'state', header: 'Range' },
  { key: 'code', header: 'Code', mono: true },
];

const rows: Array<Record<string, ReactNode>> = [
  {
    id: 'obs-8867-4',
    test: 'Blood glucose',
    value: '7.4 mmol/L',
    state: <Badge tone="danger">Above range</Badge>,
    code: 'Observation/8867-4',
  },
  {
    id: 'obs-8867-5',
    test: 'HbA1c',
    value: '5.4 %',
    state: <Badge tone="success">In range</Badge>,
    code: 'Observation/8867-5',
  },
];

describe('Table', () => {
  it('renders a captioned table with column headers and cell values', () => {
    render(<Table caption="Results for Testina Patientsson" columns={columns} rows={rows} />);
    const table = screen.getByRole('table', { name: 'Results for Testina Patientsson' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Blood glucose')).toBeInTheDocument();
    expect(screen.getByText('Observation/8867-4')).toBeInTheDocument();
  });

  it('scopes every header to its column', () => {
    render(<Table columns={columns} rows={rows} />);
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col');
    }
  });

  it('omits the caption element when there is no caption', () => {
    const { container } = render(<Table columns={columns} rows={rows} />);
    expect(container.querySelector('.or-table__caption')).toBeNull();
  });

  it('right-aligns a numeric column and gives it tabular figures', () => {
    render(<Table columns={columns} rows={rows} />);
    const [, result] = screen.getAllByRole('columnheader');
    expect(result).toHaveClass('or-table__cell--right');
    expect(screen.getByText('7.4 mmol/L')).toHaveClass(
      'or-table__cell--right',
      'or-table__cell--numeric'
    );
  });

  it('lets an explicit align override the numeric default', () => {
    render(
      <Table
        columns={[{ key: 'value', header: 'Result', numeric: true, align: 'center' }]}
        rows={[{ value: '58 bpm' }]}
      />
    );
    const cell = screen.getByRole('cell');
    expect(cell).toHaveClass('or-table__cell--center', 'or-table__cell--numeric');
    expect(cell).not.toHaveClass('or-table__cell--right');
  });

  it.each([
    ['left', 'or-table__cell--left'],
    ['center', 'or-table__cell--center'],
    ['right', 'or-table__cell--right'],
  ] as const)('renders the %s alignment', (align, expected) => {
    render(<Table columns={[{ key: 'test', header: 'Test', align }]} rows={[{ test: 'HbA1c' }]} />);
    expect(screen.getByRole('cell')).toHaveClass(expected);
    expect(screen.getByRole('columnheader')).toHaveClass(expected);
  });

  it('sets identifier columns in mono and leaves the header alone', () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByText('Observation/8867-5')).toHaveClass('or-table__cell--mono');
    expect(screen.getByRole('columnheader', { name: 'Code' })).not.toHaveClass(
      'or-table__cell--mono'
    );
  });

  it('renders node cells such as a status badge', () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByText('Above range')).toHaveClass('or-badge', 'or-badge--danger');
  });

  it('renders an empty cell for a key the row does not carry', () => {
    render(<Table columns={columns} rows={[{ test: 'HbA1c' }]} />);
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(4);
    expect(cells[1]).toBeEmptyDOMElement();
  });

  it('keys rows by their own id and falls back to the row position', () => {
    const { container, rerender } = render(<Table columns={columns} rows={rows} />);
    expect(container.querySelectorAll('.or-table__row')).toHaveLength(2);

    rerender(<Table columns={columns} rows={[{ test: 'HbA1c' }, { test: 'Blood glucose' }]} />);
    expect(container.querySelectorAll('.or-table__row')).toHaveLength(2);
  });

  it('renders headers with no rows, and nothing at all with no columns', () => {
    const { container, rerender } = render(<Table columns={columns} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(container.querySelectorAll('.or-table__row')).toHaveLength(0);

    rerender(<Table />);
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(container.querySelector('.or-table__grid')).toBeInTheDocument();
  });

  it('wraps the table in its own horizontal scroll container', () => {
    const { container } = render(<Table columns={columns} rows={rows} />);
    const scroll = container.querySelector('.or-table__scroll');
    expect(scroll).toBeInTheDocument();
    expect(scroll?.firstElementChild?.tagName).toBe('TABLE');
  });

  it('makes the scroll container keyboard reachable, and names it only when captioned', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <Table caption="Recent results" columns={columns} rows={rows} />
    );

    const named = screen.getByRole('region', { name: 'Recent results' });
    expect(named).toHaveClass('or-table__scroll');
    await user.tab();
    expect(named).toHaveFocus();

    // No caption means no accessible name, so the region role would be nameless.
    rerender(<Table columns={columns} rows={rows} />);
    const scroll = container.querySelector('.or-table__scroll');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(scroll).toHaveAttribute('tabindex', '0');
  });

  /**
   * A CSS assertion, deliberately.
   *
   * jsdom does no layout, so the failure this guards - the page itself
   * scrolling sideways because an absolutely positioned descendant escaped the
   * scroller - is invisible to every other test here. The declaration reads
   * like a decorative leftover and is one keystroke from being deleted, so the
   * stylesheet is asserted directly rather than left to a reviewer's eye.
   */
  it('keeps the scroll container a containing block, so its overflow stays its own', () => {
    // Read from disk: the Vite pipeline hands tests an empty string for a CSS
    // import, so the file itself is the only source of truth available here.
    const css = readFileSync('src/components/Table/Table.css', 'utf8');
    const scrollRule = /\.or-table__scroll\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(scrollRule).toMatch(/overflow-x:\s*auto/);
    expect(scrollRule).toMatch(/position:\s*relative/);
  });

  it('merges className and forwards native attributes', () => {
    render(
      <Table
        className="or-records__table"
        columns={columns}
        data-testid="results"
        id="results"
        rows={rows}
      />
    );
    const wrapper = screen.getByTestId('results');
    expect(wrapper).toHaveClass('or-table', 'or-records__table');
    expect(wrapper).toHaveAttribute('id', 'results');
  });
});

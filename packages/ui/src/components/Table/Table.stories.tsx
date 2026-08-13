import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../Badge';
import { Tag } from '../Tag';
import { Table } from './Table';
import type { TableColumn } from './Table';

const resultColumns: TableColumn[] = [
  { key: 'test', header: 'Test' },
  { key: 'value', header: 'Result', numeric: true },
  { key: 'range', header: 'Range' },
  { key: 'taken', header: 'Taken' },
  { key: 'code', header: 'Code', mono: true },
];

const resultRows: Array<Record<string, ReactNode>> = [
  {
    id: 'obs-8867-4',
    test: 'Blood glucose',
    value: '7.4 mmol/L',
    range: <Badge tone="danger">Above range</Badge>,
    taken: '12 Aug 2026',
    code: 'Observation/8867-4',
  },
  {
    id: 'obs-4548-4',
    test: 'HbA1c',
    value: '5.4 %',
    range: <Badge tone="success">In range</Badge>,
    taken: '12 Aug 2026',
    code: 'Observation/4548-4',
  },
  {
    id: 'obs-2093-3',
    test: 'Total cholesterol',
    value: '4.9 mmol/L',
    range: <Badge tone="success">In range</Badge>,
    taken: '12 Aug 2026',
    code: 'Observation/2093-3',
  },
  {
    id: 'obs-14957-5',
    test: 'Urine albumin',
    value: '18 mg/L',
    range: <Badge tone="neutral">Awaiting lab</Badge>,
    taken: '13 Aug 2026',
    code: 'Observation/14957-5',
  },
];

const meta = {
  title: 'Data/Table',
  component: Table,
  parameters: { layout: 'padded' },
  args: {
    caption: 'Lab results for Testina Patientsson, MRN OR-100482',
    columns: resultColumns,
    rows: resultRows,
  },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The caption is the table's accessible name, so it is worth writing properly. */
export const WithoutCaption: Story = {
  args: { caption: undefined },
};

/**
 * Numeric columns take tabular figures and right-align themselves so decimal points stack;
 * mono columns carry FHIR identifiers, where every character has to be countable.
 */
export const NumericAndMono: Story = {
  args: {
    caption: 'Blood pressure, last four readings',
    columns: [
      { key: 'taken', header: 'Taken' },
      { key: 'systolic', header: 'Systolic', numeric: true },
      { key: 'diastolic', header: 'Diastolic', numeric: true },
      { key: 'code', header: 'Code', mono: true },
    ],
    rows: [
      { id: '1', taken: '12 Aug 2026', systolic: '118', diastolic: '74', code: '85354-9' },
      { id: '2', taken: '11 Aug 2026', systolic: '121', diastolic: '78', code: '85354-9' },
      { id: '3', taken: '10 Aug 2026', systolic: '116', diastolic: '72', code: '85354-9' },
      { id: '4', taken: '09 Aug 2026', systolic: '124', diastolic: '81', code: '85354-9' },
    ],
  },
};

/** Cells take nodes, so status and metadata come from the same primitives as the rest of the app. */
export const WithNodeCells: Story = {
  args: {
    caption: 'Care team access for Testina Patientsson',
    columns: [
      { key: 'person', header: 'Person' },
      { key: 'source', header: 'Source' },
      { key: 'scope', header: 'Scope' },
      { key: 'status', header: 'Status' },
    ],
    rows: [
      {
        id: 'okafor',
        person: 'Dr. Okafor',
        source: 'Ridgeview Clinic',
        scope: <Tag mono>Observation.read</Tag>,
        status: <Badge tone="success">Active grant</Badge>,
      },
      {
        id: 'ellison',
        person: 'Dr. Ellison',
        source: 'Northgate Cardiology',
        scope: <Tag mono>DocumentReference.read</Tag>,
        status: <Badge tone="neutral">Invited</Badge>,
      },
    ],
  },
};

/** No rows yet: the headers still describe what will arrive. Pair it with an EmptyState above. */
export const NoRows: Story = {
  args: { caption: 'No results in the last 12 months', rows: [] },
};

/**
 * Below 768px the table scrolls sideways inside its own container and the first column stays
 * pinned, so a result scrolled into view still belongs to a visible test name. The header is
 * sticky inside the same container, which shows whenever the caller constrains the height.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div style={{ padding: 'var(--space-4)' }}>
      <Table {...args} />
    </div>
  ),
};

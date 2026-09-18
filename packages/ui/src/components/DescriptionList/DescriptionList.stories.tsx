import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Badge } from '../Badge';
import { Card } from '../Card';
import { Tag } from '../Tag';
import { DescriptionList } from './DescriptionList';
import type { DescriptionListItem } from './DescriptionList';

/**
 * Regression guard for #503: a single unbroken mono value longer than the
 * description list's width must not overflow. The wrapper is 320px, and the
 * value is a 500-character unbroken string. With `overflow-wrap: anywhere` on
 * `.or-description-list__pair > *` the value wraps and `scrollWidth ===
 * clientWidth`. Without it, the value pushes the list wide and the assertion
 * fails.
 *
 * Mutation check: remove `overflow-wrap: anywhere` from
 * `.or-description-list__pair > *` in DescriptionList.css and this story will
 * fail in Chromium (real layout).
 */
const UNBROKEN_VALUE = 'x'.repeat(500);

const overflowItems: DescriptionListItem[] = [
  { term: 'Long identifier', value: UNBROKEN_VALUE, mono: true },
];

const patientHeader: DescriptionListItem[] = [
  { term: 'Name', value: 'Testina Patientsson' },
  { term: 'Medical record number', value: 'OR-100482', mono: true },
  { term: 'Date of birth', value: '04 Mar 1988' },
  { term: 'Care team', value: 'Dr. Amara Okafor, Ridgeview Clinic' },
];

const documentMetadata: DescriptionListItem[] = [
  { term: 'Source', value: 'Ridgeview Clinic' },
  { term: 'Received', value: '12 Aug 2026' },
  {
    term: 'Resource id',
    value: 'DocumentReference/9c1f4a02-7b3e-4d51-a0c8-2f6b19d4e7aa',
    mono: true,
  },
  { term: 'Observation', value: 'Observation/8867-4', mono: true },
  { term: 'Result', value: '7.4 mmol/L', numeric: true },
];

const meta = {
  title: 'Data/DescriptionList',
  component: DescriptionList,
  parameters: { layout: 'padded' },
  args: { items: patientHeader },
} satisfies Meta<typeof DescriptionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * The caption names the list for assistive technology, so two lists on one page stay
 * distinguishable. It is worth writing properly.
 */
export const WithCaption: Story = {
  args: { caption: 'Patient header' },
};

/**
 * Mono is for identifiers and codes, where every character has to be countable; numeric
 * gives a measurement tabular figures. A long identifier wraps inside its column rather
 * than pushing the list wider.
 */
export const MonoValues: Story = {
  args: { caption: 'Document metadata', items: documentMetadata },
};

/** Values take nodes, so status and scope come from the same primitives as the rest of the app. */
export const WithNodes: Story = {
  args: {
    caption: 'Consent grant',
    items: [
      { term: 'Granted to', value: 'Dr. Amara Okafor' },
      { term: 'Scope', value: <Tag mono>Observation.read</Tag> },
      { term: 'Status', value: <Badge tone="success">Active grant</Badge> },
      { term: 'Granted', value: '12 Aug 2026' },
      { term: 'Reference', value: 'Consent/4f28a1c6', mono: true },
    ],
  },
};

/**
 * The list carries no surface of its own, so it takes the paper it is dropped onto. Inside
 * a card it reads as the record's header, above whatever the card is actually about.
 */
export const InCard: Story = {
  render: (args) => (
    <Card overline="Patient" title="Testina Patientsson" style={{ maxWidth: '640px' }}>
      <DescriptionList {...args} />
    </Card>
  ),
  args: { items: patientHeader.slice(1) },
};

/**
 * Below 768px the pair stacks: the term sits on its own line above a full-width value, so
 * a long identifier never has to share a phone's width with its label. From md the pair
 * becomes two columns, term left and value right, and the values line up down the list.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  args: { caption: 'Document metadata', items: documentMetadata },
  render: (args) => (
    <div style={{ padding: 'var(--space-5)' }}>
      <DescriptionList {...args} />
    </div>
  ),
};

/**
 * Regression guard for #503: the value is a 500-character unbroken string
 * inside a 320px wrapper. With `overflow-wrap: anywhere` on
 * `.or-description-list__pair > *` the value wraps and
 * `scrollWidth <= clientWidth`. Without it, the list overflows and the assertion
 * fails in Chromium.
 *
 * Mutation check: remove `overflow-wrap: anywhere` from
 * `.or-description-list__pair > *` in DescriptionList.css and this story will fail.
 */
export const NoOverflowOnLongUnbrokenValue: Story = {
  parameters: { layout: 'fullscreen' },
  args: { items: overflowItems },
  render: (args) => (
    <div
      style={{
        width: '320px',
        margin: 'var(--space-4) auto',
        border: '1px solid red',
      }}
      data-testid="overflow-wrapper"
    >
      <DescriptionList {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector('[data-testid="overflow-wrapper"]');
    const value = wrapper?.querySelector('.or-description-list__value');
    if (!wrapper || !value) {
      throw new Error('Test elements not found');
    }
    // The wrapper must not overflow
    expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
    // The value cell must not overflow its container
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
  },
};

import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tag } from './Tag';

const meta = {
  title: 'Data/Tag',
  component: Tag,
  parameters: { layout: 'padded' },
  args: { children: 'Cardiology' },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  alignItems: 'center',
};

export const Default: Story = {};

/** Mono is for codes and identifiers, where every character has to be countable. */
export const Mono: Story = {
  args: { mono: true, children: 'Observation/8867-4' },
};

/** `onRemove` turns the chip into a dismissible filter. The cross is decorative; the button is named. */
export const Removable: Story = {
  args: { onRemove: () => {} },
};

/** A filter row over the records list for Testina Patientsson, MRN OR-100482. */
export const FilterRow: Story = {
  render: () => (
    <div style={row}>
      <Tag onRemove={() => {}}>Cardiology</Tag>
      <Tag onRemove={() => {}}>Ridgeview Clinic</Tag>
      <Tag onRemove={() => {}}>Last 12 months</Tag>
      <Tag mono onRemove={() => {}}>
        Observation/8867-4
      </Tag>
    </div>
  ),
};

/** Metadata chips carry no state, so they never take a status colour. Use a Badge for that. */
export const MetadataRow: Story = {
  render: () => (
    <div style={row}>
      <Tag>Lab result</Tag>
      <Tag>Dr. Okafor</Tag>
      <Tag>12 Aug 2026</Tag>
      <Tag mono>Observation/8867-4</Tag>
      <Tag mono>MRN OR-100482</Tag>
    </div>
  ),
};

/**
 * Below 768px a removable chip grows to a 44px touch target, so the cross can be hit with a
 * thumb without its hit area reaching into the chips above and below. Plain chips stay 26px.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <p className="or-overline" style={{ color: 'var(--text-secondary)' }}>
        Filters
      </p>
      <div style={row}>
        <Tag onRemove={() => {}}>Cardiology</Tag>
        <Tag onRemove={() => {}}>Ridgeview Clinic</Tag>
        <Tag onRemove={() => {}}>Last 12 months</Tag>
      </div>
      <p className="or-overline" style={{ color: 'var(--text-secondary)' }}>
        Metadata
      </p>
      <div style={row}>
        <Tag>Lab result</Tag>
        <Tag mono>Observation/8867-4</Tag>
      </div>
    </div>
  ),
};

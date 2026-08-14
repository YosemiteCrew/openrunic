import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '../Card';
import { IconButton } from './IconButton';

const meta = {
  title: 'Actions/IconButton',
  component: IconButton,
  parameters: { layout: 'padded' },
  args: { icon: 'x', label: 'Close' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
  alignItems: 'center',
};

export const Default: Story = {};

/** Three chrome-safe variants. An icon alone never carries destructive weight. */
export const Variants: Story = {
  render: () => (
    <div style={row}>
      <IconButton icon="plus" label="New record" variant="primary" />
      <IconButton icon="download" label="Export NDJSON" variant="secondary" />
      <IconButton icon="ellipsis" label="More actions" variant="ghost" />
    </div>
  ),
};

/** 32 / 40 / 48px boxes from md up. Anything touch-first should be `lg`. */
export const Sizes: Story = {
  render: () => (
    <div style={row}>
      <IconButton icon="pencil" label="Edit vitals" size="sm" variant="secondary" />
      <IconButton icon="pencil" label="Edit vitals" size="md" variant="secondary" />
      <IconButton icon="pencil" label="Edit vitals" size="lg" variant="secondary" />
    </div>
  ),
};

/** Disabled is 0.42 opacity with no colour change, and the label still names the control. */
export const Disabled: Story = {
  render: () => (
    <div style={row}>
      <IconButton icon="plus" label="New record" variant="primary" disabled />
      <IconButton icon="download" label="Export NDJSON" variant="secondary" disabled />
      <IconButton icon="ellipsis" label="More actions" disabled />
    </div>
  ),
};

/** Card overflow: the toolbar sits in the header, the glyphs stay ghost until hovered. */
export const InToolbar: Story = {
  render: () => (
    <Card
      overline="Observation / 8867-4"
      title="Heart rate"
      footer={
        <span className="or-small" style={{ color: 'var(--text-secondary)' }}>
          Recorded 12 Aug 2026 by Dr. Okafor
        </span>
      }
      style={{ maxWidth: 420 }}
    >
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <p className="or-body" style={{ margin: 0 }}>
          Testina Patientsson, MRN OR-100482
        </p>
        <div style={{ ...row, gap: 'var(--space-1)' }}>
          <IconButton icon="pencil" label="Edit observation" size="sm" />
          <IconButton icon="share-2" label="Share with care team" size="sm" />
          <IconButton icon="ellipsis" label="More actions" size="sm" />
        </div>
      </div>
      <p className="or-body" style={{ marginTop: 'var(--space-3)' }}>
        88 bpm - Within range
      </p>
    </Card>
  ),
};

/**
 * Below 768px every box grows to a 44px touch target, so a toolbar of `sm` controls stays
 * tappable; from md the exact 32 / 40 / 48px boxes return.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <header style={{ ...row, justifyContent: 'space-between' }}>
        <h2 className="or-h3" style={{ margin: 0 }}>
          Heart rate
        </h2>
        <IconButton icon="x" label="Close record" size="lg" variant="secondary" />
      </header>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Testina Patientsson, MRN OR-100482, care team of Dr. Okafor.
      </p>
      <div style={{ ...row, gap: 'var(--space-2)' }}>
        <IconButton icon="pencil" label="Edit observation" size="sm" variant="secondary" />
        <IconButton icon="share-2" label="Share with care team" size="sm" variant="secondary" />
        <IconButton icon="printer" label="Print summary" size="sm" variant="secondary" />
        <IconButton icon="plus" label="New record" size="sm" variant="primary" />
      </div>
    </div>
  ),
};

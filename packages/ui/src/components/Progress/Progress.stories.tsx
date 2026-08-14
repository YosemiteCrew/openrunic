import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '../Card';
import { Progress } from './Progress';

const meta = {
  title: 'Feedback/Progress',
  component: Progress,
  parameters: { layout: 'padded' },
  args: {
    label: 'Export in progress',
    value: 64,
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['accent', 'success', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

const stack: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-5)',
  maxWidth: '420px',
};

const caption: CSSProperties = {
  color: 'var(--text-secondary)',
};

export const Default: Story = {};

/**
 * With `showValue` the label and the percentage sit above the track as text, so the amount
 * is readable without interpreting the length of a coloured band.
 */
export const WithValue: Story = {
  args: { label: 'Export in progress', value: 1284, max: 2000, showValue: true },
};

/**
 * No `value` means the amount is unknown: the bar drops `aria-valuenow` entirely and a short
 * band slides the length of the track. The label still says what is running.
 */
export const Indeterminate: Story = {
  args: { label: 'Preparing the records bundle', value: undefined, showValue: true },
};

/** Olive for a finished or healthy result. The words carry it; the colour only agrees. */
export const Success: Story = {
  args: { label: 'Export complete', value: 2000, max: 2000, tone: 'success', showValue: true },
};

/** Warm red for a run that is failing. State the fact, then the next action. */
export const Danger: Story = {
  render: () => (
    <div style={stack}>
      <Progress label="Export stopped" value={412} max={2000} tone="danger" showValue />
      <p className="or-caption" style={caption}>
        Stopped after 412 of 2,000 records. Check the connection and start the export again.
      </p>
    </div>
  ),
};

/** Three track thicknesses. Nothing but the height changes between them. */
export const Sizes: Story = {
  render: () => (
    <div style={stack}>
      <Progress label="Export in progress, small track" value={64} size="sm" showValue />
      <Progress label="Export in progress, medium track" value={64} size="md" showValue />
      <Progress label="Export in progress, large track" value={64} size="lg" showValue />
    </div>
  ),
};

/**
 * On phones the track thickens so the fill stays readable at arm's length; from md the exact
 * desktop heights return. The label and the percentage sit on one row at every width, and a
 * long label wraps rather than pushing the bar out of its column.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <Card tone="white">
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Progress label="Export in progress" value={1284} max={2000} showValue />
          <p className="or-caption" style={caption}>
            1,284 of 2,000 records for Testina Patientsson, MRN OR-100482.
          </p>
        </div>
      </Card>
      <Card tone="white">
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Progress label="Preparing the next batch" showValue />
          <p className="or-caption" style={caption}>
            Still counting. The bar reports no percentage until the batch is sized.
          </p>
        </div>
      </Card>
    </div>
  ),
};

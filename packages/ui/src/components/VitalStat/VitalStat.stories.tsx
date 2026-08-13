import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '../Card';
import { VitalStat } from './VitalStat';

const meta = {
  title: 'Data/VitalStat',
  component: VitalStat,
  parameters: { layout: 'padded' },
  args: {
    label: 'Resting heart rate',
    icon: 'heart-pulse',
    value: '58',
    unit: 'bpm',
    state: 'success',
    stateLabel: 'In range',
    capturedAt: 'Today, 07:12',
  },
  argTypes: {
    state: { control: 'inline-radio', options: ['success', 'neutral', 'danger'] },
  },
} satisfies Meta<typeof VitalStat>;

export default meta;
type Story = StoryObj<typeof meta>;

const grid: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-5)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
};

export const Default: Story = {};

/** Olive in range, hazelnut informational, red out of range - each with its own words. */
export const States: Story = {
  render: () => (
    <div style={grid}>
      <VitalStat
        label="Resting heart rate"
        icon="heart-pulse"
        value="58"
        unit="bpm"
        state="success"
        stateLabel="In range"
        capturedAt="Today, 07:12"
      />
      <VitalStat
        label="Blood glucose"
        icon="droplet"
        value="7.4"
        unit="mmol/L"
        state="danger"
        stateLabel="Above range"
        capturedAt="Today, 08:40"
      />
      <VitalStat
        label="Vitamin D"
        icon="sun"
        value="62"
        unit="nmol/L"
        state="neutral"
        stateLabel="Awaiting lab review"
        capturedAt="12 Aug 2026"
      />
    </div>
  ),
};

/** Without a `stateLabel` the state row is dropped rather than left as a bare colour. */
export const NoState: Story = {
  args: { state: 'neutral', stateLabel: undefined, capturedAt: undefined },
};

/** The value takes a node, so a composite reading keeps its own punctuation. */
export const CompositeValue: Story = {
  args: {
    label: 'Blood pressure',
    icon: 'activity',
    value: '118 / 74',
    unit: 'mmHg',
    state: 'success',
    stateLabel: 'In range',
    capturedAt: 'Today, 07:14',
  },
};

/** The Today dashboard for Testina Patientsson, MRN OR-100482. */
export const InCards: Story = {
  render: () => (
    <div style={grid}>
      <Card tone="white">
        <VitalStat
          label="Resting heart rate"
          icon="heart-pulse"
          value="58"
          unit="bpm"
          state="success"
          stateLabel="In range"
          capturedAt="Today, 07:12"
        />
      </Card>
      <Card tone="white">
        <VitalStat
          label="Blood glucose"
          icon="droplet"
          value="7.4"
          unit="mmol/L"
          state="danger"
          stateLabel="Above range"
          capturedAt="Today, 08:40"
        />
      </Card>
    </div>
  ),
};

/**
 * The readout keeps its 32px value at every width; the dashboard grid around it collapses to
 * one column on phones, and a long value wraps its unit instead of overflowing the tile.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <Card tone="white">
        <VitalStat
          label="Blood pressure"
          icon="activity"
          value="118 / 74"
          unit="mmHg"
          state="success"
          stateLabel="In range"
          capturedAt="Today, 07:14"
        />
      </Card>
      <Card tone="white">
        <VitalStat
          label="Blood glucose"
          icon="droplet"
          value="7.4"
          unit="mmol/L"
          state="danger"
          stateLabel="Above range"
          capturedAt="Today, 08:40"
        />
      </Card>
    </div>
  ),
};

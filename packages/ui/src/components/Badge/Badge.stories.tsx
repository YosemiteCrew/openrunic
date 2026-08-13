import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './Badge';

const meta = {
  title: 'Data/Badge',
  component: Badge,
  parameters: { layout: 'padded' },
  args: { children: 'In range', tone: 'success' },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['success', 'neutral', 'danger', 'accent', 'ink'],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
  alignItems: 'center',
};

export const Default: Story = {};

/** Olive is in range, hazelnut informational, red out of range. Accent and ink are not clinical. */
export const Tones: Story = {
  render: () => (
    <div style={row}>
      <Badge tone="success">In range</Badge>
      <Badge tone="neutral">Awaiting lab</Badge>
      <Badge tone="danger">Above range</Badge>
      <Badge tone="accent">New source</Badge>
      <Badge tone="ink">Self-hosted</Badge>
    </div>
  ),
};

/**
 * The word is the signal. Read this row in greyscale and every state still reads, which is
 * the test the health rules actually ask for.
 */
export const NeverColourAlone: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'start' }}>
      <p className="or-body">Blood glucose, 12 Aug 2026</p>
      <div style={row}>
        <span className="or-mono">7.4 mmol/L</span>
        <Badge tone="danger">Above range</Badge>
      </div>
      <div style={row}>
        <span className="or-mono">5.4 %</span>
        <Badge tone="success">In range</Badge>
      </div>
    </div>
  ),
};

/** `icon={null}` drops the glyph. The label never goes with it. */
export const TextOnly: Story = {
  args: { icon: null, tone: 'neutral', children: 'Awaiting lab' },
};

/** Any Lucide slug overrides the tone default when the tone icon is not specific enough. */
export const CustomIcon: Story = {
  args: { icon: 'flask-conical', tone: 'neutral', children: 'Sample received' },
};

/** The ink tone is for espresso bands, where bone becomes the ink. */
export const OnEspresso: Story = {
  globals: { backgrounds: { value: 'espresso' } },
  render: () => (
    <div
      style={{
        ...row,
        background: 'var(--surface-inverse)',
        padding: 'var(--space-6)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <Badge tone="ink">Self-hosted</Badge>
      <Badge tone="accent">New source</Badge>
    </div>
  ),
};

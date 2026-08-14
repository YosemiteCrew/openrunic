import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Tooltip } from './Tooltip';

const meta = {
  title: 'Feedback/Tooltip',
  component: Tooltip,
  parameters: { layout: 'centered' },
  args: {
    label: 'Fasting glucose',
    children: <Button variant="secondary">Observation/8867-4</Button>,
  },
  argTypes: {
    side: { control: 'inline-radio', options: ['top', 'bottom', 'left', 'right'] },
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

const grid: CSSProperties = {
  display: 'grid',
  justifyItems: 'center',
  gap: 'var(--space-7)',
  padding: 'var(--space-7)',
};

export const Default: Story = {};

/** Four sides, all measured from the trigger with the same 8px gap. */
export const Sides: Story = {
  render: () => (
    <div style={{ ...grid, gridTemplateColumns: 'repeat(2, auto)' }}>
      <Tooltip label="Above the trigger" side="top">
        <Button variant="secondary">Top</Button>
      </Tooltip>
      <Tooltip label="Below the trigger" side="bottom">
        <Button variant="secondary">Bottom</Button>
      </Tooltip>
      <Tooltip label="Left of the trigger" side="left">
        <Button variant="secondary">Left</Button>
      </Tooltip>
      <Tooltip label="Right of the trigger" side="right">
        <Button variant="secondary">Right</Button>
      </Tooltip>
    </div>
  ),
};

/**
 * Clarifying a clinical identifier. The code stays visible in mono - the tooltip only
 * expands it - and `tabIndex={0}` passes through so the span is reachable by keyboard.
 */
export const OnAnIdentifier: Story = {
  render: () => (
    <p className="or-body">
      Latest reading{' '}
      <Tooltip label="Fasting glucose, LOINC 2339-0" side="bottom" tabIndex={0}>
        <span className="or-mono">2339-0</span>
      </Tooltip>{' '}
      is 7.4 mmol/L - Above range, measured 12 Aug 2026.
    </p>
  ),
};

/**
 * On an icon-only control the tooltip repeats the button's own accessible name, so the
 * information exists twice and never only in the bubble.
 */
export const OnAnIconControl: Story = {
  render: () => (
    <Tooltip label="Export NDJSON" side="bottom">
      <Button variant="ghost" iconLeft="download" aria-label="Export NDJSON" />
    </Tooltip>
  ),
};

/** Full sentences belong in the page, not the bubble; this is the longest it should get. */
export const LongLabel: Story = {
  args: {
    label: 'Shared with Dr. Okafor on 12 Aug 2026',
    side: 'bottom',
    children: <Button variant="ghost">Care team</Button>,
  },
};

/**
 * Below 768px the bubble wraps inside a 220px measure instead of running off the screen,
 * and a tap focuses the trigger, which is what opens it - there is no hover on touch, so
 * the label is never the only place the fact lives.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-6)', padding: 'var(--space-6)' }}>
      <p className="or-body">
        Testina Patientsson, MRN OR-100482. Blood glucose 7.4 mmol/L - Above range.
      </p>
      <Tooltip label="Fasting glucose, LOINC 2339-0" side="bottom">
        <Button variant="secondary" fullWidth>
          What is 2339-0?
        </Button>
      </Tooltip>
    </div>
  ),
};

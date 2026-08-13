import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  parameters: { layout: 'padded' },
  args: { children: 'Connect a clinic' },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'ghost', 'inverse', 'danger'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
  alignItems: 'center',
};

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div style={row}>
      <Button variant="primary" iconRight="arrow-right">
        Connect a clinic
      </Button>
      <Button variant="secondary">Read the docs</Button>
      <Button variant="ghost" iconLeft="download">
        Export NDJSON
      </Button>
      <Button variant="danger" iconLeft="shield-off">
        Revoke access
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={row}>
      <Button size="sm" iconLeft="download">
        Export
      </Button>
      <Button size="md">Add a record</Button>
      <Button size="lg" iconRight="arrow-right">
        Get started
      </Button>
    </div>
  ),
};

/** `inverse` exists for the espresso bands only, where bone is the fill and espresso the ink. */
export const Inverse: Story = {
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
      <Button variant="inverse">Self-host OpenRunic</Button>
      <Button
        variant="secondary"
        style={{ color: 'var(--bone)', borderColor: 'var(--border-inverse)' }}
      >
        Read the licence
      </Button>
    </div>
  ),
};

/** Disabled is 0.42 opacity with no colour change, on both the button and the anchor form. */
export const Disabled: Story = {
  render: () => (
    <div style={row}>
      <Button disabled>Revoke access</Button>
      <Button variant="secondary" disabled>
        Read the docs
      </Button>
      <Button variant="danger" disabled iconLeft="shield-off">
        Revoke access
      </Button>
    </div>
  ),
};

export const AsLink: Story = {
  args: {
    href: '#docs',
    variant: 'secondary',
    iconRight: 'external-link',
    children: 'Read the docs',
  },
};

export const WithIcons: Story = {
  args: { iconLeft: 'file-text', iconRight: 'arrow-right', children: 'Open Testina Patientsson' },
};

/**
 * Below 768px every control takes a 44px touch target and form footers go full-width; from
 * md the exact 32 / 40 / 48px control heights return.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Consent request for Testina Patientsson, MRN OR-100482, care team of Dr. Okafor.
      </p>
      <Button fullWidth iconLeft="check">
        Grant access
      </Button>
      <Button fullWidth variant="secondary">
        Not now
      </Button>
      <Button fullWidth variant="danger" iconLeft="shield-off">
        Revoke access
      </Button>
    </div>
  ),
};

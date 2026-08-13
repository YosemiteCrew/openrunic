import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { SideNav } from './SideNav';
import type { SideNavItem } from './SideNav';

const ITEMS: SideNavItem[] = [
  { label: 'Today', icon: 'sun' },
  { label: 'Records', icon: 'folder-open', badge: 128 },
  { label: 'Results', icon: 'flask-conical', badge: 4 },
  { label: 'Care team', icon: 'users' },
  { label: 'Consent', icon: 'shield-check' },
  { label: 'Settings', icon: 'settings' },
];

const shell: CSSProperties = {
  display: 'flex',
  minHeight: 520,
  background: 'var(--bg-page)',
};

const main: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 'var(--space-3)',
  flex: 1,
  minWidth: 0,
  padding: 'var(--space-5)',
};

const account = (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 'var(--space-3) 12px 0',
      borderTop: 'var(--hairline) solid var(--border-hairline)',
    }}
  >
    <span
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 30,
        height: 30,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-card)',
        fontSize: 'var(--text-caption)',
        fontWeight: 600,
      }}
      aria-hidden="true"
    >
      TP
    </span>
    <span style={{ display: 'grid' }}>
      <b className="or-caption">Testina Patientsson</b>
      <span className="or-caption" style={{ color: 'var(--text-secondary)' }}>
        MRN OR-100482
      </span>
    </span>
  </div>
);

const meta = {
  title: 'Navigation/SideNav',
  component: SideNav,
  parameters: { layout: 'fullscreen' },
  args: { items: ITEMS, active: 'Records' },
} satisfies Meta<typeof SideNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div style={shell}>
      <SideNav {...args} />
      <div style={main}>
        <h1 className="or-h2">Records</h1>
        <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
          128 records for Testina Patientsson, MRN OR-100482. Last sync 12 Aug 2026.
        </p>
      </div>
    </div>
  ),
};

/** The active row is a cream fill with a terracotta icon, plus aria-current and 600 weight. */
export const ActiveRow: Story = {
  ...Default,
  args: { items: ITEMS, active: 'Care team' },
};

/** Counts sit at the end of the row in tabular figures, so the column of digits lines up. */
export const WithCounts: Story = {
  ...Default,
  args: {
    active: 'Results',
    items: [
      { label: 'Today', icon: 'sun' },
      { label: 'Records', icon: 'folder-open', badge: 128 },
      { label: 'Results', icon: 'flask-conical', badge: 4 },
      { label: 'Messages', icon: 'mail', badge: 12 },
      { label: 'Care team', icon: 'users' },
    ],
  },
};

/** The footer is pinned to the bottom of the rail: account row, instance, help link. */
export const WithFooter: Story = {
  ...Default,
  args: { items: ITEMS, active: 'Today', footer: account },
};

/**
 * Below 1024px the rail becomes an off-canvas drawer behind the Menu button. Opening it
 * moves focus to Close, traps Tab inside the drawer, dims the page behind an espresso
 * scrim, and Escape or the scrim shuts it and hands focus back to the button.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (args) => (
    <div style={{ ...shell, display: 'grid', gap: 0 }}>
      <div style={{ padding: 'var(--space-4)' }}>
        <SideNav {...args} footer={account} />
      </div>
      <div style={{ ...main, padding: '0 var(--space-4) var(--space-5)' }}>
        <h1 className="or-h3">Results</h1>
        <p className="or-body">7.4 mmol/L - Above range</p>
        <p className="or-mono">Observation/8867-4</p>
        <Button size="sm" variant="secondary" iconLeft="download">
          Export NDJSON
        </Button>
      </div>
    </div>
  ),
};

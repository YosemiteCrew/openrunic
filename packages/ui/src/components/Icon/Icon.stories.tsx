import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './Icon';

const meta = {
  title: 'Brand/Icon',
  component: Icon,
  parameters: { layout: 'padded' },
  args: { name: 'heart-pulse', size: 20 },
  argTypes: {
    name: { control: 'text' },
    size: { control: { type: 'number', min: 12, max: 48, step: 2 } },
    color: { control: 'text' },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-5)',
  alignItems: 'center',
};

const pair: CSSProperties = { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' };

export const Default: Story = {};

/** The set the clinical shell uses. Every glyph is geometric, butt-capped and 1.75px. */
export const Set: Story = {
  render: () => (
    <div style={row}>
      {[
        'heart-pulse',
        'folder-open',
        'calendar-days',
        'file-text',
        'users',
        'shield-check',
        'activity',
        'settings',
      ].map((name) => (
        <span key={name} style={{ ...pair, flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Icon name={name} size={22} />
          <span className="or-mono" style={{ color: 'var(--text-secondary)' }}>
            {name}
          </span>
        </span>
      ))}
    </div>
  ),
};

/** 16px for dense table rows, 20px for body copy and controls, 24 to 32 for headers. */
export const Sizes: Story = {
  render: () => (
    <div style={row}>
      {[16, 20, 24, 32].map((size) => (
        <span key={size} style={pair}>
          <Icon name="activity" size={size} />
          <span className="or-mono" style={{ color: 'var(--text-secondary)' }}>
            {size}px
          </span>
        </span>
      ))}
    </div>
  ),
};

/**
 * Icons inherit currentColor, so they take whatever ink the context sets. The accent pair
 * uses `--text-link`, the accent's ink weight, rather than `--terracotta` itself: the raw
 * hue is 3.9:1 on bone, which is fine for the 20px mark and under AA for the word beside
 * it, and an icon should never be set in ink its own label cannot use.
 */
export const Ink: Story = {
  render: () => (
    <div style={row}>
      <span style={{ ...pair, color: 'var(--espresso)' }}>
        <Icon name="file-text" />
        <span className="or-small">Body ink</span>
      </span>
      <span style={{ ...pair, color: 'var(--text-secondary)' }}>
        <Icon name="clock" />
        <span className="or-small">Secondary ink</span>
      </span>
      <span style={{ ...pair, color: 'var(--text-link)' }}>
        <Icon name="shield-check" />
        <span className="or-small">Accent ink</span>
      </span>
    </div>
  ),
};

/**
 * Status is never colour alone. A meaningful icon carries a `label` and sits beside real
 * text, so the reading is identical for a screen reader and for anyone who cannot separate
 * olive from terracotta.
 */
export const StatusNeverColourAlone: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <span style={pair}>
        <Icon name="check" color="var(--status-success)" label="In range" />
        <span className="or-body">Haemoglobin A1c 5.4 percent - In range</span>
      </span>
      <span style={pair}>
        <Icon name="triangle-alert" color="var(--status-danger)" label="Above range" />
        <span className="or-body">Fasting glucose 7.4 mmol/L - Above range</span>
      </span>
      <span style={pair}>
        <Icon name="info" color="var(--status-neutral)" label="Informational" />
        <span className="or-body">Collected 12 Aug 2026 by Dr. Okafor</span>
      </span>
    </div>
  ),
};

/** A typo degrades to an empty box of the right size, never a crash and never a broken glyph. */
export const UnknownSlug: Story = {
  render: () => (
    <div style={row}>
      <span style={pair}>
        <Icon name="heart-pulse" size={24} />
        <span className="or-mono">heart-pulse</span>
      </span>
      <span style={pair}>
        <Icon name="heartpulse" size={24} />
        <span className="or-mono" style={{ color: 'var(--text-secondary)' }}>
          heartpulse (unknown)
        </span>
      </span>
    </div>
  ),
};

/**
 * Icon and label stay together as one unit when a dense legend wraps on a phone: the pair
 * never splits across two lines, so the reading survives the narrower column.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-overline" style={{ color: 'var(--text-secondary)' }}>
        Testina Patientsson - MRN OR-100482
      </p>
      <div style={{ ...row, gap: 'var(--space-4)' }}>
        <span style={{ ...pair, whiteSpace: 'nowrap' }}>
          <Icon name="check" size={16} color="var(--status-success)" label="In range" />
          <span className="or-small">In range</span>
        </span>
        <span style={{ ...pair, whiteSpace: 'nowrap' }}>
          <Icon name="triangle-alert" size={16} color="var(--status-danger)" label="Above range" />
          <span className="or-small">Above range</span>
        </span>
        <span style={{ ...pair, whiteSpace: 'nowrap' }}>
          <Icon name="minus" size={16} color="var(--status-neutral)" label="No result" />
          <span className="or-small">No result</span>
        </span>
      </div>
    </div>
  ),
};

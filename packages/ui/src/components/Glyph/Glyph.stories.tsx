import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Glyph } from './Glyph';

/**
 * The mark is a shipped file, never redrawn. `glyph.svg` is vendored into this package and
 * inlined by the bundler, so the mark renders with nothing to host and no network request.
 * `basePath` still points at your own copy when you serve it.
 */
const meta = {
  title: 'Brand/Glyph',
  component: Glyph,
  parameters: { layout: 'padded' },
  args: { size: 48 },
  argTypes: {
    size: { control: { type: 'number', min: 16, max: 160, step: 8 } },
    color: { control: 'text' },
    animate: { control: 'boolean' },
  },
} satisfies Meta<typeof Glyph>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-6)',
  alignItems: 'center',
};

const panel: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 160,
  height: 160,
  borderRadius: 'var(--radius-card)',
};

export const Default: Story = {};

/** 16px is the floor. Below that use the favicon builds, never a scaled-down glyph. */
export const Sizes: Story = {
  render: () => (
    <div style={row}>
      {[16, 32, 48, 96].map((size) => (
        <span key={size} style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-2)' }}>
          <Glyph size={size} />
          <span className="or-mono" style={{ color: 'var(--text-secondary)' }}>
            {size}px
          </span>
        </span>
      ))}
    </div>
  ),
};

/** A terracotta glyph is allowed as an accent. A terracotta wordmark never is. */
export const Ink: Story = {
  render: () => (
    <div style={row}>
      <div
        style={{ ...panel, background: 'var(--bone)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
      >
        <Glyph size={58} color="var(--espresso)" />
      </div>
      <div style={{ ...panel, background: 'var(--espresso)' }}>
        <Glyph size={58} color="var(--bone)" />
      </div>
      <div style={{ ...panel, background: 'var(--cream)' }}>
        <Glyph size={58} color="var(--terracotta)" />
      </div>
    </div>
  ),
};

/**
 * The signature loading affordance: the six carved strokes come up in turn, 60ms apart.
 * Use it sparingly, and never as decoration. Under `prefers-reduced-motion` the sweep is
 * dropped and the mark stands still at full strength.
 */
export const Loading: Story = {
  args: { animate: true, size: 56 },
  render: (args) => (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-4)' }}>
      <Glyph {...args} />
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Loading records for Testina Patientsson, MRN OR-100482
      </p>
    </div>
  ),
};

/** Large in a cream or espresso panel, the glyph is the only decorative graphic the system uses. */
export const Decorative: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-8) var(--space-6)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--surface-inverse)',
        color: 'var(--text-inverse)',
      }}
    >
      <Glyph size={96} color="var(--bone)" />
      <h2 className="or-h3" style={{ color: 'var(--text-inverse)' }}>
        No records yet
      </h2>
      <p className="or-body" style={{ color: 'var(--text-inverse-secondary)' }}>
        Connect a clinic and the first bundle lands here.
      </p>
    </div>
  ),
};

/**
 * In an empty state the mark scales with the panel rather than the viewport: 64px on a
 * phone, 96px from md, so the copy below it keeps the leading role at every width.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-7) var(--space-5)',
        textAlign: 'center',
      }}
    >
      <Glyph size={64} color="var(--terracotta)" />
      <h2 className="or-h3">Nothing to show yet</h2>
      <p className="or-body" style={{ color: 'var(--text-secondary)' }}>
        Dr. Okafor has not shared an observation for this patient since 12 Aug 2026.
      </p>
    </div>
  ),
};

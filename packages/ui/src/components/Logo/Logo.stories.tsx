import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Logo } from './Logo';

/**
 * The lockups are shipped files, never redrawn. Copy the eight builds from the design
 * system's `assets/logo/` into the app's public directory and point `basePath` at that
 * folder; these stories use the default `assets/logo`, so a lockup only appears once the
 * files are in place. Each specimen below names the build it resolves to.
 */
const meta = {
  title: 'Brand/Logo',
  component: Logo,
  parameters: { layout: 'padded' },
  args: { variant: 'horizontal', theme: 'ink', height: 32 },
  argTypes: {
    variant: { control: 'inline-radio', options: ['horizontal', 'stacked', 'glyph'] },
    theme: { control: 'inline-radio', options: ['ink', 'light', 'dark'] },
    height: { control: { type: 'number', min: 16, max: 160, step: 4 } },
  },
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-7)',
  alignItems: 'flex-end',
};

const specimen: CSSProperties = {
  display: 'grid',
  justifyItems: 'start',
  gap: 'var(--space-3)',
};

const caption: CSSProperties = { color: 'var(--text-secondary)' };

export const Default: Story = {};

/** Three builds: the horizontal lockup for chrome, the stacked one for end cards, the mark alone. */
export const Variants: Story = {
  render: () => (
    <div style={row}>
      <span style={specimen}>
        <Logo variant="horizontal" height={32} />
        <span className="or-mono" style={caption}>
          lockup-horizontal.svg
        </span>
      </span>
      <span style={specimen}>
        <Logo variant="stacked" height={96} />
        <span className="or-mono" style={caption}>
          lockup-stacked-light.svg
        </span>
      </span>
      <span style={specimen}>
        <Logo variant="glyph" height={40} />
        <span className="or-mono" style={caption}>
          glyph.svg
        </span>
      </span>
    </div>
  ),
};

/**
 * `theme="ink"` inherits currentColor, which is how one build serves espresso on bone,
 * bone on espresso, and a terracotta glyph. The light and dark builds bake their colours in.
 */
export const Themes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div
        style={{
          padding: 'var(--space-5)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--bg-page)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
          color: 'var(--espresso)',
        }}
      >
        <Logo variant="horizontal" theme="ink" height={28} />
      </div>
      <div
        style={{
          padding: 'var(--space-5)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--surface-inverse)',
          color: 'var(--bone)',
        }}
      >
        <Logo variant="horizontal" theme="ink" height={28} />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-6)',
          alignItems: 'center',
          padding: 'var(--space-5)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--surface-card)',
          color: 'var(--terracotta)',
        }}
      >
        <Logo variant="glyph" theme="ink" height={34} />
        <span className="or-small" style={caption}>
          A terracotta glyph is allowed as an accent. A terracotta wordmark never is.
        </span>
      </div>
    </div>
  ),
};

/** Minimums: glyph 16px, horizontal lockup 120px wide, stacked 80px wide. */
export const Sizes: Story = {
  render: () => (
    <div style={row}>
      {[24, 32, 48].map((height) => (
        <span key={height} style={specimen}>
          <Logo height={height} />
          <span className="or-mono" style={caption}>
            {height}px tall
          </span>
        </span>
      ))}
    </div>
  ),
};

/** The stacked lockup on an espresso end card, where the dark build carries bone ink. */
export const OnEspresso: Story = {
  globals: { backgrounds: { value: 'espresso' } },
  render: () => (
    <div
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: 'var(--space-5)',
        padding: 'var(--space-8) var(--space-6)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--surface-inverse)',
        textAlign: 'center',
      }}
    >
      <Logo variant="stacked" theme="dark" height={120} />
      <p className="or-body" style={{ color: 'var(--text-inverse-secondary)' }}>
        Self-hosted health records. Every clinical rule published.
      </p>
    </div>
  ),
};

/**
 * In app chrome the lockup drops to 24px on a phone and returns to 30px from md, keeping
 * the clearspace of half a glyph height on every side at both widths.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: 'var(--hairline) solid var(--border-hairline)',
        color: 'var(--espresso)',
      }}
    >
      <Logo variant="horizontal" theme="ink" height={24} />
      <span className="or-small" style={caption}>
        Testina Patientsson
      </span>
    </header>
  ),
};

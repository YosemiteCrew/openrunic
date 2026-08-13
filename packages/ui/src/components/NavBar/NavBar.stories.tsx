import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { NavBar } from './NavBar';

const SECTIONS = ['Product', 'Docs', 'Open source', 'Blog'];

const meta = {
  title: 'Navigation/NavBar',
  component: NavBar,
  parameters: { layout: 'fullscreen' },
  args: { items: SECTIONS, active: 'Docs' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['bone', 'espresso'] },
  },
} satisfies Meta<typeof NavBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The espresso tone is for dark bands: bone ink, inverse call to action, same shape. */
export const Espresso: Story = {
  globals: { backgrounds: { value: 'espresso' } },
  args: { tone: 'espresso' },
};

/** Active is terracotta ink plus a 1.5px terracotta rule under the label, never colour alone. */
export const ActiveSection: Story = {
  args: { active: 'Open source' },
};

/** The default button is a placeholder; docs surfaces usually swap in their own pair. */
export const CustomCta: Story = {
  args: {
    active: 'Docs',
    cta: (
      <>
        <Button variant="ghost" size="sm" iconLeft="github">
          Star on GitHub
        </Button>
        <Button variant="primary" size="sm" iconRight="arrow-right">
          Read the docs
        </Button>
      </>
    ),
  },
};

/** With no sections the bar is just the lockup and the call to action. */
export const LockupOnly: Story = {
  args: { items: [], active: undefined },
};

/** A docs page under the bar, so the hairline and the 72px height read against real content. */
export const OnAPage: Story = {
  render: (args) => (
    <div style={{ minHeight: 360, background: 'var(--bg-page)' }}>
      <NavBar {...args} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--space-3)',
          maxWidth: 'var(--content-max)',
          margin: '0 auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <p className="or-overline" style={{ color: 'var(--text-secondary)' }}>
          FHIR R4
        </p>
        <h1 className="or-h1">Observations</h1>
        <p className="or-body-lg" style={{ maxWidth: 620, color: 'var(--text-secondary)' }}>
          Every reading is stored as an Observation resource. Blood glucose for Testina Patientsson,
          MRN OR-100482, reads 7.4 mmol/L - Above range on 12 August 2026.
        </p>
        <p className="or-mono">Observation/8867-4</p>
      </div>
    </div>
  ),
};

/**
 * Below 768px the sections and the call to action collapse behind the menu button, which
 * carries aria-expanded and a 44px touch target. Escape closes it, and choosing a section
 * closes it too, so the sheet never strands a phone user.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (args) => (
    <div style={{ minHeight: 420, background: 'var(--bg-page)' }}>
      <NavBar {...args} />
      <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)' }}>
        <h1 className="or-h2">Records</h1>
        <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
          Open the menu to move between sections. Nothing here depends on hover.
        </p>
      </div>
    </div>
  ),
};

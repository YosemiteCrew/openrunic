import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Card } from './Card';

const meta = {
  title: 'Surfaces/Card',
  component: Card,
  parameters: { layout: 'padded' },
  args: {
    overline: 'Vitals',
    title: 'Blood pressure',
    children: <p className="or-body">118 / 74 mmHg, measured this morning. Within range.</p>,
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['cream', 'bone', 'white', 'inverse'] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithFooter: Story = {
  args: {
    footer: (
      <Button variant="ghost" size="sm" iconRight="arrow-right">
        History
      </Button>
    ),
  },
};

/** The paper steps. Bone is the page, cream the card, white the fields and data tables. */
export const Tones: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-4)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}
    >
      <Card overline="Vitals" title="Blood pressure">
        <p className="or-body">118 / 74 mmHg, in range.</p>
      </Card>
      <Card tone="bone" overline="Source" title="Ridgeview Clinic">
        <p className="or-body">Connected 12 August 2026.</p>
      </Card>
      <Card tone="white" overline="Identifier" title="Observation">
        <p className="or-mono">Observation/8867-4</p>
      </Card>
      <Card tone="inverse" overline="Self-hosted" title="Your instance">
        <p className="or-body">Every clinical rule is published. Nothing leaves your server.</p>
      </Card>
    </div>
  ),
};

/** At most one raised layer per screen; the shadow is espresso-tinted, never grey. */
export const Raised: Story = {
  args: { raised: true },
};

/** A white card inside a cream one is permitted only for data tables and fields. */
export const NestedDataSurface: Story = {
  render: () => (
    <Card overline="Care team" title="Access granted">
      <p className="or-body">Dr. Okafor can read records for Testina Patientsson, MRN OR-100482.</p>
      <Card tone="white" style={{ gap: 'var(--space-2)' }}>
        <p className="or-caption" style={{ color: 'var(--text-secondary)' }}>
          Last read
        </p>
        <p className="or-mono">12 Aug 2026, 07:12 - Observation/8867-4</p>
      </Card>
    </Card>
  ),
};

/**
 * Cards drop to 16px padding below 768px and take the design system's 24px `--card-pad`
 * from md up; the grid collapses to a single column on phones.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-3)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        padding: 'var(--space-4)',
      }}
    >
      <Card overline="Today" title="Blood glucose">
        <p className="or-body">7.4 mmol/L - Above range</p>
      </Card>
      <Card overline="Today" title="Resting heart rate">
        <p className="or-body">62 bpm - In range</p>
      </Card>
      <Card
        overline="Records"
        title="Ridgeview Clinic"
        footer={
          <Button variant="ghost" size="sm" fullWidth>
            Open records
          </Button>
        }
      >
        <p className="or-body">4 new documents since 12 August 2026.</p>
      </Card>
    </div>
  ),
};

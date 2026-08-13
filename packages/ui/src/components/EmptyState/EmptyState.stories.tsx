import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Card } from '../Card';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' },
  args: {
    title: 'No records yet',
    message: 'Connect a clinic or upload a document and it will appear here.',
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default mark is the brand glyph, loaded from `glyphBasePath` - the consuming app
 * serves `assets/logo/glyph.svg` itself, because brand marks are shipped files and are
 * never redrawn in code. Point `glyphBasePath` wherever the app hosts them.
 */
export const Default: Story = {
  args: {
    action: (
      <Button variant="primary" iconLeft="plus">
        Connect a clinic
      </Button>
    ),
  },
};

/** A Lucide slug replaces the glyph when the state is about one kind of thing. */
export const WithIcon: Story = {
  args: {
    icon: 'file-text',
    title: 'No documents in this record',
    message: 'Upload a PDF or ask Ridgeview Clinic to send one. It will appear here.',
    action: (
      <Button variant="secondary" iconLeft="upload">
        Upload a document
      </Button>
    ),
  },
};

/** Search with no hits. State what was searched, then the way out of it. */
export const NoResults: Story = {
  args: {
    icon: 'search',
    title: 'No records match "glucose 2024"',
    message: 'Try a wider date range, or search by code such as Observation/8867-4.',
    action: (
      <Button variant="ghost" iconLeft="rotate-ccw">
        Clear filters
      </Button>
    ),
  },
};

/** The fact alone is enough when there is nothing for the reader to do yet. */
export const TitleOnly: Story = {
  args: { icon: 'shield-check', title: 'No one has access to your records', message: undefined },
};

/** In a card, the panel keeps its own padding and the card keeps its title. */
export const InsideCard: Story = {
  render: () => (
    <Card overline="Care team" title="Grants">
      <EmptyState
        icon="users"
        title="No care team yet"
        message="Grant access to a clinician and they will be listed here, with every read in your audit log."
        action={
          <Button variant="primary" iconLeft="user-plus">
            Grant access
          </Button>
        }
      />
    </Card>
  ),
};

/** First run, on the espresso band the marketing surface uses. */
export const OnEspresso: Story = {
  globals: { backgrounds: { value: 'espresso' } },
  render: () => (
    <Card tone="inverse">
      <EmptyState
        icon="server"
        title="No instance connected"
        message="Point the app at your self-hosted OpenRunic server to start. Nothing leaves it."
        action={
          <Button variant="inverse" iconRight="arrow-right">
            Connect an instance
          </Button>
        }
      />
    </Card>
  ),
};

/**
 * Below 768px the panel drops to the 32/16px rhythm and the message wraps inside the
 * phone's measure; from md the design system's 64/24px padding returns. The action keeps
 * its 44px touch target either way.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  args: {
    icon: 'inbox',
    title: 'No records for Testina Patientsson',
    message: 'MRN OR-100482 has nothing filed since 12 August 2026. Connect a source to fill it.',
    action: (
      <Button variant="primary" iconLeft="plus">
        Connect a clinic
      </Button>
    ),
  },
};

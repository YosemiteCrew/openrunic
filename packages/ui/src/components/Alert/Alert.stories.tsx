import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Alert } from './Alert';

const meta = {
  title: 'Feedback/Alert',
  component: Alert,
  parameters: { layout: 'padded' },
  args: {
    tone: 'info',
    title: 'This record is not verified',
    message:
      'Ridgeview Clinic sent it without a signature. Check the source before you rely on it.',
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['info', 'caution', 'danger', 'success'] },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

/* The alert belongs in the content flow, so the stories give it a column to sit in. */
const column: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-3)',
  maxWidth: '640px',
};

export const Default: Story = {};

/** info is the hazelnut wash: something is true and worth knowing, and nothing is wrong. */
export const Info: Story = {
  args: {
    tone: 'info',
    title: 'Import queued',
    message: 'Ridgeview Clinic is sending 4 documents. They will appear in Records.',
  },
};

/**
 * caution is the caramel wash with espresso ink. Caramel fails AA for body text, so it
 * tints the paper and draws the icon only; the ink stays espresso.
 */
export const Caution: Story = {
  args: {
    tone: 'caution',
    title: 'Unverified source',
    message: 'This record came from an outside clinic. Check the source before you rely on it.',
  },
};

/** danger is the only tone that interrupts a screen reader, so it is kept for things that
 *  went wrong or readings that are out of range. */
export const Danger: Story = {
  args: {
    tone: 'danger',
    title: 'Blood glucose is above range',
    message: '7.4 mmol/L for Testina Patientsson, measured 12 Aug 2026. Repeat the reading.',
  },
};

/** success confirms work that has finished and will stay finished. */
export const Success: Story = {
  args: {
    tone: 'success',
    title: 'Record shared',
    message: 'Dr. Amara Okafor can now view the 2026 labs for MRN OR-100482.',
  },
};

/** One action at most, and it repeats the next step the message already named. */
export const WithAction: Story = {
  args: {
    tone: 'caution',
    title: 'Unverified source',
    message: 'This record came from an outside clinic. Check the source before you rely on it.',
    action: (
      <Button variant="ghost" size="sm">
        View the source
      </Button>
    ),
  },
};

/**
 * The dismiss control appears only with `onClose`. A banner the reader can close is one
 * the app does not need to show again; leave it off when the fact still stands.
 */
export const Dismissible: Story = {
  args: {
    tone: 'info',
    title: 'Export started',
    message: 'The NDJSON bundle for MRN OR-100482 is being prepared.',
    onClose: () => {},
  },
};

/**
 * Colour is never the signal on its own. Each tone renders its word for a screen reader
 * and its own icon shape, and the title states the fact in plain words.
 */
export const Tones: Story = {
  render: () => (
    <div style={column}>
      <Alert
        tone="info"
        title="Import queued"
        message="Ridgeview Clinic is sending 4 documents. They will appear in Records."
      />
      <Alert
        tone="caution"
        title="Unverified source"
        message="This record came from an outside clinic. Check the source before you rely on it."
      />
      <Alert
        tone="danger"
        title="Blood glucose is above range"
        message="7.4 mmol/L for Testina Patientsson, measured 12 Aug 2026. Repeat the reading."
      />
      <Alert
        tone="success"
        title="Record shared"
        message="Dr. Amara Okafor can now view the 2026 labs for MRN OR-100482."
      />
    </div>
  ),
};

/**
 * Below 768px the banner takes the padding of a phone and the dismiss control takes a 44px
 * touch target; from md the wider padding and the 32px control box return.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
      <Alert
        tone="caution"
        title="Unverified source"
        message="This record came from an outside clinic. Check the source before you rely on it."
        action={
          <Button variant="ghost" size="sm">
            View the source
          </Button>
        }
        onClose={() => {}}
      />
      <Alert
        tone="danger"
        title="Blood glucose is above range"
        message="7.4 mmol/L for Testina Patientsson, measured 12 Aug 2026."
        onClose={() => {}}
      >
        <p className="or-small" style={{ margin: 0 }}>
          Recorded as Observation/8867-4.
        </p>
      </Alert>
    </div>
  ),
};

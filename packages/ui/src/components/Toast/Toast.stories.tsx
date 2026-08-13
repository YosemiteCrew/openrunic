import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Toast } from './Toast';

const meta = {
  title: 'Feedback/Toast',
  component: Toast,
  parameters: { layout: 'padded' },
  args: {
    tone: 'success',
    title: 'Record shared',
    message: 'Dr. Okafor can now view your 2026 labs.',
    onClose: () => {},
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['info', 'success', 'danger'] },
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/* The consumer owns placement. This is one honest version of it: a bottom-right rail on
   desktop, a full-width column on phones. */
const rail: CSSProperties = {
  display: 'grid',
  justifyItems: 'end',
  gap: 'var(--space-3)',
};

export const Default: Story = {};

/** info stays polite, success confirms, danger interrupts. The wording carries the tone. */
export const Tones: Story = {
  render: () => (
    <div style={rail}>
      <Toast
        tone="info"
        title="Import queued"
        message="Ridgeview Clinic is sending 4 documents. They will appear in Records."
      />
      <Toast
        tone="success"
        title="Record shared"
        message="Dr. Okafor can now view your 2026 labs."
      />
      <Toast
        tone="danger"
        title="Upload failed"
        message="The file is larger than 25 MB. Try a smaller export."
      />
    </div>
  ),
};

/** One action at most, and it repeats the next step the message already named. */
export const WithAction: Story = {
  args: {
    tone: 'danger',
    title: 'Grant revoked',
    message: 'Dr. Okafor no longer has access. The change is in your audit log.',
    action: (
      <Button variant="inverse" size="sm">
        Undo
      </Button>
    ),
  },
};

/** Without `onClose` there is no dismiss control, for toasts the app clears on a timer. */
export const WithoutDismiss: Story = {
  args: {
    tone: 'info',
    title: 'Export started',
    message: 'Your NDJSON bundle for MRN OR-100482 is being prepared.',
    onClose: undefined,
  },
};

/** Title alone is enough when the fact needs no second sentence. */
export const TitleOnly: Story = {
  args: { message: undefined, title: 'Observation/8867-4 saved' },
};

/**
 * Stacking is the consumer's job. Newest last, and never more than three at once: a fourth
 * toast means the app is narrating instead of confirming.
 */
export const Stack: Story = {
  render: () => (
    <div style={rail}>
      <Toast tone="success" title="Ridgeview Clinic connected" onClose={() => {}} />
      <Toast
        tone="info"
        title="12 records imported"
        message="Latest: blood glucose, 12 Aug 2026."
        onClose={() => {}}
      />
      <Toast
        tone="danger"
        title="One record could not be read"
        message="The source sent an unsupported format. OpenRunic kept the rest."
        onClose={() => {}}
      />
    </div>
  ),
};

/**
 * Below 768px the toast spans the rail it is given and the dismiss control takes a 44px
 * touch target; from md the 420px cap and the 32px control box return.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
      <Toast
        tone="success"
        title="Record shared"
        message="Dr. Okafor can now view your 2026 labs for Testina Patientsson, MRN OR-100482."
        action={
          <Button variant="inverse" size="sm">
            View grant
          </Button>
        }
        onClose={() => {}}
      />
      <Toast
        tone="danger"
        title="Blood glucose is above range"
        message="7.4 mmol/L - Above range, measured 12 Aug 2026."
        onClose={() => {}}
      />
    </div>
  ),
};

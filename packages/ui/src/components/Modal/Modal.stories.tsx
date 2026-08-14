import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Card } from '../Card';
import { Modal } from './Modal';

const meta = {
  title: 'Surfaces/Modal',
  component: Modal,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    title: 'Revoke access for Dr. Amara Okafor?',
    description: 'She will lose access to your records immediately. You can grant it again later.',
    onClose: () => {},
  },
  argTypes: {
    width: { control: { type: 'number' } },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

const revokeActions = (
  <>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger" iconLeft="shield-off">
      Revoke access
    </Button>
  </>
);

/** The canonical use: a destructive confirmation, cancel first and confirm last. */
export const Default: Story = {
  args: { width: 440, footer: revokeActions },
};

/**
 * Detail belongs in a white surface inside the panel, which is the one place a nested
 * card is allowed: data and fields.
 */
export const WithContent: Story = {
  args: {
    width: 520,
    title: 'Grant access to Ridgeview Clinic?',
    description: 'They can read the records below until 12 November 2026. You can end it sooner.',
    children: (
      <Card tone="white" overline="Scope" title="Testina Patientsson">
        <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
          MRN OR-100482
        </p>
        <p className="or-body">
          Observations, medications and clinic letters from 12 August 2026 onward.
        </p>
        <p className="or-mono">Observation/8867-4</p>
      </Card>
    ),
    footer: (
      <>
        <Button variant="ghost">Not now</Button>
        <Button variant="primary" iconLeft="check">
          Grant access
        </Button>
      </>
    ),
  },
};

/** No `onClose`, so there is no close control and no Escape exit: the decision must be made. */
export const RequiredDecision: Story = {
  args: {
    width: 460,
    title: 'Your session expired',
    description: 'Sign in again to keep reading records. Nothing you entered was lost.',
    onClose: undefined,
    footer: (
      <Button variant="primary" iconRight="arrow-right">
        Sign in again
      </Button>
    ),
  },
};

/** Title and copy only, for an acknowledgement that carries no action. */
export const CopyOnly: Story = {
  args: {
    title: 'Grant revoked',
    description: 'Dr. Okafor no longer has access. The change is in your audit log.',
  },
};

/** Wider panels are for read-heavy content; the sheet still fills a phone screen. */
export const Wide: Story = {
  args: {
    width: 720,
    title: 'Export your records',
    description: 'The export is an NDJSON bundle of every FHIR resource on this instance.',
    children: (
      <Card tone="white" overline="Bundle" title="128 records across 6 sources">
        <p className="or-body">Last built 12 Aug 2026, 07:12. Ready in about a minute.</p>
      </Card>
    ),
    footer: (
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary" iconLeft="download">
          Export NDJSON
        </Button>
      </>
    ),
  },
};

/**
 * The real flow: focus moves into the panel on open, Tab cycles inside it, Escape closes,
 * and focus lands back on the button that opened it.
 */
export const FromATrigger: Story = {
  args: { open: false, width: 440 },
  render: (args) => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <Button variant="danger" iconLeft="shield-off" onClick={() => setOpen(true)}>
          Revoke access
        </Button>
        <Modal
          {...args}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" iconLeft="shield-off" onClick={() => setOpen(false)}>
                Revoke access
              </Button>
            </>
          }
        />
      </div>
    );
  },
};

/**
 * Below 768px the panel is a full-screen sheet with no radius and no shadow, and the
 * footer actions fill the row so both clear the 44px touch target. From md it returns to
 * a centred panel at `width` with the overlay shadow and a 16px radius.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  args: { width: 440, footer: revokeActions },
};

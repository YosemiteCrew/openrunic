import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from './Switch';

const meta = {
  title: 'Forms/Switch',
  component: Switch,
  parameters: { layout: 'padded' },
  args: { label: 'Sync with wearable', hint: 'Every 15 minutes.' },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

const panel: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-5)',
  maxWidth: '420px',
};

export const Default: Story = {};

export const On: Story = {
  args: { checked: true },
};

export const WithoutHint: Story = {
  args: { hint: undefined, checked: true },
};

/** Disabled is 0.42 opacity with no colour change, in either position. */
export const Disabled: Story = {
  args: {
    label: 'Share with the national registry',
    hint: 'Your clinic has not enabled registry sharing.',
    disabled: true,
  },
};

export const DisabledOn: Story = {
  args: {
    label: 'Keep an audit log',
    hint: 'Always on. OpenRunic records every access to your data.',
    checked: true,
    disabled: true,
  },
};

/** Live: the setting applies on the flip, so there is no save button anywhere near it. */
export const Interactive: Story = {
  render: function SettingsPanelStory() {
    const [sync, setSync] = useState(true);
    const [alerts, setAlerts] = useState(false);

    return (
      <div style={panel}>
        <Switch
          label="Sync with wearable"
          hint="Every 15 minutes."
          checked={sync}
          onChange={() => setSync(!sync)}
        />
        <Switch
          label="Out-of-range alerts"
          hint="Notify me when a reading leaves the reference range."
          checked={alerts}
          onChange={() => setAlerts(!alerts)}
        />
        <Switch
          label="Keep an audit log"
          hint="Always on. OpenRunic records every access to your data."
          checked
          disabled
        />
      </div>
    );
  },
};

/**
 * Below 768px the 42x24 track keeps its size but grows a transparent 44px hit area, so the
 * switch is reachable with a thumb without changing how it looks.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-5)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Settings for Testina Patientsson, MRN OR-100482.
      </p>
      <Switch label="Sync with wearable" hint="Every 15 minutes." checked />
      <Switch
        label="Out-of-range alerts"
        hint="Last triggered by glucose 7.4 mmol/L, above range, on 12 Aug 2026."
      />
      <Switch
        label="Share with Dr. Okafor"
        hint="Revoking access takes effect immediately."
        checked
      />
    </div>
  ),
};

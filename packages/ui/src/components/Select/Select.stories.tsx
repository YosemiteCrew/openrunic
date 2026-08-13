import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from './Select';

const meta = {
  title: 'Forms/Select',
  component: Select,
  parameters: { layout: 'padded' },
  args: {
    label: 'Care team',
    options: ['Primary care', 'Cardiology', 'Endocrinology'],
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const stack: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-4)',
  maxWidth: '380px',
};

/* The disabled-row contrast exemption, explained in full in Checkbox.stories.tsx: WCAG 1.4.3
   exempts text inside an inactive component, and axe cannot see it because the 0.42 opacity
   sits on the wrapper. Narrowed to the disabled field's subtree; nothing else is exempt. */
const disabledRowContrast = {
  a11y: { config: { rules: [{ id: 'color-contrast', selector: ':not(.or-select--disabled *)' }] } },
};

export const Default: Story = {};

export const WithHint: Story = {
  args: { hint: 'Only this team sees the record. You can revoke access at any time.' },
};

/** Pairs keep the stored value stable while the words on screen stay readable. */
export const ValueLabelPairs: Story = {
  args: {
    label: 'Units',
    defaultValue: 'mmol-l',
    hint: 'Applies to every glucose reading.',
    options: [
      { value: 'mmol-l', label: 'Metric (mmol/L)' },
      { value: 'mg-dl', label: 'US (mg/dL)' },
    ],
  },
};

/** Disabled is 0.42 opacity with no colour change. */
export const Disabled: Story = {
  parameters: disabledRowContrast,
  args: {
    label: 'Source',
    defaultValue: 'Clinic upload',
    options: ['Clinic upload', 'Wearable', 'Self-reported'],
    hint: 'Set by the clinic that sent the record.',
    disabled: true,
  },
};

export const FieldSet: Story = {
  render: () => (
    <div style={stack}>
      <Select
        label="Care team"
        options={['Primary care', 'Cardiology', 'Endocrinology']}
        defaultValue="Cardiology"
      />
      <Select
        label="Clinician"
        options={['Dr. Okafor', 'Dr. Lindqvist', 'Dr. Adeyemi']}
        hint="Named on Testina Patientsson's grant."
      />
      <Select label="Range" options={['Last 7 days', 'Last 30 days', 'Last 12 months']} />
    </div>
  ),
};

/**
 * Below 768px the select grows to a 44px touch target and its value stays at 16px, the size
 * at which iOS Safari stops zooming the page on focus. From md the 40px control height returns.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Filter the record list for Testina Patientsson, MRN OR-100482.
      </p>
      <Select label="Care team" options={['Primary care', 'Cardiology', 'Endocrinology']} />
      <Select
        label="Range"
        options={['Last 7 days', 'Last 30 days', 'Last 12 months']}
        defaultValue="Last 30 days"
        hint="Records outside the range stay in the audit log."
      />
    </div>
  ),
};

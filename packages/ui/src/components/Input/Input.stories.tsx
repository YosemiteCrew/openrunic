import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './Input';

const meta = {
  title: 'Forms/Input',
  component: Input,
  parameters: { layout: 'padded' },
  args: { label: 'Work email', placeholder: 'you@clinic.org' },
} satisfies Meta<typeof Input>;

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
  a11y: { config: { rules: [{ id: 'color-contrast', selector: ':not(.or-input--disabled *)' }] } },
};

export const Default: Story = {};

export const WithIcon: Story = {
  args: { iconLeft: 'mail', defaultValue: 'okafor@clinic.org' },
};

/** The hint is quiet hazelnut and is read out as the field's description, never its name. */
export const WithHint: Story = {
  args: {
    label: 'Patient ID',
    placeholder: 'OR-100482',
    hint: 'FHIR Patient resource id.',
    mono: true,
  },
};

/** An error states the fact, then the next action. Never colour alone: the icon and the
 *  sentence carry the meaning as much as the red does. */
export const WithError: Story = {
  args: {
    label: 'Systolic',
    suffix: 'mmHg',
    defaultValue: '245',
    error: 'Enter a value between 70 and 220.',
    hint: 'Measured sitting, right arm.',
  },
};

/** A trailing affix carries the unit so the value itself stays a bare number. */
export const WithSuffix: Story = {
  args: { label: 'Glucose', suffix: 'mmol/L', defaultValue: '7.4', placeholder: '0.0' },
};

/** Mono is for identifiers and readouts: FHIR ids, codes, tabular numbers. */
export const Mono: Story = {
  args: {
    label: 'Observation',
    mono: true,
    defaultValue: 'Observation/8867-4',
    hint: 'Recorded 12 Aug 2026.',
  },
};

/** Disabled is 0.42 opacity with no colour change. */
export const Disabled: Story = {
  parameters: disabledRowContrast,
  args: {
    label: 'Medical record number',
    mono: true,
    defaultValue: 'OR-100482',
    hint: 'Issued by the clinic; you cannot change it here.',
    disabled: true,
  },
};

export const FieldSet: Story = {
  render: () => (
    <div style={stack}>
      <Input label="Given name" defaultValue="Testina" />
      <Input label="Family name" defaultValue="Patientsson" />
      <Input label="Medical record number" mono defaultValue="OR-100482" disabled />
      <Input
        label="Glucose"
        suffix="mmol/L"
        defaultValue="7.4"
        hint="Above range. Last measured 12 Aug 2026."
      />
    </div>
  ),
};

/**
 * Below 768px the field grows to a 44px touch target and the value stays at 16px, which is
 * the size at which iOS Safari stops zooming the page on focus. From md the exact 40px
 * control height returns.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Request a record from Dr. Okafor.
      </p>
      <Input label="Work email" iconLeft="mail" placeholder="you@clinic.org" />
      <Input label="Patient ID" mono placeholder="OR-100482" hint="FHIR Patient resource id." />
      <Input
        label="Systolic"
        suffix="mmHg"
        defaultValue="245"
        error="Enter a value between 70 and 220."
      />
    </div>
  ),
};

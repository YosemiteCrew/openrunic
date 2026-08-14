import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './Textarea';

const meta = {
  title: 'Forms/Textarea',
  component: Textarea,
  parameters: { layout: 'padded' },
  args: { label: 'Visit note', placeholder: 'What happened, and what happens next.' },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

const stack: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-4)',
  maxWidth: '520px',
};

/* The disabled-row contrast exemption, explained in full in Checkbox.stories.tsx: WCAG 1.4.3
   exempts text inside an inactive component, and axe cannot see it because the 0.42 opacity
   sits on the wrapper. Narrowed to the disabled field's subtree; nothing else is exempt. */
const disabledRowContrast = {
  a11y: {
    config: { rules: [{ id: 'color-contrast', selector: ':not(.or-textarea--disabled *)' }] },
  },
};

export const Default: Story = {};

/** The hint is quiet hazelnut and is read out as the field's description, never its name. */
export const WithHint: Story = {
  args: {
    hint: 'Seen by Dr. Amara Okafor. Visible to the care team.',
    defaultValue: 'Testina Patientsson reports chest pain on exertion, settling at rest.',
  },
};

/** An error states the fact, then the next action. Never colour alone: the icon and the
 *  sentence carry the meaning as much as the red does. The error replaces the hint. */
export const WithError: Story = {
  args: {
    hint: 'Seen by Dr. Amara Okafor.',
    error: 'Add a reason for the visit before saving.',
  },
};

/** The counter appears only when there is a limit. It is part of the field's description,
 *  so the limit is heard once on focus rather than re-announced on every keystroke. At the
 *  ceiling the number turns red beside a field that has stopped accepting characters. */
export const WithCounter: Story = {
  args: {
    label: 'Reason for visit',
    maxLength: 140,
    defaultValue: 'Chest pain on exertion. Glucose 7.4 mmol/L at triage.',
    hint: 'One or two sentences.',
  },
};

/** Auto-grow trades the scrollbar and the resize handle for a field that keeps every line
 *  in view. `rows` stays the starting height. */
export const AutoGrow: Story = {
  args: {
    autoGrow: true,
    rows: 2,
    defaultValue:
      'Testina Patientsson, OR-100482. Chest pain on exertion for three days, settling ' +
      'within minutes at rest. No radiation, no breathlessness. Glucose 7.4 mmol/L. ' +
      'Plan: ECG today, review with Dr. Amara Okafor on Thursday.',
  },
};

/** Mono is for identifiers and readouts: FHIR resources, codes, tabular numbers. */
export const Mono: Story = {
  args: {
    label: 'Observation payload',
    mono: true,
    rows: 5,
    defaultValue:
      '{\n  "resourceType": "Observation",\n  "code": "8867-4",\n  "subject": "Patient/OR-100482"\n}',
    hint: 'Recorded 12 Aug 2026.',
  },
};

/** Disabled is 0.42 opacity with no colour change. */
export const Disabled: Story = {
  parameters: disabledRowContrast,
  args: {
    label: 'Discharge summary',
    disabled: true,
    defaultValue: 'Signed off 12 Aug 2026 by Dr. Amara Okafor.',
    hint: 'Signed notes cannot be edited here.',
  },
};

export const FieldSet: Story = {
  // Carries a disabled field too, so it needs the same narrowing.
  parameters: disabledRowContrast,
  render: () => (
    <div style={stack}>
      <Textarea label="Reason for visit" maxLength={140} defaultValue="Chest pain on exertion." />
      <Textarea label="Visit note" rows={5} autoGrow hint="Grows as you write." />
      <Textarea label="Discharge summary" disabled defaultValue="Signed off 12 Aug 2026." />
    </div>
  ),
};

/**
 * Below 768px the field sits on a 44px touch floor and the value stays at 16px, which is the
 * size at which iOS Safari stops zooming the page on focus. From md the 40px control height
 * returns as the floor and `rows` carries the rest.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Testina Patientsson, OR-100482. Seen by Dr. Amara Okafor.
      </p>
      <Textarea
        label="Reason for visit"
        maxLength={140}
        defaultValue="Chest pain on exertion. Glucose 7.4 mmol/L at triage."
      />
      <Textarea label="Visit note" autoGrow hint="Grows as you write." />
      <Textarea label="Allergies" error="Add a reason for the visit before saving." />
    </div>
  ),
};

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from './Checkbox';

const meta = {
  title: 'Forms/Checkbox',
  component: Checkbox,
  parameters: { layout: 'padded' },
  args: { label: 'Share with my care team' },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

const stack: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-4)',
  maxWidth: '420px',
};

/*
 * The library's only axe exception, applied per story rather than globally. The five other
 * controls with a disabled state (Input, Radio, Select, Switch, Textarea) carry the same
 * narrowing and point back here.
 *
 * WCAG 1.4.3 exempts "text that is part of an inactive user interface component" from the
 * contrast minimum, and disabled here is the house treatment: 0.42 opacity on the row, no
 * colour change. axe cannot see the exemption, because the opacity sits on the wrapper
 * while the only node carrying a `disabled` attribute is the input, so the hint reads to it
 * as ordinary 12.5px text at 1.77:1.
 *
 * The rule is not disabled: its selector is narrowed to skip the disabled row's subtree and
 * nothing else, so every enabled control in the same story is still checked.
 */
const disabledRowContrast = {
  a11y: {
    config: { rules: [{ id: 'color-contrast', selector: ':not(.or-checkbox--disabled *)' }] },
  },
};

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const WithHint: Story = {
  args: {
    hint: 'You can revoke this at any time. The change is in your audit log.',
    defaultChecked: true,
  },
};

/** Disabled is 0.42 opacity with no colour change. */
export const Disabled: Story = {
  parameters: disabledRowContrast,
  args: {
    label: 'Share with the national registry',
    hint: 'Your clinic has not enabled registry sharing.',
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  parameters: disabledRowContrast,
  args: {
    label: 'Keep an audit log',
    hint: 'Always on. OpenRunic records every access to your data.',
    defaultChecked: true,
    disabled: true,
  },
};

/** A consent set: each box is an independent choice, so nothing here is a radio group. */
export const ConsentGroup: Story = {
  render: function ConsentGroupStory() {
    const [teams, setTeams] = useState(['cardiology']);
    const toggle = (id: string) =>
      setTeams((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      );

    return (
      <fieldset style={{ ...stack, border: 0, margin: 0, padding: 0 }}>
        <legend className="or-h3" style={{ marginBottom: 'var(--space-3)' }}>
          Who can read this record
        </legend>
        <Checkbox
          label="Primary care"
          hint="Dr. Okafor and the practice nurses."
          name="teams"
          value="primary-care"
          checked={teams.includes('primary-care')}
          onChange={() => toggle('primary-care')}
        />
        <Checkbox
          label="Cardiology"
          hint="Referred 12 Aug 2026."
          name="teams"
          value="cardiology"
          checked={teams.includes('cardiology')}
          onChange={() => toggle('cardiology')}
        />
        <Checkbox
          label="Endocrinology"
          hint="Glucose 7.4 mmol/L, above range."
          name="teams"
          value="endocrinology"
          checked={teams.includes('endocrinology')}
          onChange={() => toggle('endocrinology')}
        />
      </fieldset>
    );
  },
};

/**
 * Below 768px the label pads out to a 44px touch row and the box keeps its 18px size, so the
 * tap target is the whole line rather than the square. From md the tighter resting row returns.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen', ...disabledRowContrast },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Grant for Testina Patientsson, MRN OR-100482.
      </p>
      <Checkbox
        label="Share with my care team"
        hint="You can revoke this at any time."
        defaultChecked
      />
      <Checkbox label="Include readings from my wearable" hint="Synced every 15 minutes." />
      <Checkbox
        label="Share with the national registry"
        hint="Your clinic has not enabled registry sharing."
        disabled
      />
    </div>
  ),
};

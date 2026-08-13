import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio } from './Radio';

const meta = {
  title: 'Forms/Radio',
  component: Radio,
  parameters: { layout: 'padded' },
  args: { label: 'Metric (mmol/L)', name: 'units' },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

const stack: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-4)',
  maxWidth: '420px',
};

export const Default: Story = {};

export const Selected: Story = {
  args: { defaultChecked: true },
};

export const WithHint: Story = {
  args: { hint: 'Applies to every reading, including imported ones.', defaultChecked: true },
};

/** Disabled is 0.42 opacity with no colour change. */
export const Disabled: Story = {
  args: {
    label: 'Imperial (mg/dL)',
    hint: 'Not available for this record source.',
    disabled: true,
  },
};

/** Two to five mutually exclusive options, grouped by a shared name and one legend. */
export const Group: Story = {
  render: function UnitsGroupStory() {
    const [units, setUnits] = useState('metric');

    return (
      <fieldset style={{ ...stack, border: 0, margin: 0, padding: 0 }}>
        <legend className="or-h3" style={{ marginBottom: 'var(--space-3)' }}>
          Units
        </legend>
        <Radio
          name="units"
          value="metric"
          label="Metric (mmol/L)"
          hint="7.4 mmol/L - Above range."
          checked={units === 'metric'}
          onChange={() => setUnits('metric')}
        />
        <Radio
          name="units"
          value="us"
          label="US (mg/dL)"
          hint="133 mg/dL - Above range."
          checked={units === 'us'}
          onChange={() => setUnits('us')}
        />
      </fieldset>
    );
  },
};

/** A longer set: still one name, still one legend, arrow keys move between the choices. */
export const ExportFormat: Story = {
  render: function ExportFormatStory() {
    const [format, setFormat] = useState('ndjson');

    return (
      <fieldset style={{ ...stack, border: 0, margin: 0, padding: 0 }}>
        <legend className="or-h3" style={{ marginBottom: 'var(--space-3)' }}>
          Export format
        </legend>
        <Radio
          name="format"
          value="ndjson"
          label="FHIR NDJSON"
          hint="One resource per line. The portable option."
          checked={format === 'ndjson'}
          onChange={() => setFormat('ndjson')}
        />
        <Radio
          name="format"
          value="json"
          label="FHIR Bundle (JSON)"
          hint="A single Bundle resource."
          checked={format === 'json'}
          onChange={() => setFormat('json')}
        />
        <Radio
          name="format"
          value="pdf"
          label="Printable summary (PDF)"
          hint="Readable, but not machine-portable."
          checked={format === 'pdf'}
          onChange={() => setFormat('pdf')}
        />
      </fieldset>
    );
  },
};

/**
 * Below 768px the label pads out to a 44px touch row so the tap target is the whole line
 * rather than the ring. From md the tighter resting row returns.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Reading units for Testina Patientsson, MRN OR-100482.
      </p>
      <Radio name="units-mobile" value="metric" label="Metric (mmol/L)" defaultChecked />
      <Radio name="units-mobile" value="us" label="US (mg/dL)" />
      <Radio
        name="units-mobile"
        value="raw"
        label="Source units"
        hint="Whatever the sending clinic recorded."
      />
    </div>
  ),
};

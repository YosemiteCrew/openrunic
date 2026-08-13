import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tabs } from './Tabs';
import type { TabsItem } from './Tabs';

const body: CSSProperties = { display: 'grid', gap: 'var(--space-2)', maxWidth: '54ch' };

const section = (heading: string, text: string): ReactNode => (
  <div style={body}>
    <h3 className="or-h3">{heading}</h3>
    <p className="or-body">{text}</p>
  </div>
);

const ITEMS: TabsItem[] = [
  {
    id: 'summary',
    label: 'Summary',
    panel: section(
      'Testina Patientsson',
      'MRN OR-100482. Born 4 March 1978. Last seen 12 Aug 2026 by Dr. Amara Okafor.'
    ),
  },
  {
    id: 'results',
    label: 'Results',
    panel: section(
      'Glucose',
      '7.4 mmol/L, above the 4.0 to 5.9 reference range. Collected fasting on 12 Aug 2026.'
    ),
  },
  {
    id: 'medications',
    label: 'Medications',
    panel: section('Metformin 500 mg', 'Twice daily with food. Started 3 Feb 2026, no end date.'),
  },
  {
    id: 'notes',
    label: 'Notes',
    panel: section(
      'Consultation note',
      'Reviewed glucose trend and diet. Repeat fasting sample in three months.'
    ),
  },
];

const meta = {
  title: 'Navigation/Tabs',
  component: Tabs,
  parameters: { layout: 'padded' },
  args: { items: ITEMS, label: 'Record sections' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without a selection of its own the strip opens on the first enabled tab. */
export const Default: Story = {};

/** An icon sits before the label at the same 17px the sidebar rows use. */
export const WithIcons: Story = {
  args: {
    items: ITEMS.map((item, index) => ({
      ...item,
      icon: ['user', 'flask-conical', 'pill', 'file-text'][index],
    })),
    defaultValue: 'results',
  },
};

/** A disabled tab is 0.42 opacity with no colour change, and the arrow keys step over it
 *  rather than landing on a section that cannot be opened. */
export const WithDisabledTab: Story = {
  args: {
    items: [
      ...ITEMS.slice(0, 2),
      { id: 'imaging', label: 'Imaging', disabled: true, panel: section('Imaging', 'No studies.') },
      ...ITEMS.slice(2),
    ],
  },
};

/** Controlled: the caller owns the selection, and `onChange` reports the tab id. The strip
 *  never moves itself, so a section can be refused or logged before it opens. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [current, setCurrent] = useState('medications');

    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Tabs items={ITEMS} label="Record sections" value={current} onChange={setCurrent} />
        <p className="or-caption" style={{ color: 'var(--text-secondary)' }}>
          Open section: {current}
        </p>
      </div>
    );
  },
};

/** More tabs than the strip is wide: the row scrolls sideways inside its own container
 *  rather than wrapping onto a second line or squeezing the labels. */
export const Overflow: Story = {
  args: {
    items: [
      ...ITEMS,
      { id: 'allergies', label: 'Allergies', panel: section('Allergies', 'Penicillin, moderate.') },
      {
        id: 'immunisations',
        label: 'Immunisations',
        panel: section('Immunisations', 'Up to date.'),
      },
      { id: 'care-team', label: 'Care team', panel: section('Care team', 'Dr. Amara Okafor.') },
      { id: 'documents', label: 'Documents', panel: section('Documents', 'Four on file.') },
      { id: 'consent', label: 'Consent', panel: section('Consent', 'Sharing with one clinic.') },
    ],
  },
};

/**
 * Below 768px every tab grows to a 44px touch target and the strip scrolls sideways, so a
 * thumb can reach any section without the labels wrapping. From md the exact 40px control
 * height returns.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' } },
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
      <p className="or-small" style={{ color: 'var(--text-secondary)' }}>
        Record for Testina Patientsson, MRN OR-100482.
      </p>
      <Tabs items={ITEMS} label="Record sections" defaultValue="results" />
    </div>
  ),
};

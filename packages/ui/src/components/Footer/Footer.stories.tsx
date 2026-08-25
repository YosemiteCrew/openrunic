import type { Meta, StoryObj } from '@storybook/react-vite';
import { Footer } from './Footer';
import type { FooterColumn } from './Footer';

const COLUMNS: FooterColumn[] = [
  { title: 'Product', links: ['Records', 'Results', 'Care team', 'Consent'] },
  { title: 'Open source', links: ['GitHub', 'Licence', 'Roadmap', 'Security'] },
  { title: 'Docs', links: ['Quick start', 'FHIR R4 mapping', 'Self-hosting', 'API reference'] },
];

const SIBLING = 'AGPL-3.0 - Sibling project: Yosemite Crew, for animal health.';

/* The band paints its own espresso; the matching canvas keeps the preview honest. */
const onEspresso = { backgrounds: { value: 'espresso' } };

const meta = {
  title: 'Navigation/Footer',
  component: Footer,
  parameters: { layout: 'fullscreen' },
  args: {
    columns: COLUMNS,
    note: 'The open-source operating system for human health.',
  },
} satisfies Meta<typeof Footer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  globals: onEspresso,
};

/**
 * The one family context where Yosemite Crew may be named beside openrunic - beside it,
 * never merged into a single lockup and never colour-swapped to match.
 */
export const WithSiblingNote: Story = {
  globals: onEspresso,
  args: { siblingNote: SIBLING },
};

/** A docs footer: fewer columns, and the note carrying the self-hosting stance. */
export const Compact: Story = {
  globals: onEspresso,
  args: {
    note: 'Self-hosted or managed. No telemetry by default.',
    columns: [
      { title: 'Docs', links: ['Quick start', 'FHIR R4 mapping'] },
      { title: 'Open source', links: ['GitHub', 'Licence'] },
    ],
    siblingNote: 'AGPL-3.0 - Every clinical rule is published.',
  },
};

/** The lockup and note alone, for a marketing page that carries its links in the body. */
export const LockupOnly: Story = {
  globals: onEspresso,
  args: { columns: [] },
};

/**
 * Below 768px the band stacks: lockup and note first, then one column per row, each link
 * keeping a 44px touch target. From md the lockup takes a third and the columns share the
 * rest across an auto-fit grid.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'mobile' }, backgrounds: { value: 'espresso' } },
  args: { siblingNote: SIBLING },
};

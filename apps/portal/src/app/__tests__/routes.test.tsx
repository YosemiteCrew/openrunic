/**
 * The server half of each route: metadata, and that it mounts its client screen.
 *
 * The split matters. @openrunic/ui ships no 'use client' directive, so a server component
 * that imported one of its components directly would break the build. Every page here is
 * metadata plus one client screen, and these assertions are what keeps it that way.
 */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RootLayout, { metadata as layoutMetadata } from '@/app/layout';
import HomePage, { metadata as homeMetadata } from '@/app/page';
import AppointmentsPage, { metadata as appointmentsMetadata } from '@/app/appointments/page';
import BillsPage, { metadata as billsMetadata } from '@/app/bills/page';
import FormsPage, { metadata as formsMetadata } from '@/app/forms/page';
import HealthRecordPage, { metadata as healthRecordMetadata } from '@/app/health-record/page';
import MessagesPage, { metadata as messagesMetadata } from '@/app/messages/page';
import AssistantPage, { metadata as assistantMetadata } from '@/app/assistant/page';

/* The layout mounts the shell, which reads the route and renders next/link. Neither has a
   router in a unit test, so both are stubbed down to what these assertions need. */
vi.mock('next/navigation', () => ({ usePathname: () => '/', notFound: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('RootLayout', () => {
  it('titles the portal and describes it in plain words', () => {
    expect(layoutMetadata.title).toMatchObject({ default: 'Patient portal' });
    expect(layoutMetadata.description).toBe(
      'See your appointments, health record, messages, forms and bills.'
    );
  });

  it('renders its children in a document declared as English', () => {
    render(
      <RootLayout>
        <p>Screen content</p>
      </RootLayout>
    );

    expect(screen.getByText('Screen content')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });
});

describe.each([
  ['Home', HomePage, homeMetadata, 'Home'],
  ['Health record', HealthRecordPage, healthRecordMetadata, 'Health record'],
  ['Messages', MessagesPage, messagesMetadata, 'Messages'],
  ['Appointments', AppointmentsPage, appointmentsMetadata, 'Appointments'],
  ['Forms', FormsPage, formsMetadata, 'Forms'],
  ['Bills', BillsPage, billsMetadata, 'Bills'],
] as const)('%s route', (_name, Page, pageMetadata, title) => {
  it('carries its own title and description', () => {
    expect(pageMetadata.title).toBe(title);
    expect(pageMetadata.description).toEqual(expect.any(String));
  });

  it('mounts a screen with exactly one h1', async () => {
    render(<Page />);

    const headings = await screen.findAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(title);
  });
});

/**
 * The assistant route is the exception to the block above, and deliberately so.
 * Every other page renders a screen; this one renders nothing until the probe
 * has answered, and answers 404 unless the practice configured an assistant.
 * `AssistantScreen.test.tsx` covers the states; here we only assert that the
 * route exists, is titled, and draws no heading in the shipped configuration.
 */
describe('Assistant route', () => {
  it('carries its own title and description', () => {
    expect(assistantMetadata.title).toBe('Assistant');
    expect(assistantMetadata.description).toEqual(expect.any(String));
  });

  it('renders nothing at all outside a configured deployment', () => {
    const { container } = render(<AssistantPage />);
    expect(container).toBeEmptyDOMElement();
  });
});

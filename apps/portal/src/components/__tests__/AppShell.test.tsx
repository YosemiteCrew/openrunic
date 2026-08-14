import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { PortalChrome } from '@/components/PortalChrome';
import { AssistantProvider } from '@/components/assistant';
import type { AssistantAvailability, AssistantEvent } from '@/lib/assistant';
import { stubApi, fails, never } from '@/__tests__/support';

const pathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

/* next/link needs the app router's context, which no test renders. A plain anchor keeps
   the href, the label and the tab order, which is all these assertions are about. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const PATIENT = {
  id: 'patient-or-100482',
  name: 'Testina Patientsson',
  mrn: 'OR-100482',
  dateOfBirth: '1984-03-11',
};

const probeEnabled = (): Promise<AssistantAvailability> =>
  Promise.resolve({
    status: 'enabled',
    capabilities: {
      service: {
        modelId: 'a-model',
        endpointHost: 'inference.example.invalid',
        dataLeavesDeployment: false,
      },
      capabilities: [],
    },
  });

/* The chrome never runs a turn; it only asks whether there is an assistant. */
async function* noTurn(): AsyncGenerator<AssistantEvent> {
  await Promise.resolve();
  yield* [];
}

beforeEach(() => {
  pathname.current = '/';
});

describe('AppShell', () => {
  it('renders the landmarks a screen reader navigates by', () => {
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Screen content');
    expect(screen.getByRole('navigation', { name: 'Portal sections' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('puts one set of links in the DOM, not one per breakpoint', () => {
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    const nav = screen.getByRole('navigation', { name: 'Portal sections' });
    // Six sections, six links. A second copy for the tab bar would double this and leave a
    // keyboard user tabbing through navigation they cannot see.
    expect(
      screen.getAllByRole('link', { name: /Home|Health record|Messages|Appointments|Forms|Bills/ })
    ).toHaveLength(6);
    expect(nav).toBeInTheDocument();
  });

  it('marks the current section with aria-current, not with colour alone', () => {
    pathname.current = '/messages';
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Bills' })).not.toHaveAttribute('aria-current');
  });

  it('offers skip to content as the first tab stop', async () => {
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    await userEvent.tab();

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#portal-main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'portal-main');
  });

  it('reaches every section by keyboard alone', async () => {
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    await userEvent.tab();
    for (const label of ['Home', 'Health record', 'Messages', 'Appointments', 'Forms', 'Bills']) {
      await userEvent.tab();
      expect(screen.getByRole('link', { name: label })).toHaveFocus();
    }
  });

  it('names the account when the patient is known', () => {
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    expect(screen.getByText('Testina Patientsson')).toBeInTheDocument();
    expect(screen.getByText('Record number OR-100482')).toBeInTheDocument();
  });

  it('leaves the strip out rather than showing a placeholder name', () => {
    render(
      <AppShell>
        <p>Screen content</p>
      </AppShell>
    );

    expect(screen.queryByText(/Record number/)).not.toBeInTheDocument();
  });

  it('offers no way to an assistant this practice did not configure', () => {
    render(
      <AppShell patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    /* Not a disabled tab and not a tab that explains what is missing: nothing.
       A control that exists only to say a feature does not is still a feature
       in the navigation. */
    expect(screen.queryByRole('link', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('adds one tab, at the end, where a practice did configure one', () => {
    render(
      <AppShell assistantEnabled patient={PATIENT}>
        <p>Screen content</p>
      </AppShell>
    );

    const links = screen.getAllByRole('link');
    expect(screen.getByRole('link', { name: 'Assistant' })).toHaveAttribute('href', '/assistant');
    expect(links.at(-1)).toHaveAccessibleName('Assistant');
  });
});

describe('PortalChrome', () => {
  it('names the account once the patient resolves', async () => {
    render(
      <PortalChrome api={stubApi()}>
        <p>Screen content</p>
      </PortalChrome>
    );

    expect(await screen.findByText('Testina Patientsson')).toBeInTheDocument();
  });

  it('keeps the portal usable when the identity read fails', async () => {
    render(
      <PortalChrome api={stubApi({ getPatient: fails })}>
        <p>Screen content</p>
      </PortalChrome>
    );

    // The sections still work; they are simply unnamed.
    expect(await screen.findByRole('navigation', { name: 'Portal sections' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Screen content');
    expect(screen.queryByText(/Record number/)).not.toBeInTheDocument();
  });

  it('links to the assistant only once the probe has said there is one', async () => {
    const { rerender } = render(
      <AssistantProvider probe={never} runTurn={noTurn}>
        <PortalChrome api={stubApi()}>
          <p>Screen content</p>
        </PortalChrome>
      </AssistantProvider>
    );

    // Nothing while the answer is still coming: a tab that appears and then
    // disappears is layout reserved for a feature that may not exist.
    expect(await screen.findByText('Testina Patientsson')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Assistant' })).not.toBeInTheDocument();

    rerender(
      <AssistantProvider probe={probeEnabled} runTurn={noTurn}>
        <PortalChrome api={stubApi()}>
          <p>Screen content</p>
        </PortalChrome>
      </AssistantProvider>
    );

    expect(await screen.findByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'href',
      '/assistant'
    );
  });
});

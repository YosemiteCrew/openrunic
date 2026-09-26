import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantHelp, AssistantProvider } from '@/components/assistant';
import type { AssistantAvailability } from '@/lib/assistant';
import { never } from '@/__tests__/support';

/**
 * The offer on the appointments and bills screens to ask the assistant about
 * them. It must be absent in every state the assistant itself is absent in, and
 * absent where the practice did not grant what would answer it.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function enabledWith(...ids: string[]): AssistantAvailability {
  return {
    status: 'enabled',
    capabilities: {
      dictation: null,
      service: {
        modelId: 'a-model',
        endpointHost: 'inference.example.invalid',
        dataLeavesDeployment: false,
      },
      capabilities: ids.map((id) => ({ id, summary: `Reads ${id}.` })),
    },
  };
}

function mount(topic: 'visits' | 'bills', probe: () => Promise<AssistantAvailability>) {
  return render(
    <AssistantProvider probe={probe}>
      <p>screen</p>
      <AssistantHelp topic={topic} />
    </AssistantProvider>
  );
}

describe('the offer to ask the assistant about this screen', () => {
  it('links the appointments screen to a question about appointments', async () => {
    mount('visits', () => Promise.resolve(enabledWith('visits.list', 'bills.list')));

    const link = await screen.findByRole('link', {
      name: 'Ask the assistant about your appointments',
    });
    expect(link).toHaveAttribute('href', '/assistant?about=visits');
    expect(screen.getByText(/A question about your appointments\?/)).toBeInTheDocument();
  });

  it('links the bills screen to a question about bills', async () => {
    mount('bills', () => Promise.resolve(enabledWith('visits.list', 'bills.list')));

    const link = await screen.findByRole('link', { name: 'Ask the assistant about your bills' });
    expect(link).toHaveAttribute('href', '/assistant?about=bills');
  });

  it('offers nothing where the practice did not grant what would answer it', async () => {
    const { container } = mount('bills', () => Promise.resolve(enabledWith('visits.list')));

    await screen.findByText('screen');
    await vi.waitFor(() => {
      expect(container.querySelector('.portal-assistant-help')).toBeNull();
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers nothing where no assistant is configured', async () => {
    let settle: (value: AssistantAvailability) => void = () => undefined;
    const answered = new Promise<AssistantAvailability>((resolve) => {
      settle = resolve;
    });
    mount('visits', () => answered);

    settle({ status: 'absent' });
    await answered;
    await Promise.resolve();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers nothing while the probe has not answered', () => {
    mount('visits', () => never());

    expect(screen.getByText('screen')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers nothing outside a provider, which is the shipped default', () => {
    render(<AssistantHelp topic="bills" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

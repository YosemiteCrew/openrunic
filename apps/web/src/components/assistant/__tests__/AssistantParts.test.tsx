import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AssistantComposer,
  AssistantLauncher,
  AssistantPanel,
  AssistantProvider,
  AssistantTurnView,
} from '@/components/assistant';
import type { AssistantTurn } from '@/components/assistant';
import { CommandProvider } from '@/components/command';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule',
}));

function turn(partial: Partial<AssistantTurn> = {}): AssistantTurn {
  return {
    id: 't0',
    question: 'how many visits',
    answer: '',
    steps: [],
    sources: [],
    drafts: [],
    deferrals: [],
    failures: [],
    outcome: null,
    withheld: 'none',
    ...partial,
  };
}

describe('AssistantTurnView', () => {
  it('says a step is running while it still is', () => {
    render(
      <AssistantTurnView
        turn={turn({ steps: [{ key: 'chart.search', label: 'Searching the chart', done: false }] })}
        streaming
      />
    );

    // The word carries it, not the glyph: a screen reader announces neither
    // the icon nor the data attribute.
    expect(screen.getByText('Searching the chart - running')).toBeInTheDocument();
    expect(screen.getByText('Still answering.')).toBeInTheDocument();
  });

  it('renders a draft that was not derived from patient-written text', () => {
    render(
      <AssistantTurnView
        turn={turn({
          drafts: [
            {
              proposalId: 'p1',
              toolId: 'appointments.propose',
              kind: 'appointment.book',
              effect: [{ label: 'Starts', value: '09:00' }],
              derivedFromUntrusted: false,
            },
          ],
        })}
        streaming={false}
      />
    );

    expect(screen.getByText('Draft - nothing has been saved')).toBeInTheDocument();
    expect(screen.queryByText(/Based partly on/)).toBeNull();
  });

  it('renders each paragraph of a longer answer', () => {
    render(
      <AssistantTurnView
        turn={turn({
          answer: 'Two visits are recorded.\n\nThe second was a review.',
          sources: [
            {
              resourceType: 'Patient',
              resourceId: 'p1',
              label: 'Patientsson, Testina',
              untrusted: false,
            },
          ],
        })}
        streaming={false}
      />
    );

    expect(screen.getByText('Two visits are recorded.')).toBeInTheDocument();
    expect(screen.getByText('The second was a review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Patient Patientsson, Testina' })).toHaveAttribute(
      'href',
      '/patients/p1'
    );
  });
});

describe('AssistantComposer', () => {
  it('holds its own field reference when the panel does not supply one', () => {
    const onAsk = vi.fn();
    render(<AssistantComposer streaming={false} onAsk={onAsk} onStop={vi.fn()} />);

    const field = screen.getByRole('textbox', { name: /Ask about this record/ });
    fireEvent.change(field, { target: { value: 'a question' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onAsk).toHaveBeenCalledWith('a question');
    // The field empties itself, so the next question starts from nothing.
    expect(field).toHaveValue('');
  });

  it('offers Stop beside Ask while an answer is arriving, and never disables the field', () => {
    const onStop = vi.fn();
    render(<AssistantComposer streaming onAsk={vi.fn()} onStop={onStop} />);

    expect(screen.getByRole('textbox', { name: /Ask about this record/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('AssistantProvider with no injected transport', () => {
  it('reads the app default, which against fixtures is no assistant at all', async () => {
    const { container } = render(
      <CommandProvider>
        <AssistantProvider>
          <AssistantLauncher />
          <AssistantPanel />
        </AssistantProvider>
      </CommandProvider>
    );

    await waitFor(() => expect(container.querySelector('.or-assistant')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
  });
});

/**
 * The assistant page read by somebody who chose Spanish.
 *
 * Its own file, for the reason `FormsScreen.locale.test.tsx` gives: a Spanish
 * translator is deliberately unavailable to every other file, and a `vi.mock`
 * here takes precedence over the setup one.
 *
 * The two assertions that matter are not ordinary copy. The service line is
 * ADR-0005's no-telemetry promise said in the product, and the failure sentence
 * says what is unaffected as well as what went wrong. A reader who cannot read
 * either of them has been told nothing about where their words go, or about
 * whether the rest of their portal still works.
 */

import type { ReactNode } from 'react';
import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AssistantScreen } from '@/app/assistant/AssistantScreen';
import { AssistantProvider } from '@/components/assistant';
import { ASSISTANT_UNREACHABLE } from '@/lib/assistant';
import type { AssistantAvailability, AssistantEvent } from '@/lib/assistant';
import { stubApi } from '@/__tests__/support';

vi.mock('@/lib/i18n/messages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n/messages')>('@/lib/i18n/messages');
  const translator = createTranslator(appCatalogue, 'es');
  return { ...actual, useTranslator: () => translator };
});

vi.mock('next/navigation', () => ({ notFound: vi.fn(), usePathname: () => '/assistant' }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ENABLED: AssistantAvailability = {
  status: 'enabled',
  capabilities: {
    service: {
      modelId: 'a-model',
      endpointHost: 'inference.example.invalid',
      dataLeavesDeployment: true,
    },
    capabilities: [{ id: 'record.list', summary: 'Reads your own health record.' }],
  },
};

function mount(events: AssistantEvent[] = []) {
  async function* run(): AsyncGenerator<AssistantEvent> {
    for (const event of events) {
      await Promise.resolve();
      yield event;
    }
  }

  return render(
    <AssistantProvider probe={() => Promise.resolve(ENABLED)} runTurn={run}>
      <AssistantScreen api={stubApi()} />
    </AssistantProvider>
  );
}

describe('the assistant in Spanish', () => {
  it('says where the words go, naming the service and the host', async () => {
    mount();

    expect(await screen.findByRole('heading', { name: 'Asistente' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Su consulta usa un servicio informático para escribir estas respuestas\. Se llama a-model y funciona en inference\.example\.invalid\./
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Lo que escriba aquí sale de su consulta/)).toBeInTheDocument();
  });

  it('carries the safety notice and the composer', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Asistente' });

    expect(screen.getByLabelText('Lo que puede y lo que no puede hacer')).toBeInTheDocument();
    expect(await screen.findByLabelText('Su pregunta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preguntar' })).toBeInTheDocument();
  });

  it('says what still works when a turn fails', async () => {
    mount([{ type: 'failed', code: ASSISTANT_UNREACHABLE }]);
    await screen.findByRole('heading', { name: 'Asistente' });

    await userEvent.type(await screen.findByLabelText('Su pregunta'), '¿Cuándo es mi cita?');
    await userEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sus citas, sus mensajes, sus formularios y sus facturas');
    /* Not the code, in any language. A reader who has just been told the thing
       did not work is the last person who should meet an identifier. */
    expect(alert).not.toHaveTextContent(ASSISTANT_UNREACHABLE);
  });

  it('names the record a citation points at, and where the link goes', async () => {
    mount([
      { type: 'text', text: 'Su próxima cita es el 3 de septiembre.' },
      {
        type: 'sources',
        entries: [
          {
            resourceType: 'Appointment',
            resourceId: 'appointment-9',
            label: 'Follow-up',
            untrusted: false,
          },
        ],
      },
      { type: 'finished', outcome: 'completed' },
    ]);
    await screen.findByRole('heading', { name: 'Asistente' });

    await userEvent.type(await screen.findByLabelText('Su pregunta'), '¿Cuándo es mi cita?');
    await userEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    expect(await screen.findByText('De dónde sale esto')).toBeInTheDocument();
    expect(screen.getByText(/Cita: Follow-up/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'verlo en sus citas' })).toHaveAttribute(
      'href',
      '/appointments'
    );
  });
});

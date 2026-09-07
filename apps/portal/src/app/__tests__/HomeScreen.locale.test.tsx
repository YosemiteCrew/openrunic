/**
 * The home screen's buttons follow the reader's language, like every other screen's.
 *
 * This is its own file because it needs a Spanish translator, and `vitest.setup.ts`
 * replaces `useTranslator` with an English one for every other file. A `vi.mock` here
 * takes precedence: the setup replaces the hook rather than the context, so wrapping the
 * screen in a `MessagesProvider` would set a value nothing reads.
 *
 * The failure this rules out is #303, and it is not a missing translation. Two of these
 * three strings were already translated and already used by `AppointmentsScreen`; the
 * home card rendered its own English literal beside them. So a Spanish reader saw the
 * SAME button in two languages depending on which screen they were on, and
 * `coverageOf(appCatalogue, 'es')` reported zero missing `portal.*` keys throughout -
 * a catalogue is complete when nothing asks it for a key it does not have, and a
 * hardcoded literal never asks.
 *
 * Asserted in both directions: the Spanish string present AND the English one absent.
 * Presence alone passes on a screen rendering both, which is what a half-applied fix
 * looks like.
 */

import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HomeScreen } from '@/app/HomeScreen';
import { stubApi } from '@/__tests__/support';
import { buildFixtures } from '@/lib/api';
import { buildHomeSummary } from '@/lib/api/fixtures';
import type { Appointment, HomeSummary } from '@/lib/api/types';

vi.mock('@/lib/i18n/messages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n/messages')>('@/lib/i18n/messages');
  const translator = createTranslator(appCatalogue, 'es');
  return { ...actual, useTranslator: () => translator };
});

function homeWith(overrides: Partial<HomeSummary>): HomeSummary {
  return { ...buildHomeSummary(buildFixtures()), ...overrides };
}

const IN_PERSON: Appointment = {
  id: 'appt-in-person',
  startsAt: '2026-09-24T14:00:00.000Z',
  durationMinutes: 30,
  reason: 'Blood pressure check',
  clinician: 'Exampla Testperson',
  department: 'General practice',
  mode: 'in-person',
  location: 'Elmfield Practice, Room 4',
  directionsUrl: 'https://example.invalid/directions/elmfield',
};

describe('the home screen read in Spanish', () => {
  it('joins a video call in Spanish, the same words the appointments screen uses', async () => {
    render(<HomeScreen api={stubApi()} />);

    expect(
      await screen.findByRole('link', { name: 'Entrar en la videollamada' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Join the video call' })).not.toBeInTheDocument();
  });

  it('offers directions in Spanish for an in-person visit', async () => {
    render(
      <HomeScreen
        api={stubApi({ getHome: () => Promise.resolve(homeWith({ nextAppointment: IN_PERSON })) })}
      />
    );

    expect(await screen.findByRole('link', { name: 'Cómo llegar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  });

  it('sends the reader to all their appointments in Spanish', async () => {
    render(<HomeScreen api={stubApi()} />);

    expect(await screen.findByRole('link', { name: 'Ver todas las citas' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See all appointments' })).not.toBeInTheDocument();
  });
});

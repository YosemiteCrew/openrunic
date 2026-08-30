import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DuplicatePanel } from '@/components/patients/DuplicatePanel';
import type { DuplicateMatch } from '@/components/patients/registration';
import { MOCK_PATIENTS } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients',
}));

/**
 * The panel that says this person may already be in the record.
 *
 * Two strengths of the same warning, and only the weaker one had ever been
 * rendered. The stronger one interrupts a save in progress, which is the whole
 * reason it exists: registering a second chart for a patient who already has
 * one is how a clinician later reads half a history and believes it is all of
 * it.
 */

const PATIENT = MOCK_PATIENTS.find((candidate) => candidate.mrn === 'OR-101088');

function matches(): DuplicateMatch[] {
  if (PATIENT === undefined) throw new Error('fixture patient OR-101088 is missing');
  return [{ patient: PATIENT, score: 90, reasonKeys: ['patients.duplicate.reason.name'] }];
}

function renderPanel(blocking: boolean) {
  render(
    <DuplicatePanel
      matches={matches()}
      blocking={blocking}
      overridden={false}
      onOverrideChange={vi.fn()}
      asOf={new Date('2026-08-30T00:00:00.000Z')}
    />
  );
}

describe('a match strong enough to block saving', () => {
  it('announces itself, because it interrupts a save already in progress', () => {
    /*
     * `role="alert"` and not merely bold text. The registrar has pressed save
     * and is looking at the button, not at the panel; a warning that only looks
     * different is a warning they have already moved past.
     */
    renderPanel(true);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('says something different from the weaker warning', () => {
    /*
     * The two strengths must not read the same. "This might be a duplicate" and
     * "this is a duplicate and you cannot save" call for different actions, and
     * a panel that says the softer thing in the harder case teaches a registrar
     * to click past both.
     */
    renderPanel(true);
    const blocking = screen.getByRole('alert').textContent;

    screen.getByRole('alert').remove();
    renderPanel(false);
    const similar = screen.getByText(/./u, { selector: '.or-body' }).textContent;

    expect(blocking).not.toBe(similar);
  });
});

describe('a weaker match', () => {
  it('warns without announcing, because nothing was interrupted', () => {
    /*
     * No alert role. A similar-name hit while the registrar is still typing is
     * information, not an interruption, and announcing every one of them is how
     * the announcement stops meaning anything.
     */
    renderPanel(false);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

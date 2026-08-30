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
 * `RegisterPatientScreen.test.tsx` already renders the blocking panel through
 * the screen and checks that registration is held. What it does not check is
 * how the warning reaches a reader who is not looking at it, which is this
 * file's subject: the `role` each strength carries, and which message goes with
 * which strength.
 *
 * The panel appears as soon as matching records exist - `blocking` is derived
 * from the current matches, not from a save attempt - so a registrar meets it
 * while still typing. That is why the stronger one announces and the weaker one
 * does not.
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
  it('announces itself rather than only looking different', () => {
    /*
     * `role="alert"` and not merely emphasis. A registrar mid-form is looking
     * at the field they are typing in, not at a panel that appeared below it,
     * and a warning nothing announces is one they type straight past.
     */
    renderPanel(true);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('carries the blocking title, not the softer one', () => {
    /*
     * Named messages rather than an inequality. Checking only that the two
     * differ passes with the branches swapped, which is the exact regression
     * worth catching: the hard-stop case would then give the registrar the
     * softer instruction while still reading as "different".
     */
    renderPanel(true);

    expect(screen.getByText('This patient may already have a record')).toBeInTheDocument();
    expect(screen.queryByText('Similar records exist in the practice')).not.toBeInTheDocument();
  });
});

describe('a weaker match', () => {
  it('warns without announcing', () => {
    /*
     * No alert role. A similar-name hit is information, and announcing every
     * one of them is how the announcement stops meaning anything by the time a
     * blocking match arrives.
     */
    renderPanel(false);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('carries the softer title, not the blocking one', () => {
    renderPanel(false);

    expect(screen.getByText('Similar records exist in the practice')).toBeInTheDocument();
    expect(screen.queryByText('This patient may already have a record')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DuplicatePanel } from '@/components/patients/DuplicatePanel';
import { BLOCKING_SCORE } from '@/components/patients/registration';
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

/* The two bodies, quoted, because which one a strength carries is the point. */
const BLOCKING_BODY =
  'Registering a second record splits the history for this person. Open the existing record, or confirm below that this is a different person.';
const SIMILAR_BODY = 'These records look close. Check them before registering a new one.';

/**
 * A match whose score is the sum of its own reasons.
 *
 * `findDuplicates` builds a score by adding the weight of every signal that
 * held, so a score and a reason list that disagree describe a match production
 * never produces. `sameFamilyName` and `sameGivenName` are 2 each and
 * `sameBirthDate` is 3, and `BLOCKING_SCORE` is 5 - so family name alone is
 * under the threshold and all three together are over it.
 *
 * `blocking` is derived here for the same reason: the screen computes it from
 * the score, so passing it independently would let a test render a panel that
 * cannot occur.
 */
const CANDIDATE_FLOOR = 3;

const WEAK_MATCH = {
  reasonKeys: ['patients.duplicate.sameFamilyName', 'patients.duplicate.sameGivenName'],
  score: 4,
} as const;

const STRONG_MATCH = {
  reasonKeys: [
    'patients.duplicate.sameFamilyName',
    'patients.duplicate.sameGivenName',
    'patients.duplicate.sameBirthDate',
  ],
  score: 7,
} as const;

function matches(blocking: boolean): DuplicateMatch[] {
  if (PATIENT === undefined) throw new Error('fixture patient OR-101088 is missing');
  const shape = blocking ? STRONG_MATCH : WEAK_MATCH;
  /* The fixture is only honest if its own score decides the flag, and only
     reachable if the score clears the candidate floor. */
  expect(shape.score >= BLOCKING_SCORE).toBe(blocking);
  expect(shape.score).toBeGreaterThanOrEqual(CANDIDATE_FLOOR);
  return [{ patient: PATIENT, score: shape.score, reasonKeys: [...shape.reasonKeys] }];
}

function renderPanel(blocking: boolean) {
  return render(
    <DuplicatePanel
      matches={matches(blocking)}
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

    /*
     * The body as well as the title. The two bodies are what tell a registrar
     * what to do next, and swapping only those would leave every title
     * assertion green while the hard stop gave the softer instruction.
     */
    expect(screen.getByRole('alert').textContent).toBe(BLOCKING_BODY);
  });
});

describe('a weaker match', () => {
  it('warns without announcing', () => {
    /*
     * No alert role. A similar-name hit is information, and announcing every
     * one of them is how the announcement stops meaning anything by the time a
     * blocking match arrives.
     */
    const { container } = renderPanel(false);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    /*
     * `role="alert"` is not the only way to announce. `role="status"` or an
     * `aria-live` attribute would announce every similar-name hit while the
     * registrar is still typing, which is what makes the blocking one stop
     * meaning anything.
     */
    /*
     * Asserted as "carries no role at all" rather than as a list of roles to
     * exclude. `status`, `log`, `marquee` and `timer` all have implicit live
     * region semantics, and an exclusion list is one role behind whoever adds
     * the next one.
     */
    const paragraph = container.querySelector('p.or-body');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.getAttribute('role')).toBeNull();
    expect(paragraph?.getAttribute('aria-live')).toBeNull();
  });

  it('carries the softer title and body, not the blocking pair', () => {
    renderPanel(false);

    expect(screen.getByText('Similar records exist in the practice')).toBeInTheDocument();
    expect(screen.queryByText('This patient may already have a record')).not.toBeInTheDocument();
    /* The body too. Swapping only the bodies leaves both titles correct. */
    expect(screen.getByText(SIMILAR_BODY)).toBeInTheDocument();
    expect(screen.queryByText(BLOCKING_BODY)).not.toBeInTheDocument();
  });
});

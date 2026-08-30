import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DuplicatePanel } from '@/components/patients/DuplicatePanel';
import { EMPTY_DRAFT, findDuplicates, isBlocking } from '@/components/patients/registration';
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

/**
 * Every role ARIA defines as a live region, and the attribute form.
 *
 * The list is the complete set from the specification rather than the roles
 * that happened to come to mind: `alert`, `status`, `log`, `marquee` and
 * `timer` are all announced without focus moving to them.
 */
const LIVE_REGION =
  '[aria-live], [role="alert"], [role="status"], [role="log"], [role="marquee"], [role="timer"]';

/* The two bodies, quoted, because which one a strength carries is the point. */
const BLOCKING_BODY =
  'Registering a second record splits the history for this person. Open the existing record, or confirm below that this is a different person.';
const SIMILAR_BODY = 'These records look close. Check them before registering a new one.';

/**
 * The matches, produced by `findDuplicates` rather than written by hand.
 *
 * Every hand-written fixture in this file's history described a match
 * production cannot produce: a score that did not equal its own reasons, then
 * one that sat under the floor `findDuplicates` filters at. Both looked
 * plausible and neither could reach the panel through the only caller. Asking
 * production for the match removes the whole class: the weights, the floor and
 * the blocking threshold are all applied by the code that owns them, so a
 * change to any of them fails here instead of quietly making this file fiction.
 *
 * The two drafts differ only in the birth date, which is what moves the score
 * across the threshold. `phoneMobile` stays empty in both: a phone match alone
 * is worth 5 and would block the weaker case.
 */
function matchesFor(blocking: boolean): DuplicateMatch[] {
  if (PATIENT === undefined) throw new Error('fixture patient OR-101088 is missing');

  const found = findDuplicates(
    {
      ...EMPTY_DRAFT,
      family: PATIENT.name.family,
      given: PATIENT.name.given,
      birthDate: blocking ? PATIENT.birthDate : '',
    },
    [PATIENT]
  );

  /* Reachability and strength, both answered by production rather than by a
     constant copied out of it. An empty result means the draft no longer
     clears the candidate filter, so the panel could never receive it. */
  expect(found).toHaveLength(1);
  expect(isBlocking(found)).toBe(blocking);

  return found;
}

function renderPanel(blocking: boolean) {
  return render(
    <DuplicatePanel
      matches={matchesFor(blocking)}
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
     * Checked across the whole rendered panel, not only the paragraph. The
     * announcement is what a reader hears, and it is heard the same whether the
     * live region is the paragraph, the card around it, or the list inside it.
     */
    expect(container.querySelectorAll(LIVE_REGION)).toHaveLength(0);

    /* The paragraph itself carries no role at all, which is stricter than the
       sweep above and pins the element the message actually lives in. */
    const paragraph = container.querySelector('p.or-body');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.getAttribute('role')).toBeNull();
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

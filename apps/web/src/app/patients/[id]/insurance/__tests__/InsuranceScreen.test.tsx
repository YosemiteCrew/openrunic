import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InsuranceScreen } from '@/app/patients/[id]/insurance/InsuranceScreen';
import { MOCK_PATIENTS } from '@/lib/api';

/**
 * Coverage and eligibility. Every outcome the adapter can give has to be a
 * designed state, including the one where the payer says nothing at all, which
 * must not read like a refusal and must not stop a check-in.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients/x/insurance',
}));

/** Testina Patientsson: an active primary and a terminated secondary. */
const TESTINA = MOCK_PATIENTS[7]?.id ?? '';
/** Marek Oyelaran: one coverage the payer cannot find. */
const MAREK = MOCK_PATIENTS[6]?.id ?? '';
/** Demo Rungard: one coverage whose payer does not answer. */
const DEMO = MOCK_PATIENTS[10]?.id ?? '';
/** Aiko Fernstrom has coverage; Halla Gunnarsdottir has none. */
const NO_COVERAGE = MOCK_PATIENTS[3]?.id ?? '';

/* The rail repeats each coverage's status, so an assertion about a card scopes
   itself to that card's region rather than matching the summary line too. Every
   library Card is a region named by its own title. */
function card(payer: string): HTMLElement {
  return screen.getByRole('region', { name: payer });
}

describe('InsuranceScreen', () => {
  it('stacks coverage in billing order and names each slot', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    expect(await screen.findByText('Primary coverage')).toBeInTheDocument();
    expect(screen.getByText('Secondary coverage')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cedar Health Plan' })).toBeInTheDocument();
  });

  it('puts everything a claim needs on the face of the card', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    await screen.findByText('Primary coverage');
    expect(screen.getByText('ZZ-4471-08')).toBeInTheDocument();
    expect(screen.getAllByText('Testina Patientsson (self)')).toHaveLength(2);
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
  });

  it('handles a file nowhere: verification is one button', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    const buttons = await screen.findAllByRole('button', { name: /^Verify eligibility with/ });
    expect(buttons).toHaveLength(2);
  });

  it('answers an active check with the copay and the deductible left', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    const buttons = await screen.findAllByRole('button', { name: /^Verify eligibility with/ });
    fireEvent.click(buttons[0] as HTMLElement);

    expect(await screen.findByText('Deductible remaining')).toBeInTheDocument();
    expect(screen.getByText('Copay today')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Coverage active');
  });

  it('says a terminated plan is terminated and what to do about it', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    const buttons = await screen.findAllByRole('button', { name: /^Verify eligibility with/ });
    fireEvent.click(buttons[1] as HTMLElement);

    expect(
      await within(card('Northwind Supplemental')).findByText('Coverage terminated')
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask the patient for a current insurance card/)).toBeInTheDocument();
  });

  it('says which fields to check when the payer cannot find the member', async () => {
    render(<InsuranceScreen patientId={MAREK} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Verify eligibility with/ }));

    const prairie = card('Prairie State Assistance');
    expect(await within(prairie).findByText('Member not found')).toBeInTheDocument();
    expect(within(prairie).getByText(/Check the member id and date of birth/)).toBeInTheDocument();
  });

  it('distinguishes a payer outage from a refusal and queues the check', async () => {
    render(<InsuranceScreen patientId={DEMO} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Verify eligibility with/ }));

    const federal = card('Federal Senior Programme');
    expect(await within(federal).findByText('Payer did not answer')).toBeInTheDocument();
    expect(within(federal).getByText('Queued')).toBeInTheDocument();
    expect(within(federal).getByText(/check-in can continue/)).toBeInTheDocument();
  });

  it('checks every coverage at once and summarises the answers', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verify all coverages' }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('2 coverages checked');
    expect(toast).toHaveTextContent('1 active');
  });

  it('reorders priority from the keyboard, not only from a drag', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    const down = await screen.findByRole('button', {
      name: 'Move Cedar Health Plan down the priority order',
    });
    down.focus();
    expect(down).toHaveFocus();
    fireEvent.click(document.activeElement as HTMLElement);

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Coverage priority changed');
    expect(toast).toHaveTextContent('secondary coverage');
  });

  it('disables the move that would run off the end of the list', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    expect(
      await screen.findByRole('button', { name: 'Move Cedar Health Plan up the priority order' })
    ).toBeDisabled();
  });

  it('keeps eligibility history once a coverage has been checked twice', async () => {
    render(<InsuranceScreen patientId={MAREK} />);

    const verify = await screen.findByRole('button', { name: /^Verify eligibility with/ });
    fireEvent.click(verify);
    await within(card('Prairie State Assistance')).findByText('Member not found');
    fireEvent.click(screen.getByRole('button', { name: /^Verify eligibility with/ }));

    expect(await screen.findByText('Eligibility history (1)')).toBeInTheDocument();
  });

  it('shows the patient context rail so the record is never ambiguous', async () => {
    render(<InsuranceScreen patientId={TESTINA} />);

    const rail = screen.getByRole('complementary', { name: 'Page context' });
    expect(await within(rail).findByText('Tess Patientsson')).toBeInTheDocument();
    expect(within(rail).getByText('OR-100482')).toBeInTheDocument();
  });

  it('explains self-pay rather than showing a blank panel', async () => {
    render(<InsuranceScreen patientId={NO_COVERAGE} />);

    expect(await screen.findByRole('heading', { name: 'No coverage on file' })).toBeInTheDocument();
    expect(screen.getByText(/visits bill as self-pay/)).toBeInTheDocument();
  });

  it('says the record was not found when the patient id is wrong', async () => {
    render(<InsuranceScreen patientId="not-a-patient" />);

    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});

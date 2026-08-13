import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HealthRecordScreen } from '@/app/health-record/HealthRecordScreen';
import { emptyApi, fails, never, stubApi } from '@/__tests__/support';
import { buildFixtures } from '@/lib/api';
import type { HealthRecord } from '@/lib/api/types';

const FULL = buildFixtures().healthRecord;

const BLANK: HealthRecord = {
  problems: [],
  medications: [],
  allergies: [],
  immunisations: [],
  documents: [],
  results: [],
};

function recordWith(overrides: Partial<HealthRecord>) {
  return stubApi({ getHealthRecord: () => Promise.resolve({ ...BLANK, ...overrides }) });
}

describe('HealthRecordScreen', () => {
  it('puts a plain-language gloss beside every clinical term', async () => {
    render(<HealthRecordScreen api={stubApi()} />);

    expect(await screen.findByText('Hypothyroidism, E03.9')).toBeInTheDocument();
    expect(screen.getByText('Underactive thyroid')).toBeInTheDocument();
    expect(screen.getByText('Levothyroxine')).toBeInTheDocument();
    expect(
      screen.getByText('Replaces the thyroid hormone your body makes too little of')
    ).toBeInTheDocument();
  });

  it('renders every value with its unit and a labelled range state', async () => {
    render(<HealthRecordScreen api={stubApi()} />);

    expect(await screen.findByText('6.8 mIU/L')).toBeInTheDocument();
    expect(screen.getByText('Above the usual range')).toBeInTheDocument();
    expect(screen.getByText('Usual range: 0.4 to 4.0 mIU/L')).toBeInTheDocument();

    expect(screen.getByText('131 g/L')).toBeInTheDocument();
    expect(screen.getByText('In the usual range')).toBeInTheDocument();

    // A result with no range says so rather than implying it is normal.
    expect(screen.getByText('No usual range recorded')).toBeInTheDocument();
    expect(screen.getByText('No usual range was recorded for this test.')).toBeInTheDocument();
  });

  it('never states a medicine strength without its unit', async () => {
    render(<HealthRecordScreen api={stubApi()} />);

    expect(await screen.findByText('75 micrograms')).toBeInTheDocument();
    expect(screen.getByText('5 milligrams')).toBeInTheDocument();
  });

  it('offers a way out of every result, and opens it', async () => {
    render(<HealthRecordScreen api={stubApi()} />);

    const asks = await screen.findAllByRole('button', { name: 'Ask about this result' });
    expect(asks).toHaveLength(3);

    const [first] = asks;
    expect(first).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(first as HTMLElement);

    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('What to do about this number')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Message your care team' })).toHaveAttribute(
      'href',
      '/messages'
    );
  });

  it('opens and closes the explainer from the keyboard alone', async () => {
    render(<HealthRecordScreen api={stubApi()} />);
    const asks = await screen.findAllByRole('button', { name: 'Ask about this result' });
    const first = asks[0] as HTMLElement;

    first.focus();
    await userEvent.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks a severe allergy differently from a mild one, in words', async () => {
    render(<HealthRecordScreen api={stubApi()} />);

    expect(await screen.findByText('Severe')).toBeInTheDocument();
    expect(screen.getByText('Mild')).toBeInTheDocument();
  });

  it('states which parts of the record are empty rather than hiding the section', async () => {
    const { unmount } = render(<HealthRecordScreen api={recordWith({ results: FULL.results })} />);

    expect(await screen.findByText('No conditions are recorded.')).toBeInTheDocument();
    expect(screen.getByText('No medicines are recorded.')).toBeInTheDocument();
    expect(screen.getByText('No allergies are recorded.')).toBeInTheDocument();
    expect(screen.getByText('No vaccinations are recorded.')).toBeInTheDocument();
    expect(screen.getByText('No documents have been added.')).toBeInTheDocument();
    unmount();

    render(<HealthRecordScreen api={recordWith({ problems: FULL.problems })} />);
    expect(
      await screen.findByText('No results have been added to your record.')
    ).toBeInTheDocument();
  });

  it('groups the record under named regions', async () => {
    render(<HealthRecordScreen api={stubApi()} />);
    await screen.findByText('Hypothyroidism, E03.9');

    const documents = screen.getByRole('region', { name: 'Letters and reports' });
    expect(within(documents).getByText('Endocrinology clinic letter')).toBeInTheDocument();
  });

  it('states the loading fact while the record is on its way', () => {
    render(<HealthRecordScreen api={stubApi({ getHealthRecord: never })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your health record.');
  });

  it('says the record is empty when nothing has been written down yet', async () => {
    render(<HealthRecordScreen api={emptyApi()} />);

    expect(
      await screen.findByRole('heading', { name: 'Your record has nothing in it yet.' })
    ).toBeInTheDocument();
  });

  it('states the error and recovers when the reader tries again', async () => {
    let attempt = 0;
    const good = stubApi();
    const api = stubApi({
      getHealthRecord: () => {
        attempt += 1;
        return attempt === 1 ? fails() : good.getHealthRecord();
      },
    });

    render(<HealthRecordScreen api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your health record did not load.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Hypothyroidism, E03.9')).toBeInTheDocument();
  });
});

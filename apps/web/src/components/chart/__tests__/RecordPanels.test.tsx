import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  CareTeamPanel,
  DocumentsPanel,
  MedicationsPanel,
  ResultsPanel,
  VisitsPanel,
} from '@/components/chart/RecordPanels';
import { MOCK_NOW } from '@/lib/api';
import type { ChartSummary } from '@/lib/api/chart';
import { MOCK_CHARTS } from '@/lib/api/mock/chart';

/**
 * The five record tabs, at the states the demo clinic does not contain.
 *
 * `PatientChartScreen.test.tsx` renders these panels against the fixture
 * charts, which is what covers the ordinary reading. The states below are the
 * ones no fixture happens to hold - a note waiting on a cosignature, a result
 * that arrived without a reference range, a patient who has never stopped a
 * medication, two colleagues at the same rank, a document with nothing to
 * measure its expiry against - and every one of them is a state the API can
 * send tomorrow.
 *
 * Each fixture is a fixture chart with one field changed, so nothing here
 * describes a record the rest of the system could not produce.
 */

const CHART = MOCK_CHARTS[0] as ChartSummary;
/* Chart 1 has three medications and has never discontinued one. */
const NEVER_STOPPED = MOCK_CHARTS[1] as ChartSummary;

function badgeFor(text: string): HTMLElement {
  const badge = screen.getByText(text).closest('.or-badge');
  expect(badge, `"${text}" is not inside a badge`).not.toBeNull();
  return badge as HTMLElement;
}

describe('a visit whose note is waiting on a cosignature', () => {
  it('reads as outstanding, the same as an unsigned note', () => {
    /*
     * A resident's note is not finished work until somebody countersigns it,
     * and the queue it sits in is the same queue as an unsigned one. Dropping
     * the second half of `UNSIGNED || COSIGN_PENDING` leaves it falling to the
     * neutral tone, which is the tone a visit with no note at all carries, so
     * the one state that still needs a signature would be the one that stopped
     * asking for it.
     */
    const visit = CHART.visits[0] as ChartSummary['visits'][number];
    render(
      <VisitsPanel
        visits={[
          { ...visit, id: 'cosign', noteState: 'COSIGN_PENDING' },
          { ...visit, id: 'unsigned', noteState: 'UNSIGNED' },
          { ...visit, id: 'signed', noteState: 'SIGNED' },
          /* The two states that need nothing from anyone, so the tone that
             means "nothing outstanding" is read from a rendered badge rather
             than assumed to be whatever is left over. */
          { ...visit, id: 'draft', noteState: 'DRAFT' },
          { ...visit, id: 'none', noteState: 'NONE' },
        ]}
      />
    );

    const cosign = badgeFor('Cosign pending');
    const unsigned = badgeFor('Unsigned');
    const signed = badgeFor('Signed');

    expect(cosign.className).toBe(unsigned.className);
    expect(cosign.className).not.toBe(signed.className);

    /* And not the tone a visit with no note carries, which is where dropping
       the second half of the condition sends it. */
    const nothingOutstanding = badgeFor('No note');
    expect(cosign.className).not.toBe(nothingOutstanding.className);
    expect(badgeFor('Draft').className).toBe(nothingOutstanding.className);
  });
});

describe('a result that arrived without a reference range', () => {
  it('says so rather than showing an empty range', () => {
    /*
     * Plenty of analytes have no range: a qualitative result, or one the lab
     * sends without bounds. An empty cell there reads as "in range" to somebody
     * scanning a column, which is the reading worth preventing.
     */
    const observation = CHART.results[0] as ChartSummary['results'][number];
    render(
      <ResultsPanel
        results={[
          { ...observation, id: 'unbounded', referenceLow: null, referenceHigh: null },
          { ...observation, id: 'bounded' },
        ]}
      />
    );

    /* One of the two, not both: the bounded control proves the cell is filled
       from the observation rather than always saying this. */
    expect(screen.getAllByText('Not recorded')).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Not recorded/ })).toBeInTheDocument();
  });
});

describe('a patient who has never stopped a medication', () => {
  it('is not shown an empty discontinued table', () => {
    /*
     * The second card is the answer to "what did we stop and when". With
     * nothing to put in it, a card and a caption and a header row say a
     * question was asked and answered when it was neither.
     */
    render(<MedicationsPanel medications={NEVER_STOPPED.medications} />);

    expect(screen.getByText('Current medications')).toBeInTheDocument();
    expect(screen.queryByText('Discontinued')).not.toBeInTheDocument();
  });

  it('still gets the table once something has been stopped', () => {
    render(<MedicationsPanel medications={CHART.medications} />);

    expect(screen.getByText('Discontinued')).toBeInTheDocument();
  });
});

describe('a document expiry with no clinic day to measure against', () => {
  it('shows the date plainly rather than badging it as checked', () => {
    /*
     * A badge is a verdict. Reached with an unreadable clock, the date has been
     * compared against nothing, and a green-looking cell that was never checked
     * is worse than a date the reader checks themselves.
     */
    const document = CHART.documents.find((entry) => entry.expiresOn !== null);
    expect(document, 'no fixture document carries an expiry').toBeDefined();
    if (document === undefined) return;

    const checked = render(<DocumentsPanel documents={[document]} now={MOCK_NOW} />);
    const badge = checked.container.querySelector('.or-badge');
    expect(badge, 'a readable clock should reach a verdict').not.toBeNull();
    checked.unmount();

    const unchecked = render(<DocumentsPanel documents={[document]} now="" />);
    expect(unchecked.container.querySelector('.or-badge')).toBeNull();
    /* The date is still there. Rendering nothing would hide the expiry
       entirely, which is a worse answer than an unverdicted one. */
    expect(within(unchecked.container).getByRole('row', { name: /2026/ })).toBeInTheDocument();
  });
});

describe('two colleagues at the same rank', () => {
  it('are ordered by name rather than by the order they arrived in', () => {
    /*
     * The rank comparison returns 0 for two care team members, and without the
     * name tie-break the list keeps whatever order the directory sent. A care
     * team that reorders itself between two reads of the same chart is one a
     * clinician cannot scan.
     */
    const primary = CHART.careTeam.find((member) => member.relationship === 'PRIMARY');
    expect(primary, 'no fixture care team has a primary provider').toBeDefined();
    if (primary === undefined) return;

    render(
      <CareTeamPanel
        chart={{
          ...CHART,
          careTeam: [
            { ...primary, id: 'zeta', name: 'Zeta Vaskevich', relationship: 'CARE_TEAM' },
            { ...primary, id: 'adia', name: 'Adia Nwosu', relationship: 'CARE_TEAM' },
          ],
        }}
      />
    );

    const names = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.or-chart-item__title')?.textContent);

    expect(names).toEqual(['Adia Nwosu', 'Zeta Vaskevich']);
  });
});

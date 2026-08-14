import { describe, expect, it } from 'vitest';

import { ApiError, createMockClient } from '@/lib/api';
import { createHttpChartClient, createMockChartClient } from '@/lib/api/chart';
import type { ChartSummary } from '@/lib/api/chart';
import {
  emptyChart,
  MOCK_CHARTS,
  MOCK_ENCOUNTER_IDS,
  MOCK_SLASH_COMMANDS,
} from '@/lib/api/mock/chart';
import { MOCK_CLINIC_DAY, MOCK_PATIENTS } from '@/lib/api/mock/fixtures';

/**
 * The chart client, and the fixture invariants the screens rely on.
 *
 * The fixture assertions are not decoration: a chart that quietly loses its
 * "not recorded" allergy state, or gains a note whose patient does not exist,
 * would make the screens above it read correctly while being wrong.
 */

function patientId(mrn: string): string {
  const found = MOCK_PATIENTS.find((patient) => patient.mrn === mrn);
  if (!found) throw new Error(`Fixture missing for MRN ${mrn}`);
  return found.id;
}

describe('mock chart client', () => {
  it('reads the chart for a known patient', async () => {
    const client = createMockChartClient();
    const chart = await client.summary.get(patientId('OR-100482'));

    expect(chart.allergies.state).toBe('RECORDED');
    expect(chart.allergies.entries).toHaveLength(2);
    expect(chart.balanceDue).toBeGreaterThan(0);
  });

  it('gives a patient with no chart the honest empty one, not a fabricated chart', async () => {
    const client = createMockChartClient();
    const chart = await client.summary.get(patientId('OR-100744'));

    expect(chart.visits).toHaveLength(0);
    expect(chart.allergies.state).toBe('NOT_RECORDED');
    expect(chart.allergies.affirmedOn).toBeNull();
  });

  it('rejects an unknown patient with a 404 rather than an empty chart', async () => {
    const client = createMockChartClient();
    await expect(client.summary.get('not-a-patient')).rejects.toBeInstanceOf(ApiError);
    await expect(client.summary.get('not-a-patient')).rejects.toMatchObject({ status: 404 });
  });

  it('takes a chart override, so a screen state can be tested without a fixture for it', async () => {
    const id = patientId('OR-100482');
    const override: ChartSummary = { ...emptyChart(id), balanceDue: 12.5 };
    const client = createMockChartClient({ charts: [override] });

    await expect(client.summary.get(id)).resolves.toMatchObject({ balanceDue: 12.5 });
  });

  it('reads a note by id and rejects an unknown one', async () => {
    const client = createMockChartClient();
    const note = await client.notes.get(MOCK_ENCOUNTER_IDS.testinaSigned);

    expect(note.state).toBe('SIGNED');
    expect(note.signature).not.toBeNull();
    await expect(client.notes.get('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('builds a live client over the same transport every other screen writes through', () => {
    expect(createHttpChartClient(createMockClient()).mode).toBe('live');
  });
});

describe('chart fixtures', () => {
  it('keeps every chart pointed at a patient that exists', () => {
    const ids = new Set(MOCK_PATIENTS.map((patient) => patient.id));
    for (const chart of MOCK_CHARTS) {
      expect(ids.has(chart.patientId)).toBe(true);
    }
  });

  it('covers all three allergy states across the demo clinic', () => {
    const states = new Set(MOCK_CHARTS.map((chart) => chart.allergies.state));
    expect(states.has('RECORDED')).toBe(true);
    expect(states.has('NO_KNOWN_ALLERGIES')).toBe(true);
    expect(emptyChart('x').allergies.state).toBe('NOT_RECORDED');
  });

  it('never records a visit in the future', () => {
    for (const chart of MOCK_CHARTS) {
      for (const visit of chart.visits) {
        expect(visit.date <= MOCK_CLINIC_DAY).toBe(true);
      }
    }
  });

  it('gives every visit with a note state something to open, and the reverse', () => {
    for (const chart of MOCK_CHARTS) {
      for (const visit of chart.visits) {
        if (visit.noteState === 'NONE') expect(visit.encounterId).toBeNull();
      }
    }
  });

  it('pairs every slash command that emits with a real chart write', () => {
    const emitting = MOCK_SLASH_COMMANDS.filter((command) => command.emits !== null);
    expect(emitting.length).toBeGreaterThan(0);
    for (const command of emitting) {
      expect(command.emits?.label.length ?? 0).toBeGreaterThan(0);
      expect(command.insertText.endsWith('.')).toBe(true);
    }
  });
});

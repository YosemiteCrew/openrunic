import { describe, expect, it } from 'vitest';

import { ToolError, isToolError } from './errors.js';
import { isPatientSurface } from './principal.js';
import { appointmentsFindSlots } from './tools/appointments-find-slots.js';
import { chartSearch } from './tools/chart-search.js';
import { denialTriage } from './tools/denial-triage.js';
import { formsDraftDefinition } from './tools/forms-draft-definition.js';
import { priorauthAssemblePacket } from './tools/priorauth-assemble-packet.js';
import { recordingApiClient, stubPrincipal, stubToolContext } from './testing/index.js';

/**
 * The branches a happy-path suite misses: optional arguments, absent codes, and
 * the fallbacks that only fire when a field the model could have supplied is
 * not there.
 */

describe('surfaces', () => {
  it('names the patient surface', () => {
    expect(isPatientSurface(stubPrincipal({ surface: 'patient' }))).toBe(true);
    expect(isPatientSurface(stubPrincipal())).toBe(false);
  });
});

describe('tool errors', () => {
  it('is recognised across a module boundary', () => {
    expect(isToolError(new ToolError('AGENT_TOOL_FAILED', 'nope'))).toBe(true);
    expect(isToolError(new Error('nope'))).toBe(false);
  });

  it('carries a cause when one is given', () => {
    const cause = new Error('root');
    expect(new ToolError('AGENT_TOOL_FAILED', 'wrapped', { cause }).cause).toBe(cause);
  });
});

describe('chart.search argument handling', () => {
  it('passes every optional patient filter through, and only those given', async () => {
    const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));
    await chartSearch.run(
      {
        resource: 'patient',
        family: 'Patientsson',
        given: 'Testina',
        birthDate: '1985-04-02',
        active: false,
      },
      stubToolContext({ api })
    );

    expect(api.calls[0]?.request.query).toEqual({
      pageSize: 25,
      family: 'Patientsson',
      given: 'Testina',
      birthDate: '1985-04-02',
      active: false,
    });
  });

  it('passes every optional appointment filter through', async () => {
    const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));
    await chartSearch.run(
      {
        resource: 'appointment',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
        status: 'booked',
      },
      stubToolContext({ api })
    );

    expect(api.calls[0]?.request.query).toEqual({
      pageSize: 25,
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      status: 'booked',
    });
  });

  it('reads an encounter window with both bounds', async () => {
    const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));
    await chartSearch.run(
      { resource: 'encounter', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
      stubToolContext({ api })
    );

    expect(api.calls[0]?.request.path).toBe('/bff/v0/encounters');
  });

  it('renders a bare resource query with no terms', async () => {
    const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));
    const result = (await chartSearch.run({ resource: 'encounter' }, stubToolContext({ api }))) as {
      queryRan: string;
    };
    expect(result.queryRan).toBe('encounter');
  });

  it('shows the values an encounter records when it has them', async () => {
    const api = recordingApiClient(() => ({
      data: [
        {
          id: '018f2b40-0000-7000-8000-00000000e001',
          status: 'finished',
          periodStart: '2026-06-01T08:00:00.000Z',
          classCode: 'AMB',
        },
      ],
      page: { total: 1 },
    }));

    const result = (await chartSearch.run({ resource: 'encounter' }, stubToolContext({ api }))) as {
      rows: { label: string; fields: { value: string }[] }[];
    };

    expect(result.rows[0]?.label).toBe('AMB');
    expect(result.rows[0]?.fields[0]?.value).toBe('finished');
  });
});

describe('denial.triage evidence sets', () => {
  it('names documentation for a coding denial', async () => {
    const api = recordingApiClient(() => ({
      data: [
        { id: '018f2b40-0000-7000-8000-00000000d001', status: 'denied', denialReasonCode: 'CO-11' },
      ],
      page: { total: 1 },
    }));
    const result = (await denialTriage.run({}, stubToolContext({ api }))) as {
      rows: { evidence: { resourceType: string }[] }[];
    };
    expect(result.rows[0]?.evidence[0]?.resourceType).toBe('Encounter');
  });

  it('names the submission date for a filing denial', async () => {
    const api = recordingApiClient(() => ({
      data: [
        { id: '018f2b40-0000-7000-8000-00000000d001', status: 'denied', denialReasonCode: 'CO-29' },
      ],
      page: { total: 1 },
    }));
    const result = (await denialTriage.run({}, stubToolContext({ api }))) as {
      rows: { evidence: { field: string }[] }[];
    };
    expect(result.rows[0]?.evidence[0]?.field).toBe('submittedAt');
  });

  it('passes a date window through to the claim list', async () => {
    const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));
    await denialTriage.run(
      { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
      stubToolContext({ api })
    );
    expect(api.calls[0]?.request.query).toMatchObject({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('fallbacks that only fire on an absent field', () => {
  it('falls back to the payer code when the payer has no display name', async () => {
    const result = (await priorauthAssemblePacket.run(
      {
        payer: { system: 'payer', code: 'PAYER-2' },
        memberId: 'M-2',
        serviceCode: { system: 'CPT', code: '97110' },
        diagnosisCodes: [{ system: 'ICD-10-CM', code: 'M54.5' }],
        requestedUnits: 4,
        startDate: '2026-09-01',
        renderingProviderId: '018f2b40-0000-7000-8000-00000000b001',
        justification: 'Documented conservative management.',
      },
      stubToolContext()
    )) as { proposal: { effect: { label: string; value: string }[] } };

    expect(result.proposal.effect[0]).toEqual({ label: 'Payer', value: 'PAYER-2' });
  });

  it('omits the options key entirely for a field that has none', async () => {
    const result = (await formsDraftDefinition.run(
      {
        title: 'Intake',
        purpose: 'Collect arrival details.',
        fields: [{ key: 'arrivedAt', label: 'Arrived at', type: 'date', required: true }],
      },
      stubToolContext()
    )) as { proposal: { commit: { body: { fields: Record<string, unknown>[] } } } };

    expect(result.proposal.commit.body.fields[0]).not.toHaveProperty('options');
  });

  it('counts a schedule with nothing booked', async () => {
    const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));
    const result = (await appointmentsFindSlots.run(
      {
        providerId: '018f2b40-0000-7000-8000-00000000b001',
        from: '2026-09-01T09:00:00.000Z',
        to: '2026-09-01T10:00:00.000Z',
        durationMinutes: 30,
      },
      stubToolContext({ api })
    )) as { consideredCount: number; slots: unknown[] };

    expect(result.consideredCount).toBe(0);
    expect(result.slots).toHaveLength(3);
  });
});

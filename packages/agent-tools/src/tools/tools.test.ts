import { describe, expect, it } from 'vitest';

import { ToolError } from '../errors.js';
import type { ProposalResult } from '../proposal.js';
import {
  TEST_PATIENT_ID,
  recordingApiClient,
  stubPrincipal,
  stubToolContext,
} from '../testing/index.js';

import { appointmentsFindSlots, freeSlots } from './appointments-find-slots.js';
import { createAppointmentsPropose, DEFAULT_APPOINTMENT_ENVELOPE } from './appointments-propose.js';
import { auditQuery } from './audit-query.js';
import { chartSearch } from './chart-search.js';
import { codingSuggest } from './coding-suggest.js';
import { denialDraftAppeal } from './denial-draft-appeal.js';
import { categorise, denialTriage } from './denial-triage.js';
import { documentsExtractCandidates } from './documents-extract-candidates.js';
import { formsDraftDefinition } from './forms-draft-definition.js';
import { inboxClassify } from './inbox-classify.js';
import { messagesDraftReply } from './messages-draft-reply.js';
import { priorauthAssemblePacket } from './priorauth-assemble-packet.js';

/**
 * The catalogue, exercised. Every read tool is driven against a recording
 * client; every draft tool is asserted to produce a proposal and nothing else.
 *
 * Synthetic data only. "Testina Patientsson" is the repository's invented
 * identity and it is the only kind that belongs in a fixture.
 */

const PATIENT_PAGE = {
  data: [
    {
      id: TEST_PATIENT_ID,
      mrn: 'MRN-0001',
      name: { given: 'Testina', family: 'Patientsson' },
      birthDate: '1985-04-02',
      active: true,
    },
  ],
  page: { total: 1 },
};

const APPOINTMENT_ID = '018f2b40-0000-7000-8000-00000000a001';
const PROVIDER_ID = '018f2b40-0000-7000-8000-00000000b001';
const FACILITY_ID = '018f2b40-0000-7000-8000-00000000c001';
const CLAIM_ID = '018f2b40-0000-7000-8000-00000000d001';
const ENCOUNTER_ID = '018f2b40-0000-7000-8000-00000000e001';
const DOCUMENT_ID = '018f2b40-0000-7000-8000-00000000f001';
const TASK_ID = '018f2b40-0000-7000-8000-000000010001';
const THREAD_ID = '018f2b40-0000-7000-8000-000000011001';

function proposalOf(result: unknown): ProposalResult['proposal'] {
  return (result as ProposalResult).proposal;
}

describe('chart.search', () => {
  it('asks the patient index and returns records rather than prose', async () => {
    const api = recordingApiClient(() => PATIENT_PAGE);
    const result = await chartSearch.run(
      { resource: 'patient', text: 'Patientsson' },
      stubToolContext({ api })
    );

    expect(api.calls[0]?.request.path).toBe('/bff/v0/patients');
    expect(api.calls[0]?.request.query).toMatchObject({ q: 'Patientsson', pageSize: 25 });
    expect(result).toMatchObject({
      queryRan: 'patient text=Patientsson',
      total: 1,
      shown: 1,
      rows: [{ type: 'Patient', label: 'Patientsson, Testina' }],
    });
  });

  it('carries a source reference on every row', async () => {
    const api = recordingApiClient(() => PATIENT_PAGE);
    const result = (await chartSearch.run({ resource: 'patient' }, stubToolContext({ api }))) as {
      rows: { source: { resourceType: string; field: string } }[];
    };
    expect(result.rows[0]?.source).toEqual({
      resourceType: 'Patient',
      resourceId: TEST_PATIENT_ID,
      field: 'mrn',
    });
  });

  it('projects a biller down to the identifier, not the name', async () => {
    const api = recordingApiClient(() => PATIENT_PAGE);
    const result = (await chartSearch.run(
      { resource: 'patient' },
      stubToolContext({ api, principal: stubPrincipal({ roleIds: ['biller'] }) })
    )) as { rows: { label: string; fields: unknown[] }[] };

    expect(result.rows[0]?.label).toBe('MRN-0001');
    expect(result.rows[0]?.fields).toHaveLength(2);
  });

  it('reads the schedule when asked for appointments', async () => {
    const api = recordingApiClient(() => ({
      data: [
        {
          id: APPOINTMENT_ID,
          patientId: null,
          providerId: PROVIDER_ID,
          type: { code: 'FOLLOWUP', display: 'Follow up' },
          status: 'booked',
          start: '2026-09-01T09:00:00.000Z',
          durationMinutes: 20,
        },
      ],
      page: { total: 1 },
    }));

    const result = (await chartSearch.run(
      { resource: 'appointment', status: 'booked', providerId: PROVIDER_ID },
      stubToolContext({ api })
    )) as { rows: { type: string }[] };

    expect(api.calls[0]?.request.path).toBe('/bff/v0/appointments');
    expect(result.rows[0]?.type).toBe('Appointment');
  });

  it('reads encounters, and reports what is not recorded rather than inventing it', async () => {
    const api = recordingApiClient(() => ({
      data: [{ id: ENCOUNTER_ID }],
      page: { total: 1 },
    }));

    const result = (await chartSearch.run(
      { resource: 'encounter', from: '2026-01-01T00:00:00.000Z' },
      stubToolContext({ api })
    )) as { rows: { fields: { name: string; value: string }[] }[] };

    expect(result.rows[0]?.fields).toEqual([
      { name: 'Status', value: 'unknown' },
      { name: 'Started', value: 'unknown' },
    ]);
  });

  it('refuses a list the API described differently, rather than reading it loosely', async () => {
    const api = recordingApiClient(() => ({ patients: [] }));
    await expect(
      chartSearch.run({ resource: 'patient' }, stubToolContext({ api }))
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_OUTPUT_INVALID' });
  });

  it('rejects an attempt to name an organisation in the arguments', async () => {
    await expect(
      chartSearch.run({ resource: 'patient', tenantId: 'somewhere-else' }, stubToolContext())
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });
});

describe('denial.triage', () => {
  it('classifies by reason code and lists the evidence a human needs', async () => {
    const api = recordingApiClient(() => ({
      data: [
        { id: CLAIM_ID, status: 'denied', denialReasonCode: 'CO-16', serviceDate: '2026-07-01' },
      ],
      page: { total: 1 },
    }));

    const result = (await denialTriage.run({ reasonCode: 'CO-16' }, stubToolContext({ api }))) as {
      rows: { category: string; evidence: unknown[] }[];
    };

    expect(api.calls[0]?.request.query).toMatchObject({ status: 'denied' });
    expect(result.rows[0]?.category).toBe('missing-information');
    expect(result.rows[0]?.evidence).toHaveLength(2);
  });

  it('says uncategorised rather than guessing at an unknown code', () => {
    expect(categorise('ZZ-999')).toBe('uncategorised');
    expect(categorise('CO-4')).toBe('coding-modifier');
    expect(categorise('CO-29')).toBe('timely-filing');
    expect(categorise('PR-1')).toBe('patient-deductible');
  });

  it('handles a denied claim with no reason code recorded', async () => {
    const api = recordingApiClient(() => ({
      data: [{ id: CLAIM_ID, status: 'denied', denialReasonCode: null }],
      page: { total: 1 },
    }));
    const result = (await denialTriage.run({}, stubToolContext({ api }))) as {
      rows: { claim: { fields: { value: string }[] }; category: string }[];
    };
    expect(result.rows[0]?.category).toBe('uncategorised');
    expect(result.rows[0]?.claim.fields[1]?.value).toBe('not recorded');
  });

  it('refuses a claim list it cannot parse', async () => {
    const api = recordingApiClient(() => ({ claims: [] }));
    await expect(denialTriage.run({}, stubToolContext({ api }))).rejects.toMatchObject({
      code: 'AGENT_TOOL_OUTPUT_INVALID',
    });
  });
});

describe('denial.draftAppeal', () => {
  it('produces a pending proposal and performs no call', async () => {
    const api = recordingApiClient();
    const result = await denialDraftAppeal.run(
      {
        claimId: CLAIM_ID,
        denialReasonCode: 'CO-16',
        citations: [{ resourceType: 'Encounter', resourceId: ENCOUNTER_ID, field: 'note' }],
        narrative: 'The documentation supports the service billed.',
      },
      stubToolContext({ api })
    );

    expect(api.calls).toHaveLength(0);
    expect(result).toMatchObject({ status: 'pending' });
    expect(proposalOf(result).commit).toMatchObject({ method: 'POST', path: '/bff/v0/claims' });
  });

  it('refuses a draft with no cited row', async () => {
    await expect(
      denialDraftAppeal.run(
        { claimId: CLAIM_ID, denialReasonCode: 'CO-16', citations: [], narrative: 'Because.' },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });
});

describe('priorauth.assemblePacket', () => {
  it('builds the form from coded values and lets the model write only the justification', async () => {
    const result = await priorauthAssemblePacket.run(
      {
        payer: { system: 'payer', code: 'PAYER-1', display: 'Example Health Plan' },
        memberId: 'M-1',
        serviceCode: { system: 'CPT', code: '97110' },
        diagnosisCodes: [{ system: 'ICD-10-CM', code: 'M54.5' }],
        requestedUnits: 12,
        startDate: '2026-09-01',
        renderingProviderId: PROVIDER_ID,
        justification: 'Conservative management has been documented for six weeks.',
      },
      stubToolContext()
    );

    const proposal = proposalOf(result);
    expect(proposal.commit.path).toBe('/bff/v0/forms');
    expect(proposal.commit.body['justification']).toBeTypeOf('string');
    expect(proposal.effect[0]).toEqual({ label: 'Payer', value: 'Example Health Plan' });
  });
});

describe('forms.draftDefinition', () => {
  it('drafts a definition for review', async () => {
    const result = await formsDraftDefinition.run(
      {
        title: 'Intake',
        purpose: 'Collect arrival details at the desk.',
        fields: [
          { key: 'arrivedAt', label: 'Arrived at', type: 'date', required: true },
          {
            key: 'transport',
            label: 'How did you travel?',
            type: 'choice',
            required: false,
            options: ['Walked', 'Drove'],
          },
        ],
      },
      stubToolContext()
    );

    expect(proposalOf(result).effect).toContainEqual({ label: 'Fields', value: '2' });
  });

  it('refuses a choice field with fewer than two options', async () => {
    await expect(
      formsDraftDefinition.run(
        {
          title: 'Intake',
          purpose: 'Collect arrival details.',
          fields: [{ key: 'a', label: 'A', type: 'choice', required: false, options: ['Only'] }],
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });

  it('refuses duplicate field keys', async () => {
    await expect(
      formsDraftDefinition.run(
        {
          title: 'Intake',
          purpose: 'Collect arrival details.',
          fields: [
            { key: 'a', label: 'A', type: 'text', required: false },
            { key: 'a', label: 'A again', type: 'text', required: false },
          ],
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });
});

describe('inbox.classify', () => {
  it('proposes a queue and a position, and marks the item as externally sourced', async () => {
    const result = await inboxClassify.run(
      {
        taskId: TASK_ID,
        category: 'refill',
        currentPosition: 8,
        proposedPosition: 3,
        slaMinutesRemaining: 120,
      },
      stubToolContext()
    );

    const proposal = proposalOf(result);
    expect(proposal.derivedFromUntrusted).toBe(true);
    expect(proposal.commit).toMatchObject({ method: 'PATCH', path: `/bff/v0/tasks/${TASK_ID}` });
  });

  it('refuses to move an item down a queue', async () => {
    await expect(
      inboxClassify.run(
        {
          taskId: TASK_ID,
          category: 'billing',
          currentPosition: 2,
          proposedPosition: 9,
          slaMinutesRemaining: 30,
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });
});

describe('audit.query', () => {
  it('returns the rows and the query that ran, and has nowhere to put a conclusion', async () => {
    const api = recordingApiClient(() => ({
      data: [
        {
          id: 'evt-1',
          seq: '4',
          occurredAt: '2026-08-01T10:00:00.000Z',
          actorId: 'user-1',
          actorType: 'user',
          action: 'phi.read',
          targetType: 'Request',
          outcome: 'success',
        },
      ],
      page: { total: 1 },
    }));

    const result = (await auditQuery.run({ action: 'phi.read' }, stubToolContext({ api }))) as {
      queryRan: string;
      rowCount: number;
      rows: unknown[];
    };

    expect(result.queryRan).toBe('action=phi.read');
    expect(result.rowCount).toBe(1);
    expect(Object.keys(result)).toEqual(['queryRan', 'rowCount', 'rows']);
  });

  it('refuses an audit list it cannot parse', async () => {
    const api = recordingApiClient(() => ({ events: [] }));
    await expect(auditQuery.run({}, stubToolContext({ api }))).rejects.toMatchObject({
      code: 'AGENT_TOOL_OUTPUT_INVALID',
    });
  });
});

describe('appointments.findSlots', () => {
  it('computes free slots from booked rows, deterministically', () => {
    const start = Date.parse('2026-09-01T09:00:00.000Z');
    const slots = freeSlots(start, start + 90 * 60_000, 30, [
      { start: start + 15 * 60_000, end: start + 45 * 60_000 },
    ]);
    expect(slots.map((slot) => new Date(slot).toISOString())).toEqual([
      '2026-09-01T09:45:00.000Z',
      '2026-09-01T10:00:00.000Z',
    ]);
  });

  it('stops at the slot cap rather than returning a whole fortnight', () => {
    const start = Date.parse('2026-09-01T09:00:00.000Z');
    expect(freeSlots(start, start + 24 * 60 * 60_000, 15, [])).toHaveLength(12);
  });

  it('ignores cancelled and missed appointments when computing free time', async () => {
    const api = recordingApiClient(() => ({
      data: [
        {
          id: APPOINTMENT_ID,
          providerId: PROVIDER_ID,
          status: 'cancelled',
          start: '2026-09-01T09:00:00.000Z',
          durationMinutes: 60,
        },
      ],
      page: { total: 1 },
    }));

    const result = (await appointmentsFindSlots.run(
      {
        providerId: PROVIDER_ID,
        from: '2026-09-01T09:00:00.000Z',
        to: '2026-09-01T10:00:00.000Z',
        durationMinutes: 30,
      },
      stubToolContext({ api })
    )) as { slots: unknown[]; consideredCount: number };

    expect(result.consideredCount).toBe(1);
    expect(result.slots).toHaveLength(3);
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(
      appointmentsFindSlots.run(
        {
          providerId: PROVIDER_ID,
          from: '2026-09-02T09:00:00.000Z',
          to: '2026-09-01T09:00:00.000Z',
          durationMinutes: 30,
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });

  it('refuses a window wider than the cap', async () => {
    await expect(
      appointmentsFindSlots.run(
        {
          providerId: PROVIDER_ID,
          from: '2026-09-01T09:00:00.000Z',
          to: '2026-10-01T09:00:00.000Z',
          durationMinutes: 30,
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });

  it('refuses a schedule it cannot parse', async () => {
    const api = recordingApiClient(() => ({ appointments: [] }));
    await expect(
      appointmentsFindSlots.run(
        {
          providerId: PROVIDER_ID,
          from: '2026-09-01T09:00:00.000Z',
          to: '2026-09-01T10:00:00.000Z',
          durationMinutes: 30,
        },
        stubToolContext({ api })
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_OUTPUT_INVALID' });
  });
});

describe('appointments.propose', () => {
  const now = () => Date.parse('2026-09-01T00:00:00.000Z');
  const tool = createAppointmentsPropose(DEFAULT_APPOINTMENT_ENVELOPE, now);
  const withChart = stubToolContext({
    principal: stubPrincipal({ compartment: { patientId: TEST_PATIENT_ID } }),
  });

  it('takes the patient from the open chart, never from an argument', async () => {
    const result = await tool.run(
      {
        mode: 'book',
        facilityId: FACILITY_ID,
        providerId: PROVIDER_ID,
        typeCode: 'FOLLOWUP',
        typeDisplay: 'Follow up',
        start: '2026-09-02T09:00:00.000Z',
        durationMinutes: 20,
      },
      withChart
    );

    expect(proposalOf(result).commit.body['patientId']).toBe(TEST_PATIENT_ID);
    expect(proposalOf(result).affects).toEqual([{ type: 'Patient', id: TEST_PATIENT_ID }]);
  });

  it('refuses when no chart is open', async () => {
    const error: unknown = await tool
      .run(
        {
          mode: 'book',
          facilityId: FACILITY_ID,
          providerId: PROVIDER_ID,
          typeCode: 'FOLLOWUP',
          typeDisplay: 'Follow up',
          start: '2026-09-02T09:00:00.000Z',
          durationMinutes: 20,
        },
        stubToolContext()
      )
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('AGENT_SCOPE_DENIED');
  });

  it('degrades to a staff request inside the lead time', async () => {
    const result = await tool.run(
      {
        mode: 'book',
        facilityId: FACILITY_ID,
        providerId: PROVIDER_ID,
        typeCode: 'FOLLOWUP',
        typeDisplay: 'Follow up',
        start: '2026-09-01T00:30:00.000Z',
        durationMinutes: 20,
      },
      withChart
    );
    expect(result).toMatchObject({ status: 'deferred' });
  });

  it('degrades to a staff request beyond the duration cap', async () => {
    const result = await tool.run(
      {
        mode: 'book',
        facilityId: FACILITY_ID,
        providerId: PROVIDER_ID,
        typeCode: 'FOLLOWUP',
        typeDisplay: 'Follow up',
        start: '2026-09-02T09:00:00.000Z',
        durationMinutes: 240,
      },
      withChart
    );
    expect(result).toMatchObject({ status: 'deferred' });
  });

  it('degrades to a staff request for a type outside the envelope', async () => {
    const result = await tool.run(
      {
        mode: 'book',
        facilityId: FACILITY_ID,
        providerId: PROVIDER_ID,
        typeCode: 'SURGERY',
        typeDisplay: 'Surgery',
        start: '2026-09-02T09:00:00.000Z',
        durationMinutes: 60,
      },
      withChart
    );
    expect(result).toMatchObject({ status: 'deferred' });
  });

  it('proposes a reschedule as a patch to the existing row', async () => {
    const result = await tool.run(
      {
        mode: 'reschedule',
        appointmentId: APPOINTMENT_ID,
        currentStatus: 'booked',
        start: '2026-09-03T09:00:00.000Z',
        durationMinutes: 20,
      },
      withChart
    );

    expect(proposalOf(result).commit).toMatchObject({
      method: 'PATCH',
      path: `/bff/v0/appointments/${APPOINTMENT_ID}`,
    });
  });

  it('will not move an appointment a person has already acted on', async () => {
    const result = await tool.run(
      {
        mode: 'reschedule',
        appointmentId: APPOINTMENT_ID,
        currentStatus: 'arrived',
        start: '2026-09-03T09:00:00.000Z',
        durationMinutes: 20,
      },
      withChart
    );
    expect(result).toMatchObject({ status: 'deferred' });
  });
});

describe('documents.extractCandidates', () => {
  it('proposes candidates for reconciliation, each with its source', async () => {
    const result = await documentsExtractCandidates.run(
      {
        encounterId: ENCOUNTER_ID,
        documentId: DOCUMENT_ID,
        candidates: [
          {
            concept: { system: 'LOINC', code: '4548-4', display: 'Haemoglobin A1c' },
            value: '6.7',
            unit: '%',
            effectiveDate: '2026-06-14',
            source: { resourceType: 'Document', resourceId: DOCUMENT_ID, field: 'page1' },
          },
          {
            concept: { system: 'LOINC', code: '2093-3' },
            source: { resourceType: 'Document', resourceId: DOCUMENT_ID, field: 'page2' },
          },
        ],
      },
      stubToolContext({ principal: stubPrincipal({ compartment: { patientId: TEST_PATIENT_ID } }) })
    );

    const proposal = proposalOf(result);
    expect(proposal.derivedFromUntrusted).toBe(true);
    expect(proposal.effect).toContainEqual({ label: 'Candidates with a value', value: '1' });
    expect(proposal.commit.path).toBe('/bff/v0/encounters');
  });

  it('refuses a candidate with no source span', async () => {
    await expect(
      documentsExtractCandidates.run(
        {
          encounterId: ENCOUNTER_ID,
          documentId: DOCUMENT_ID,
          candidates: [{ concept: { system: 'LOINC', code: '4548-4' } }],
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });
});

describe('messages.draftReply', () => {
  it('drafts into a review queue and never sends', async () => {
    const result = await messagesDraftReply.run(
      {
        threadId: THREAD_ID,
        body: 'Your results are in the portal.',
        derivedFromPatientText: true,
      },
      stubToolContext({ principal: stubPrincipal({ compartment: { patientId: TEST_PATIENT_ID } }) })
    );

    const proposal = proposalOf(result);
    expect(proposal.commit.body['status']).toBe('awaiting-review');
    expect(proposal.effect).toContainEqual({ label: 'Status', value: 'unsent draft' });
    expect(proposal.derivedFromUntrusted).toBe(true);
  });
});

describe('coding.suggest', () => {
  it('orders by code and carries no money anywhere', async () => {
    const result = await codingSuggest.run(
      {
        claimId: CLAIM_ID,
        suggestions: [
          {
            system: 'ICD-10-CM',
            code: 'M54.5',
            level: 0,
            supportedLevel: 0,
            source: { resourceType: 'Encounter', resourceId: ENCOUNTER_ID, field: 'assessment' },
          },
          {
            system: 'CPT',
            code: '99213',
            level: 3,
            supportedLevel: 4,
            source: { resourceType: 'Encounter', resourceId: ENCOUNTER_ID, field: 'plan' },
          },
        ],
      },
      stubToolContext()
    );

    const proposal = proposalOf(result);
    expect(proposal.effect).toContainEqual({
      label: 'Codes',
      value: 'CPT 99213, ICD-10-CM M54.5',
    });
    expect(JSON.stringify(proposal)).not.toMatch(/cents|amount|reimburse/i);
  });

  it('refuses a level above what the documentation supports', async () => {
    await expect(
      codingSuggest.run(
        {
          claimId: CLAIM_ID,
          suggestions: [
            {
              system: 'CPT',
              code: '99215',
              level: 5,
              supportedLevel: 3,
              source: { resourceType: 'Encounter', resourceId: ENCOUNTER_ID, field: 'plan' },
            },
          ],
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });

  it('refuses a code supported only by a problem list', async () => {
    await expect(
      codingSuggest.run(
        {
          claimId: CLAIM_ID,
          suggestions: [
            {
              system: 'ICD-10-CM',
              code: 'E11.9',
              level: 0,
              supportedLevel: 0,
              source: { resourceType: 'ProblemList', resourceId: ENCOUNTER_ID, field: 'items' },
            },
          ],
        },
        stubToolContext()
      )
    ).rejects.toMatchObject({ code: 'AGENT_TOOL_INPUT_INVALID' });
  });
});

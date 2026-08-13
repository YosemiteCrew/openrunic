import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TOOL_ALLOWLIST } from './allowlist.js';
import { ALL_TOOLS, PATIENT_TOOLS, V1_TOOLS, createV1Registry } from './catalogue.js';
import type { AgentTool } from './registry.js';
import { resolveTools } from './resolve.js';
import { TEST_PATIENT_ID, recordingApiClient, stubPrincipal } from './testing/index.js';

/**
 * A patient may only ever reach their own chart.
 *
 * This is the suite the patient surface exists or does not exist on, so it is
 * written against the **grants** rather than against a list of tool names. Add a
 * tool to `TOOL_ALLOWLIST.patient` and every case below runs against it
 * immediately; if the new tool does not carry the compartment property, the
 * suite fails naming it, rather than passing because nobody remembered to add a
 * case. That is the whole design of the file: a future grant that widened what a
 * patient can reach cannot land quietly.
 *
 * The property being asserted is not "the endpoints we happened to call are
 * patient-scoped". It is that a row belonging to somebody else, however it got
 * into a tool result, aborts the turn on the way out.
 *
 * The **organisation** boundary is not asserted here, and the reason is worth
 * recording rather than leaving as an apparent gap: no response DTO in this API
 * carries a tenant at all, so a tool has nothing to project and the payload walk
 * has nothing to look at. That boundary lives where it can actually be enforced,
 * in the `x-openrunic-tenant` header the API client sends and the tenant-scope
 * middleware compares against the verified session. `compartment.test.ts` covers
 * the walk itself for the day a DTO does start carrying one.
 */

const ANOTHER_PATIENT_ID = '018f2b40-0000-7000-8000-0000000009ff';

/** The permissions the API's `patient-portal` role actually holds. */
const PORTAL_SCOPES = [
  'patient.read',
  'appointment.read',
  'appointment.write',
  'encounter.read',
  'document.read',
  'result.read',
  'message.read',
  'message.write',
  'coverage.read',
  'form.read',
  'form.write',
  'payment.read',
];

function patientPrincipal(overrides: Parameters<typeof stubPrincipal>[0] = {}) {
  return stubPrincipal({
    surface: 'patient',
    roleIds: ['patient-portal'],
    userId: TEST_PATIENT_ID,
    compartment: { patientId: TEST_PATIENT_ID },
    scopes: PORTAL_SCOPES,
    ...overrides,
  });
}

/** Every tool the shipped allowlist grants a patient, resolved from the registry. */
const registry = createV1Registry();
const granted: AgentTool[] = [...new Set(Object.values(TOOL_ALLOWLIST.patient).flat())].map(
  (id) => {
    const tool = registry.byId(id);
    if (tool === undefined)
      throw new Error(`The patient allowlist grants ${id}, which is not registered.`);
    return tool;
  }
);

/**
 * A row that belongs to somebody else, shaped like whatever the tool under test
 * reads. Every patient tool reads the same list envelope, so one builder covers
 * the set; a future tool that reads something else will fail
 * `parseOwnedPage` loudly rather than pass this quietly.
 */
function pageOfOneForeignRow(): unknown {
  return {
    data: [
      {
        id: '018f2b40-0000-7000-8000-0000000009fe',
        patientId: ANOTHER_PATIENT_ID,
        display: 'Something recorded about somebody else',
        substanceDisplay: 'Something recorded about somebody else',
        clinicalStatus: 'ACTIVE',
        status: 'SENT',
        recordedAt: '2026-03-04T09:00:00.000Z',
        administeredAt: '2026-03-04T09:00:00.000Z',
        generatedAt: '2026-03-04T09:00:00.000Z',
        paidAt: null,
        sigText: null,
        effectiveStart: null,
        balanceCents: 4200,
        type: { display: 'Follow-up' },
        start: '2026-03-04T09:00:00.000Z',
        durationMinutes: 20,
      },
    ],
    page: { total: 1 },
  };
}

/** One call per tool, with arguments its own input schema accepts. */
function firstValidInput(tool: AgentTool): unknown {
  const shape = z.toJSONSchema(tool.inputSchema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { enum?: unknown[] }>;
  };
  const input: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(shape.properties ?? {})) {
    const first = property.enum?.[0];
    if (first !== undefined) input[key] = first;
  }
  return input;
}

describe('a patient cannot reach another patient record', () => {
  it.each(granted.map((tool) => [tool.id, tool] as const))(
    '%s aborts the turn when a row names another chart',
    async (_id, tool) => {
      const api = recordingApiClient(() => pageOfOneForeignRow());

      const error: unknown = await tool
        .run(firstValidInput(tool), {
          principal: patientPrincipal(),
          credential: { authorization: 'Bearer test-token' },
          api,
        })
        .then(() => undefined)
        .catch((caught: unknown) => caught);

      expect(error, `${tool.id} accepted a row from another chart`).toMatchObject({
        code: 'AGENT_COMPARTMENT_VIOLATION',
        abortsTurn: true,
      });
    }
  );

  it.each(granted.map((tool) => [tool.id, tool] as const))(
    '%s aborts the whole turn rather than quietly dropping the foreign row',
    async (_id, tool) => {
      const page = pageOfOneForeignRow() as { data: Record<string, unknown>[] };
      const mine = {
        ...page.data[0],
        id: '018f2b40-0000-7000-8000-0000000009fd',
        patientId: TEST_PATIENT_ID,
      };
      const api = recordingApiClient(() => ({ data: [mine, ...page.data], page: { total: 2 } }));

      const error: unknown = await tool
        .run(firstValidInput(tool), {
          principal: patientPrincipal(),
          credential: { authorization: 'Bearer test-token' },
          api,
        })
        .then((result) => result)
        .catch((caught: unknown) => caught);

      /* Not a shorter answer with the foreign row filtered out: an answer that
         cannot be shown at all. A silent filter hides the fault that produced
         it, and the fault that produced it is a chart the reader does not own
         arriving in their own transcript. */
      expect(error, `${tool.id} returned a page containing a row from another chart`).toMatchObject(
        { code: 'AGENT_COMPARTMENT_VIOLATION', abortsTurn: true }
      );
    }
  );

  it.each(granted.map((tool) => [tool.id, tool] as const))(
    '%s refuses to read at all when no chart is bound to the turn',
    async (_id, tool) => {
      const api = recordingApiClient(() => pageOfOneForeignRow());

      const error: unknown = await tool
        .run(firstValidInput(tool), {
          principal: patientPrincipal({ compartment: {} }),
          credential: { authorization: 'Bearer test-token' },
          api,
        })
        .then(() => undefined)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: 'AGENT_COMPARTMENT_VIOLATION' });
      expect(api.calls, `${tool.id} called the API before it knew whose chart it was on`).toEqual(
        []
      );
    }
  );

  it.each(granted.map((tool) => [tool.id, tool] as const))(
    '%s names no patient in the request it sends',
    async (_id, tool) => {
      const api = recordingApiClient(() => ({ data: [], page: { total: 0 } }));

      await tool.run(firstValidInput(tool), {
        principal: patientPrincipal(),
        credential: { authorization: 'Bearer test-token' },
        api,
      });

      for (const call of api.calls) {
        expect(call.request.path, tool.id).not.toContain(TEST_PATIENT_ID);
        expect(Object.keys(call.request.query ?? {}), tool.id).not.toContain('patientId');
      }
    }
  );

  it.each(granted.map((tool) => [tool.id, tool] as const))(
    '%s carries the chart on every row it returns, so there is something to check',
    (_id, tool) => {
      const keys = outputKeys(tool);
      expect(
        keys.has('patientId'),
        `${tool.id} returns rows that do not name a chart, so the boundary re-check would pass on anything`
      ).toBe(true);
    }
  );
});

describe('what the patient surface is granted', () => {
  it('grants exactly the three read capabilities ADR-0006 decided', () => {
    expect(TOOL_ALLOWLIST.patient).toEqual({
      'patient-portal': ['record.list', 'visits.list', 'bills.list'],
    });
  });

  it('grants nothing that can change anything', () => {
    for (const tool of granted) {
      expect({ id: tool.id, tier: tool.tier, side: tool.sideEffect }).toEqual({
        id: tool.id,
        tier: 'READ',
        side: 'read',
      });
    }
  });

  it('binds every granted tool to one chart, rather than relying on the surface to do it', () => {
    for (const tool of granted) {
      expect(tool.compartmentBound, tool.id).toBe(true);
    }
  });

  it('keeps every granted tool in the reader half of the split', () => {
    for (const tool of granted) {
      expect(tool.trustClass, tool.id).toBe('reader');
    }
  });

  it('grants no staff capability to a patient, and no patient capability to staff', () => {
    const staffIds = new Set(V1_TOOLS.map((tool) => tool.id));
    const patientIds = new Set(PATIENT_TOOLS.map((tool) => tool.id));

    for (const ids of Object.values(TOOL_ALLOWLIST.patient)) {
      for (const id of ids) expect(staffIds.has(id), `${id} is a staff capability`).toBe(false);
    }
    for (const ids of Object.values(TOOL_ALLOWLIST.staff)) {
      for (const id of ids) expect(patientIds.has(id), `${id} is a patient capability`).toBe(false);
    }
  });

  it('names the patient surface on every patient tool and on no staff tool', () => {
    for (const tool of PATIENT_TOOLS) expect(tool.surfaces, tool.id).toEqual(['patient']);
    for (const tool of V1_TOOLS) expect(tool.surfaces, tool.id).toEqual(['staff']);
  });

  it('requires only permissions the portal role actually holds', () => {
    const held = new Set(PORTAL_SCOPES);
    for (const tool of granted) {
      for (const scope of tool.requiredScopes) {
        expect(held.has(scope), `${tool.id} needs ${scope}`).toBe(true);
      }
    }
  });

  it('lets a patient see their three capabilities and nothing else', () => {
    expect(resolveTools(registry, patientPrincipal()).map((tool) => tool.id)).toEqual([
      'record.list',
      'visits.list',
      'bills.list',
    ]);
  });

  it('shows a patient nothing when the portal role is missing, rather than a default', () => {
    expect(resolveTools(registry, patientPrincipal({ roleIds: ['clinician'] }))).toEqual([]);
  });

  it('gives a staff caller none of the patient capabilities, whatever role they hold', () => {
    for (const role of Object.keys(TOOL_ALLOWLIST.staff)) {
      const asStaff = resolveTools(
        registry,
        stubPrincipal({ roleIds: [role], scopes: [...PORTAL_SCOPES, 'audit.query', 'claim.read'] })
      );
      for (const tool of asStaff) {
        expect(
          PATIENT_TOOLS.map((patient) => patient.id),
          role
        ).not.toContain(tool.id);
      }
    }
  });
});

/**
 * Banned wherever the product renders it. The staff catalogue holds itself to
 * the same list; on this surface the reason is sharper, because there is no
 * clinician between the reader and the word.
 */
const BANNED_VOCABULARY = [
  'diagnose',
  'diagnosis',
  'triage',
  'acuity',
  'urgency',
  'urgent',
  'advice',
  'recommend',
  'severity',
  'critical',
];

/** Shorthand a reader would have to look up. A patient surface writes none of it. */
const BANNED_SHORTHAND = ['mrn', 'dob', 'prn', 'icd', 'cpt', 'snomed', 'loinc', 'cvx', 'rxnorm'];

describe('how a patient capability describes itself', () => {
  it.each(PATIENT_TOOLS.map((tool) => [tool.id, tool] as const))(
    '%s says nothing that reads as a clinical judgement',
    (_id, tool) => {
      const text = `${tool.summary} ${tool.activityLabel}`.toLowerCase();
      for (const word of BANNED_VOCABULARY) {
        expect(text.includes(word), `${tool.id} says "${word}"`).toBe(false);
      }
    }
  );

  it.each(PATIENT_TOOLS.map((tool) => [tool.id, tool] as const))(
    '%s uses no shorthand a reader would have to look up',
    (_id, tool) => {
      const words = `${tool.summary} ${tool.activityLabel}`.toLowerCase().split(/[^a-z]+/);
      for (const shorthand of BANNED_SHORTHAND) {
        expect(words.includes(shorthand), `${tool.id} says "${shorthand}"`).toBe(false);
      }
    }
  );

  it.each(PATIENT_TOOLS.map((tool) => [tool.id, tool] as const))(
    '%s addresses the reader as the owner of the record',
    (_id, tool) => {
      expect(tool.summary.toLowerCase(), tool.id).toContain('your');
    }
  );
});

describe('the registry the runtime builds', () => {
  it('holds both catalogues, so a deployer never assembles the patient one by hand', () => {
    expect(ALL_TOOLS).toEqual([...V1_TOOLS, ...PATIENT_TOOLS]);
    for (const tool of PATIENT_TOOLS) expect(registry.byId(tool.id)).toBeDefined();
  });
});

/** Every property name a tool's output schema mentions, at any depth. */
function outputKeys(tool: AgentTool): Set<string> {
  const keys = new Set<string>();
  walk(z.toJSONSchema(tool.outputSchema, { io: 'output', unrepresentable: 'any' }), keys);
  return keys;
}

function walk(node: unknown, keys: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, keys);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  const record = node as Record<string, unknown>;
  const properties = record['properties'];
  if (typeof properties === 'object' && properties !== null) {
    for (const key of Object.keys(properties)) keys.add(key);
  }
  for (const value of Object.values(record)) walk(value, keys);
}

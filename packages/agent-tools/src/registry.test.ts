import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ToolError } from './errors.js';
import { createToolRegistry, defineTool, type ToolDefinition } from './registry.js';
import { recordingApiClient, stubPrincipal, stubToolContext } from './testing/index.js';

/**
 * The invariants run at registration, not at call time.
 *
 * A tool that breaks one cannot be shipped, because the module that defines it
 * throws on import and the process that loads it fails. A check that only fires
 * when a model happens to call the tool is a check that ships broken.
 */

const base: ToolDefinition<{ note: string }, { ok: boolean }> = {
  id: 'sample.read',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['patient.read'],
  surfaces: ['staff'],
  summary: 'A sample.',
  activityLabel: 'Sampling',
  maxResultRows: 5,
  compartmentBound: false,
  input: z.strictObject({ note: z.string() }),
  output: z.strictObject({ ok: z.boolean() }),
  execute: () => Promise.resolve({ ok: true }),
};

function define<Input, Output>(overrides: Partial<ToolDefinition<Input, Output>>): () => void {
  return () =>
    void defineTool({ ...base, ...overrides } as unknown as ToolDefinition<Input, Output>);
}

describe('defineTool', () => {
  it('accepts a well-formed read tool and derives its side effect', () => {
    const tool = defineTool(base);
    expect(tool.sideEffect).toBe('read');
    expect(tool.id).toBe('sample.read');
  });

  it('derives a write side effect from the tier', () => {
    const tool = defineTool({
      ...base,
      id: 'sample.draft',
      tier: 'DRAFT',
      trustClass: 'writer',
      approval: 'always',
    });
    expect(tool.sideEffect).toBe('write');
  });

  it('refuses an id that is not aggregate.verb', () => {
    expect(define({ id: 'sample' })).toThrow(/aggregate\.verb/);
  });

  it('refuses anything that looks like outbound communication', () => {
    for (const id of ['message.send', 'chart.export', 'note.emailToProvider', 'doc.faxOut']) {
      expect(define({ id })).toThrow(/outbound-communication/);
    }
  });

  it('refuses a tool registered for no surface', () => {
    expect(define({ surfaces: [] })).toThrow(/no surface/);
  });

  it('refuses a row cap below one', () => {
    expect(define({ maxResultRows: 0 })).toThrow(/minimum-necessary/);
  });

  it('refuses a READ tool that claims to be a writer', () => {
    expect(define({ trustClass: 'writer' })).toThrow(/belongs to the reader/);
  });

  it('refuses a state-changing tool that is not approval-always', () => {
    expect(
      define({ id: 'sample.draft', tier: 'DRAFT', trustClass: 'writer', approval: 'never' })
    ).toThrow(/no such thing as an unapproved write/);
  });

  it('refuses a state-changing tool that names no scope', () => {
    expect(
      define({
        id: 'sample.draft',
        tier: 'DRAFT',
        trustClass: 'writer',
        approval: 'always',
        requiredScopes: [],
      })
    ).toThrow(/name the permission/);
  });

  it('refuses an input schema that names a compartment', () => {
    for (const key of ['tenantId', 'organisationId']) {
      expect(define({ input: z.strictObject({ [key]: z.string() }) })).toThrow(
        /the model never names one/
      );
    }
  });

  it('finds a compartment key nested anywhere in the schema', () => {
    expect(
      define({
        input: z.strictObject({
          filters: z.array(z.strictObject({ tenantId: z.string() })),
        }),
      })
    ).toThrow(/the model never names one/);
  });

  it('refuses a patient identifier on a patient-facing tool', () => {
    expect(
      define({
        surfaces: ['patient'],
        input: z.strictObject({ patientId: z.string() }),
      })
    ).toThrow(/bound from the session/);
  });

  it('allows a patient identifier on a staff-only tool', () => {
    expect(define({ input: z.strictObject({ patientId: z.uuid() }) })).not.toThrow();
  });
});

describe('running a tool', () => {
  it('validates the input before executing', async () => {
    const tool = defineTool(base);
    await expect(tool.run({ note: 42 }, stubToolContext())).rejects.toMatchObject({
      code: 'AGENT_TOOL_INPUT_INVALID',
      toolId: 'sample.read',
    });
  });

  it('validates the output the tool produced', async () => {
    const tool = defineTool({
      ...base,
      execute: () => Promise.resolve({ ok: 'yes' } as unknown as { ok: boolean }),
    });
    await expect(tool.run({ note: 'x' }, stubToolContext())).rejects.toMatchObject({
      code: 'AGENT_TOOL_OUTPUT_INVALID',
    });
  });

  it('re-checks the compartment on the way out and aborts the turn', async () => {
    const tool = defineTool({
      ...base,
      output: z.object({ tenantId: z.string() }),
      execute: () => Promise.resolve({ tenantId: 'a-different-organisation' }),
    });

    const error: unknown = await tool
      .run({ note: 'x' }, stubToolContext())
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('AGENT_COMPARTMENT_VIOLATION');
    expect((error as ToolError).abortsTurn).toBe(true);
  });

  it('passes the caller principal and credential through to the client', async () => {
    const api = recordingApiClient(() => ({ ok: true }));
    const tool = defineTool({
      ...base,
      execute: async (_input, context) => {
        await context.api.call({ method: 'GET', path: '/bff/v0/patients' }, context);
        return { ok: true };
      },
    });

    const principal = stubPrincipal({ roleIds: ['biller'] });
    await tool.run({ note: 'x' }, stubToolContext({ api, principal }));

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.context.principal.roleIds).toEqual(['biller']);
    expect(api.calls[0]?.context.credential.authorization).toBe('Bearer test-token');
  });
});

describe('createToolRegistry', () => {
  it('refuses a duplicate id', () => {
    expect(() => createToolRegistry([defineTool(base), defineTool(base)])).toThrow(/Duplicate/);
  });

  it('looks a tool up by id without consulting authorisation', () => {
    const registry = createToolRegistry([defineTool(base)]);
    expect(registry.byId('sample.read')?.id).toBe('sample.read');
    expect(registry.byId('nope.missing')).toBeUndefined();
  });
});

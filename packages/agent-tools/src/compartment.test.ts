import { describe, expect, it } from 'vitest';

import { assertWithinCompartment, countRows } from './compartment.js';
import type { ToolError } from './errors.js';
import {
  OTHER_TENANT_ID,
  TEST_PATIENT_ID,
  TEST_TENANT_ID,
  stubPrincipal,
} from './testing/index.js';

/**
 * The boundary re-check. Every one of these cases aborts; none of them filters.
 */

const check = { toolId: 'sample.read', maxResultRows: 5, compartmentBound: false };

function caught(run: () => void): ToolError {
  try {
    run();
  } catch (error) {
    return error as ToolError;
  }
  throw new Error('expected a ToolError');
}

describe('the compartment re-check', () => {
  it('passes a payload inside the caller organisation', () => {
    expect(() =>
      assertWithinCompartment({ tenantId: TEST_TENANT_ID }, stubPrincipal(), check)
    ).not.toThrow();
  });

  it('aborts the turn on a row from another organisation', () => {
    const error = caught(() =>
      assertWithinCompartment({ tenantId: OTHER_TENANT_ID }, stubPrincipal(), check)
    );
    expect(error.code).toBe('AGENT_COMPARTMENT_VIOLATION');
    expect(error.abortsTurn).toBe(true);
    expect(error.message).toMatch(/turn was aborted/);
  });

  it('finds a foreign organisation nested at any depth', () => {
    const payload = { data: [{ links: [{ organisationId: OTHER_TENANT_ID }] }] };
    expect(caught(() => assertWithinCompartment(payload, stubPrincipal(), check)).code).toBe(
      'AGENT_COMPARTMENT_VIOLATION'
    );
  });

  it('ignores the patient compartment on an unbound staff tool', () => {
    expect(() =>
      assertWithinCompartment({ patientId: TEST_PATIENT_ID }, stubPrincipal(), check)
    ).not.toThrow();
  });

  it('enforces the open chart on a bound tool', () => {
    const principal = stubPrincipal({ compartment: { patientId: TEST_PATIENT_ID } });
    const bound = { ...check, compartmentBound: true };

    expect(() =>
      assertWithinCompartment({ patientId: TEST_PATIENT_ID }, principal, bound)
    ).not.toThrow();
    expect(
      caught(() => assertWithinCompartment({ patientId: OTHER_TENANT_ID }, principal, bound)).code
    ).toBe('AGENT_COMPARTMENT_VIOLATION');
  });

  it('binds the chart on the patient surface whatever the tool declared', () => {
    const principal = stubPrincipal({
      surface: 'patient',
      compartment: { patientId: TEST_PATIENT_ID },
    });
    expect(
      caught(() => assertWithinCompartment({ patientId: OTHER_TENANT_ID }, principal, check))
        .message
    ).toMatch(/outside the open chart/);
  });

  it('refuses more rows than the tool declared, rather than truncating', () => {
    const payload = { data: [1, 2, 3, 4, 5, 6], page: { total: 6 } };
    const error = caught(() => assertWithinCompartment(payload, stubPrincipal(), check));
    expect(error.code).toBe('AGENT_SCOPE_DENIED');
    expect(error.abortsTurn).toBe(false);
  });

  it('ignores non-string values sitting under a compartment key', () => {
    expect(() =>
      assertWithinCompartment({ tenantId: null, patientId: 42 }, stubPrincipal(), check)
    ).not.toThrow();
  });
});

describe('countRows', () => {
  it('counts a list envelope by its data array', () => {
    expect(countRows({ data: [1, 2, 3], page: { total: 3 } })).toBe(3);
  });

  it('counts a bare array by its length', () => {
    expect(countRows([1, 2])).toBe(2);
  });

  it('counts a single object as one', () => {
    expect(countRows({ status: 'pending' })).toBe(1);
  });

  it('counts a primitive as one', () => {
    expect(countRows('anything')).toBe(1);
  });
});

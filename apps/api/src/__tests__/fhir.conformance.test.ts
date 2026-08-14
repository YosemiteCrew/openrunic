import type { Bundle, CapabilityStatement, OperationOutcome } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { BULK_EXPORT_OPERATIONS } from '../fhir/bulk-export.js';
import { SERVED_MODULES } from '../fhir/resources.js';

import { bearer, createTestApp, TOKENS, testId } from './support.js';

/**
 * Conformance: the CapabilityStatement and the router, checked against each
 * other.
 *
 * ADR-0002's rule is that `/metadata` can never drift from reality, and a rule
 * is only worth what enforces it. So this suite reads the statement the server
 * actually publishes and, for every resource and every parameter it claims,
 * makes the request that claim implies. A resource the router does not mount
 * fails here. A parameter the search validator would reject fails here. The
 * reverse direction is checked too, so a resource that is quietly served
 * without being advertised is equally a failure: an undocumented endpoint on a
 * public API is a promise nobody can plan around.
 */

interface StatementParam {
  name: string;
  type: string;
}

interface StatementOperation {
  name: string;
  definition: string;
}

interface StatementResource {
  type: string;
  interaction: { code: string }[];
  searchParam: StatementParam[];
  operation?: StatementOperation[];
}

/** A token whose roles hold every read permission the mounted resources need. */
const READER = TOKENS.adminA;

async function capabilityStatement(): Promise<CapabilityStatement> {
  const { app } = createTestApp();
  const res = await app.request('/fhir/metadata');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/fhir+json');
  return (await res.json()) as CapabilityStatement;
}

function resourcesOf(statement: CapabilityStatement): StatementResource[] {
  return (statement.rest?.[0]?.resource ?? []) as unknown as StatementResource[];
}

/** A value of the right shape for a parameter's declared type. */
function sampleValue(param: StatementParam): string {
  if (param.type === 'date') return '2026-08-14';
  if (param.type === 'number') return '1';
  if (param.type === 'reference') return testId(1);
  if (param.name === 'gender') return 'female';
  if (param.name === '_id') return testId(1);
  return 'sample';
}

/** True when the outcome says the server does not implement that parameter. */
function reportsUnsupported(outcome: OperationOutcome, param: string): boolean {
  return (outcome.issue ?? []).some(
    (issue) => issue.code === 'not-supported' && (issue.expression ?? []).includes(param)
  );
}

describe('the CapabilityStatement', () => {
  it('is served without a token, because a client needs it before it has one', async () => {
    const statement = await capabilityStatement();

    expect(statement.resourceType).toBe('CapabilityStatement');
    expect(statement.fhirVersion).toBe('4.0.1');
    expect(statement.rest?.[0]?.security?.service?.[0]?.text).toContain('SMART');
  });

  it('lists exactly the resources the router mounts', async () => {
    const statement = await capabilityStatement();

    expect(resourcesOf(statement).map((resource) => resource.type)).toEqual(
      SERVED_MODULES.map((module) => module.type)
    );
  });

  it('claims no resource the router does not answer a search for', async () => {
    const statement = await capabilityStatement();
    const { app } = createTestApp();

    for (const resource of resourcesOf(statement)) {
      const res = await app.request(`/fhir/${resource.type}`, { headers: bearer(READER) });

      expect(res.status, `${resource.type} search`).toBe(200);
      const bundle = (await res.json()) as Bundle;
      expect(bundle.resourceType).toBe('Bundle');
      expect(bundle.type).toBe('searchset');
    }
  });

  it('claims no resource the router does not answer a read for', async () => {
    const statement = await capabilityStatement();
    const { app } = createTestApp();

    for (const resource of resourcesOf(statement)) {
      const res = await app.request(`/fhir/${resource.type}/${testId(9)}`, {
        headers: bearer(READER),
      });

      expect(res.status, `${resource.type} read`).toBe(404);
      const outcome = (await res.json()) as OperationOutcome;
      // The catch-all answers 404 too, so the diagnostics are what separates
      // "no such record" from "no such endpoint".
      expect(outcome.issue?.[0]?.diagnostics, `${resource.type} read`).toBe(
        `No such ${resource.type}.`
      );
    }
  });

  it('claims no search parameter the router would reject as unimplemented', async () => {
    const statement = await capabilityStatement();
    const { app } = createTestApp();

    for (const resource of resourcesOf(statement)) {
      for (const param of resource.searchParam) {
        const url = `/fhir/${resource.type}?${param.name}=${encodeURIComponent(sampleValue(param))}`;
        const res = await app.request(url, { headers: bearer(READER) });

        if (res.status === 200) continue;
        const outcome = (await res.json()) as OperationOutcome;
        expect(
          reportsUnsupported(outcome, param.name),
          `${resource.type} advertises ${param.name} but the router rejects it`
        ).toBe(false);
      }
    }
  });

  it('advertises the paging controls on every resource', async () => {
    const statement = await capabilityStatement();

    for (const resource of resourcesOf(statement)) {
      const names = resource.searchParam.map((param) => param.name);
      expect(names, resource.type).toContain('_count');
      expect(names, resource.type).toContain('_offset');
    }
  });

  it('declares the interactions each resource really implements', async () => {
    const statement = await capabilityStatement();
    const patient = resourcesOf(statement).find((resource) => resource.type === 'Patient');

    expect(patient?.interaction.map((entry) => entry.code)).toEqual([
      'read',
      'search-type',
      'create',
    ]);
  });
});

describe('an unadvertised parameter', () => {
  it('is refused rather than ignored', async () => {
    const { app } = createTestApp();

    const res = await app.request('/fhir/Patient?famliy=Patientsson', {
      headers: bearer(READER),
    });

    expect(res.status).toBe(400);
    const outcome = (await res.json()) as OperationOutcome;
    // Ignoring it would return the whole patient index to a client that
    // believed it had asked for one family.
    expect(reportsUnsupported(outcome, 'famliy')).toBe(true);
  });

  it('is refused on every resource, not only on the one that was built first', async () => {
    const { app } = createTestApp();

    for (const module of SERVED_MODULES) {
      const res = await app.request(`/fhir/${module.type}?_has:Condition:patient:code=X`, {
        headers: bearer(READER),
      });

      expect(res.status, module.type).toBe(400);
    }
  });
});

describe('a resource this server does not serve', () => {
  it('is a 404 with an OperationOutcome, not a text body', async () => {
    const { app } = createTestApp();

    const res = await app.request('/fhir/Medication', { headers: bearer(READER) });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');
    const outcome = (await res.json()) as OperationOutcome;
    expect(outcome.issue?.[0]?.diagnostics).toContain('does not serve');
  });
});

/**
 * Operations get the same treatment as parameters: a declared operation must be
 * callable, and a mounted one must be declared. A client planning an
 * integration reads `/metadata` and nothing else, so an operation that is
 * advertised and refuses is a day lost to debugging the wrong system - and one
 * that works but is undeclared is a capability nobody will ever use.
 */
describe('the declared operations', () => {
  it('advertises the bulk export entry points at the scope each belongs to', async () => {
    const statement = await capabilityStatement();

    const system = (statement.rest?.[0] as { operation?: StatementOperation[] } | undefined)
      ?.operation;
    const patient = resourcesOf(statement).find((resource) => resource.type === 'Patient');

    expect(system?.map((operation) => operation.definition)).toEqual([
      'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export',
    ]);
    expect(patient?.operation?.map((operation) => operation.definition)).toEqual([
      'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export',
    ]);
  });

  it('serves every entry point it declares', async () => {
    const { app } = createTestApp();

    for (const operation of BULK_EXPORT_OPERATIONS) {
      const res = await app.request(`/fhir${operation.path}`, {
        headers: { ...bearer(READER), prefer: 'respond-async' },
      });

      expect(res.status, operation.path).toBe(202);
      expect(res.headers.get('content-location'), operation.path).toContain('/$export-status/');
    }
  });

  /** A resource with no operations declares none, rather than an empty array. */
  it('does not attach an empty operation list to resources that have none', async () => {
    const statement = await capabilityStatement();

    const withoutOperations = resourcesOf(statement).filter(
      (resource) => resource.type !== 'Patient'
    );

    expect(withoutOperations.every((resource) => resource.operation === undefined)).toBe(true);
  });
});

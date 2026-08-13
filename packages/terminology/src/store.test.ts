import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_EXPANSION_SIZE } from './service.js';
import { createStoreTerminologyService } from './store.js';
import type { TerminologyCodeStore } from './store.js';
import { describeTerminologyServiceContract } from './test-support/contract.js';
import {
  FIXTURE_STORED_CODES,
  createFailingTerminologyStore,
  createRecordingTerminologyStore,
} from './test-support/fake-store.js';
import type { FakeStoredCode, RecordingTerminologyStore } from './test-support/fake-store.js';
import {
  FIXTURE_TENANT_ID,
  FIXTURE_VALUE_SETS,
  PROBLEM_SYSTEM,
  PROCEDURE_SYSTEM,
  UNLOADED_SYSTEM,
  VS_ELBOW_PROBLEMS,
  VS_EXPLICIT_PROCEDURES,
  VS_HISTORICAL_PROBLEMS,
  VS_JOINT_PROBLEMS,
} from './test-support/fixture.js';

function harness(store: TerminologyCodeStore) {
  return createStoreTerminologyService(store, {
    tenantId: FIXTURE_TENANT_ID,
    valueSets: FIXTURE_VALUE_SETS,
  });
}

function recording(): RecordingTerminologyStore {
  return createRecordingTerminologyStore(FIXTURE_STORED_CODES);
}

describeTerminologyServiceContract({
  name: 'store-backed',
  create: (options) =>
    createStoreTerminologyService(createRecordingTerminologyStore(FIXTURE_STORED_CODES), {
      tenantId: FIXTURE_TENANT_ID,
      valueSets: FIXTURE_VALUE_SETS,
      ...options,
    }),
});

describe('store-backed service: tenant scoping', () => {
  it('stamps the tenant onto every query it issues', async () => {
    const store = recording();
    const service = harness(store);
    await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-404' });
    await service.expandValueSet({ valueSet: VS_ELBOW_PROBLEMS });
    await service.expandValueSet({ valueSet: VS_JOINT_PROBLEMS });
    await service.search({ query: 'elbow' });

    expect(store.queries.length).toBeGreaterThan(5);
    for (const query of store.queries) {
      expect(query.where.tenantId).toBe(FIXTURE_TENANT_ID);
    }
  });

  it('cannot see a code that exists only under another tenant', async () => {
    const service = harness(recording());
    const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-500' });
    expect(!result.ok && result.error.kind).toBe('code_not_found');
  });

  it('keeps another practice wording out of a search', async () => {
    const service = harness(recording());
    const result = await service.search({ query: 'elbow', limit: 100 });
    expect(result.ok && result.value.map((concept) => concept.display)).not.toContain(
      'Aching elbow, other practice wording'
    );
  });
});

describe('store-backed service: query shapes', () => {
  it('reads a code through the unique key and orders by version', async () => {
    const store = recording();
    await harness(store).lookup({ system: PROBLEM_SYSTEM, code: 'PB-100' });

    expect(store.queries).toHaveLength(1);
    expect(store.queries[0]?.method).toBe('findFirst');
    expect(store.queries[0]?.where).toStrictEqual({
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
      code: 'PB-100',
    });
    expect(store.queries[0]?.orderBy).toStrictEqual([{ version: 'desc' }]);
  });

  it('pins the version in the where clause when the caller asked for one', async () => {
    const store = recording();
    await harness(store).lookup({ system: PROBLEM_SYSTEM, code: 'PB-100', version: '2025-01' });
    expect(store.queries[0]?.where.version).toBe('2025-01');
  });

  it('probes the system only after a lookup missed', async () => {
    const store = recording();
    await harness(store).lookup({ system: UNLOADED_SYSTEM, code: 'PB-100' });

    expect(store.queries).toHaveLength(2);
    expect(store.queries[1]?.where).toStrictEqual({
      tenantId: FIXTURE_TENANT_ID,
      system: UNLOADED_SYSTEM,
    });
  });

  it('does not probe the system when validate resolved the code', async () => {
    const store = recording();
    await harness(store).validate({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    expect(store.queries).toHaveLength(1);
  });

  it('validates against a value set without expanding it', async () => {
    const store = recording();
    await harness(store).validate({
      system: PROBLEM_SYSTEM,
      code: 'PB-110',
      valueSet: VS_JOINT_PROBLEMS,
    });
    expect(store.queries).toHaveLength(1);
    expect(store.queries[0]?.method).toBe('findFirst');
  });

  it('pages a single-rule value set in the database', async () => {
    const store = recording();
    await harness(store).expandValueSet({ valueSet: VS_ELBOW_PROBLEMS, offset: 1, limit: 5 });

    expect(store.queries.map((query) => query.method)).toStrictEqual(['count', 'findMany']);
    const expected = {
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
      parentCode: 'PB-100',
      isActive: true,
    };
    expect(store.queries[0]?.where).toStrictEqual(expected);
    expect(store.queries[1]?.where).toStrictEqual(expected);
    expect(store.queries[1]?.skip).toBe(1);
    expect(store.queries[1]?.take).toBe(5);
    expect(store.queries[1]?.orderBy).toStrictEqual([
      { system: 'asc' },
      { display: 'asc' },
      { code: 'asc' },
      { version: 'asc' },
    ]);
  });

  it('drops the isActive clause for a value set that admits retired codes', async () => {
    const store = recording();
    await harness(store).expandValueSet({ valueSet: VS_HISTORICAL_PROBLEMS });
    expect(store.queries[0]?.where).toStrictEqual({
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
    });
  });

  it('issues one bounded query per include rule when it has to merge', async () => {
    const store = recording();
    await harness(store).expandValueSet({ valueSet: VS_JOINT_PROBLEMS, limit: 1 });

    expect(store.queries.map((query) => query.method)).toStrictEqual(['findMany', 'findMany']);
    for (const query of store.queries) {
      expect(query.take).toBe(DEFAULT_MAX_EXPANSION_SIZE + 1);
      expect(query.skip).toBeUndefined();
    }
    expect(store.queries[0]?.where.parentCode).toBe('PB-100');
    expect(store.queries[1]?.where.parentCode).toBe('PB-200');
  });

  it('falls back to merging when a display filter is asked for', async () => {
    const store = recording();
    await harness(store).expandValueSet({ valueSet: VS_ELBOW_PROBLEMS, filter: 'left' });
    expect(store.queries.map((query) => query.method)).toStrictEqual(['findMany']);
  });

  it('selects explicit member codes with an in clause', async () => {
    const store = recording();
    await harness(store).expandValueSet({ valueSet: VS_EXPLICIT_PROCEDURES });
    expect(store.queries[0]?.where.code).toStrictEqual({ in: ['PR-10', 'PR-20'] });
  });

  it('runs only the indexed prefix query when it fills the page', async () => {
    const store = recording();
    const result = await harness(store).search({ query: 'Aching', limit: 2 });

    expect(store.queries).toHaveLength(1);
    expect(store.queries[0]?.where.display).toStrictEqual({
      startsWith: 'Aching',
      mode: 'insensitive',
    });
    expect(store.queries[0]?.take).toBe(2);
    expect(result.ok && result.value).toHaveLength(2);
  });

  it('fills a short page with a substring query that excludes what it already has', async () => {
    const store = recording();
    await harness(store).search({ query: 'elbow', limit: 20 });

    expect(store.queries).toHaveLength(2);
    expect(store.queries[1]?.where.display).toStrictEqual({
      contains: 'elbow',
      mode: 'insensitive',
    });
    expect(store.queries[1]?.where.NOT).toStrictEqual({
      display: { startsWith: 'elbow', mode: 'insensitive' },
    });
    expect(store.queries[1]?.take).toBe(19);
  });

  it('scopes a search to one system and to active codes by default', async () => {
    const store = recording();
    await harness(store).search({ query: 'examination', system: PROCEDURE_SYSTEM });
    expect(store.queries[0]?.where.system).toBe(PROCEDURE_SYSTEM);
    expect(store.queries[0]?.where.isActive).toBe(true);
  });

  it('issues no query at all for an empty search box', async () => {
    const store = recording();
    await harness(store).search({ query: '' });
    expect(store.queries).toStrictEqual([]);
  });

  it('issues no query for a value set it has no definition for', async () => {
    const store = recording();
    await harness(store).expandValueSet({ valueSet: 'http://example.invalid/vs/unknown' });
    expect(store.queries).toStrictEqual([]);
  });

  it('works with no value sets configured', async () => {
    const store = recording();
    const service = createStoreTerminologyService(store, { tenantId: FIXTURE_TENANT_ID });
    const result = await service.expandValueSet({ valueSet: VS_ELBOW_PROBLEMS });
    expect(!result.ok && result.error.kind).toBe('value_set_not_found');
  });
});

describe('store-backed service: row normalization', () => {
  const rows: readonly FakeStoredCode[] = [
    {
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
      code: 'PB-1',
      display: 'Object properties',
      version: '2026-01',
      parentCode: null,
      isActive: true,
      properties: { severityScale: 'mild-to-severe' },
    },
    {
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
      code: 'PB-2',
      display: 'List properties',
      version: '2026-01',
      parentCode: null,
      isActive: true,
      properties: ['not', 'an', 'object'],
    },
    {
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
      code: 'PB-3',
      display: 'Scalar properties',
      version: '2026-01',
      parentCode: null,
      isActive: true,
      properties: 'plain text',
    },
    {
      tenantId: FIXTURE_TENANT_ID,
      system: PROBLEM_SYSTEM,
      code: 'PB-4',
      display: 'Null properties',
      version: '2026-01',
      parentCode: null,
      isActive: true,
      properties: null,
    },
  ];

  it('keeps a JSON object and refuses to pass anything else off as one', async () => {
    const service = harness(createRecordingTerminologyStore(rows));
    const object = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-1' });
    const list = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-2' });
    const scalar = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-3' });
    const absent = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-4' });

    expect(object.ok && object.value.properties).toStrictEqual({
      severityScale: 'mild-to-severe',
    });
    expect(list.ok && list.value.properties).toBeNull();
    expect(scalar.ok && scalar.value.properties).toBeNull();
    expect(absent.ok && absent.value.properties).toBeNull();
  });
});

describe('store-backed service: an unavailable store', () => {
  const service = harness(createFailingTerminologyStore('connection terminated'));

  it('reports a failed lookup as data', async () => {
    const result = await service.lookup({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    expect(!result.ok && result.error.kind).toBe('store_unavailable');
    expect(!result.ok && result.error.message).toContain('connection terminated');
  });

  it('reports a failed validation as data', async () => {
    const result = await service.validate({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    expect(!result.ok && result.error.kind).toBe('store_unavailable');
  });

  it('reports a failed expansion as data, on both paths', async () => {
    const single = await service.expandValueSet({ valueSet: VS_ELBOW_PROBLEMS });
    const merged = await service.expandValueSet({ valueSet: VS_JOINT_PROBLEMS });
    expect(!single.ok && single.error.kind).toBe('store_unavailable');
    expect(!merged.ok && merged.error.kind).toBe('store_unavailable');
  });

  it('reports a failed search as data', async () => {
    const result = await service.search({ query: 'elbow' });
    expect(!result.ok && result.error.kind).toBe('store_unavailable');
  });

  it('stringifies a rejection that was not an Error', async () => {
    const rejecting: TerminologyCodeStore = {
      findMany: () => Promise.reject('pool exhausted'),
      findFirst: () => Promise.reject('pool exhausted'),
      count: () => Promise.reject('pool exhausted'),
    };
    const result = await harness(rejecting).lookup({ system: PROBLEM_SYSTEM, code: 'PB-110' });
    expect(!result.ok && result.error.message).toContain('pool exhausted');
  });
});

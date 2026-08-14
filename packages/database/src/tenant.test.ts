import { describe, expect, it } from 'vitest';

// Only the pure helpers are exercised here. `createTenantClient` needs a real
// PrismaClient and a database, so it is covered by the API package's
// cross-tenant integration suite (isolation layer 3).
import {
  TENANT_SCOPED_MODELS,
  isTenantScopedModel,
  withTenantData,
  withTenantWhere,
} from './tenant.js';

const TENANT = '01920000-0000-7000-8000-0000000000aa';
const OTHER_TENANT = '01920000-0000-7000-8000-0000000000bb';

describe('TENANT_SCOPED_MODELS', () => {
  it('lists every model exactly once', () => {
    expect(new Set(TENANT_SCOPED_MODELS).size).toBe(TENANT_SCOPED_MODELS.length);
  });

  it('excludes the Organisation root, which is the tenant', () => {
    expect(isTenantScopedModel('Organisation')).toBe(false);
  });

  it.each(['Patient', 'Encounter', 'Claim', 'AuditEvent', 'FormPromotedValue'])(
    'includes %s',
    (model) => {
      expect(isTenantScopedModel(model)).toBe(true);
    }
  );

  it('rejects a model name that does not exist', () => {
    expect(isTenantScopedModel('Prescription')).toBe(false);
  });
});

describe('withTenantWhere', () => {
  it('creates a predicate when there is no filter', () => {
    expect(withTenantWhere(undefined, TENANT)).toStrictEqual({ tenantId: TENANT });
  });

  it('ANDs the tenant onto an existing filter rather than merging into it', () => {
    expect(withTenantWhere({ mrn: 'OR-100482' }, TENANT)).toStrictEqual({
      AND: [{ mrn: 'OR-100482' }, { tenantId: TENANT }],
    });
  });

  it('cannot be widened by a caller-supplied tenant, because the AND still holds', () => {
    const where = withTenantWhere({ tenantId: OTHER_TENANT }, TENANT);
    expect(where).toStrictEqual({ AND: [{ tenantId: OTHER_TENANT }, { tenantId: TENANT }] });
  });

  it('cannot be widened by a caller-supplied OR', () => {
    const where = withTenantWhere({ OR: [{ tenantId: OTHER_TENANT }, { active: true }] }, TENANT);
    expect(where).toMatchObject({ AND: [expect.anything(), { tenantId: TENANT }] });
  });

  it('rejects a non-object filter', () => {
    expect(() => withTenantWhere('id', TENANT)).toThrow(TypeError);
  });
});

describe('withTenantData', () => {
  it('stamps a single create', () => {
    expect(withTenantData({ mrn: 'OR-100482' }, TENANT)).toStrictEqual({
      mrn: 'OR-100482',
      tenantId: TENANT,
    });
  });

  it('stamps every entry of a createMany', () => {
    expect(withTenantData([{ mrn: 'a' }, { mrn: 'b' }], TENANT)).toStrictEqual([
      { mrn: 'a', tenantId: TENANT },
      { mrn: 'b', tenantId: TENANT },
    ]);
  });

  it('overrides a caller-supplied tenant rather than honouring it', () => {
    expect(withTenantData({ tenantId: OTHER_TENANT }, TENANT)).toStrictEqual({ tenantId: TENANT });
  });

  it('produces a tenant stamp when there is no data', () => {
    expect(withTenantData(undefined, TENANT)).toStrictEqual({ tenantId: TENANT });
  });

  it('rejects a scalar', () => {
    expect(() => withTenantData('mrn', TENANT)).toThrow(TypeError);
  });
});

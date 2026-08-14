import { describe, expect, it } from 'vitest';

import type { Principal } from '../auth/principal.js';
import { isPermission, PERMISSIONS, ROLE_PERMISSIONS } from '../policy/permissions.js';
import { buildPolicyContext } from '../policy/policy.js';

import { DEMO_TENANT_A, testId } from './support.js';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    subject: testId(900),
    tenantId: DEMO_TENANT_A,
    actorType: 'user',
    roles: ['clinician'],
    facilityIds: [testId(800)],
    scopes: ['user/*.read'],
    purposeOfUse: 'TREAT',
    ...overrides,
  };
}

describe('the permission catalogue', () => {
  it('has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('only names permissions that exist in the catalogue', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(isPermission(permission), `${role} -> ${permission}`).toBe(true);
      }
    }
  });

  it('gives admin everything and read-only nothing that writes', () => {
    expect(ROLE_PERMISSIONS.admin).toHaveLength(PERMISSIONS.length);
    expect(ROLE_PERMISSIONS['read-only']?.some((p) => p.endsWith('.write'))).toBe(false);
  });

  it('keeps billing out of the chart and clinicians out of the ledger', () => {
    expect(ROLE_PERMISSIONS.biller).not.toContain('encounter.write');
    expect(ROLE_PERMISSIONS.clinician).not.toContain('claim.write');
    expect(ROLE_PERMISSIONS['front-desk']).not.toContain('encounter.write');
  });

  it('rejects a string that is not a permission', () => {
    expect(isPermission('patient.destroy')).toBe(false);
  });
});

describe('buildPolicyContext', () => {
  it('unions the permissions of every role held', () => {
    const policy = buildPolicyContext(principal({ roles: ['front-desk', 'biller'] }));

    expect(policy.can('appointment.write')).toBe(true);
    expect(policy.can('claim.write')).toBe(true);
    expect(policy.can('order.write')).toBe(false);
  });

  it('ignores an unknown role instead of throwing', () => {
    const policy = buildPolicyContext(principal({ roles: ['ghost', 'clinician'] }));

    expect(policy.can('patient.read')).toBe(true);
    expect(policy.roles).toEqual(['ghost', 'clinician']);
  });

  it('grants only the facilities named in the principal', () => {
    const policy = buildPolicyContext(principal({ facilityIds: [testId(800)] }));

    expect(policy.canAccessFacility(testId(800))).toBe(true);
    expect(policy.canAccessFacility(testId(801))).toBe(false);
  });

  it('treats an empty grant list as no access, never as a wildcard', () => {
    const policy = buildPolicyContext(principal({ facilityIds: [] }));

    expect(policy.canAccessFacility(testId(800))).toBe(false);
  });

  it('opens every facility to a principal holding facility.all', () => {
    const policy = buildPolicyContext(principal({ roles: ['admin'], facilityIds: [] }));

    expect(policy.can('facility.all')).toBe(true);
    expect(policy.canAccessFacility(testId(999))).toBe(true);
  });

  it("copies the principal's arrays rather than aliasing them", () => {
    const source = principal();
    const policy = buildPolicyContext(source);

    expect(policy.facilityIds).toEqual(source.facilityIds);
    expect(policy.facilityIds).not.toBe(source.facilityIds);
  });
});

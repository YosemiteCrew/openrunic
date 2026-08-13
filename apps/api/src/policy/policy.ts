import type { Principal } from '../auth/principal.js';

import { ROLE_PERMISSIONS, type Permission } from './permissions.js';

/**
 * The request's authorisation context: what the principal may do, and where.
 *
 * It is built once per request from the principal's roles and facility grants,
 * and it answers two questions - "may this actor perform this capability?" and
 * "may this actor see this facility's rows?". Both are pure lookups over data
 * resolved before the handler runs, so a route never re-derives permissions and
 * two routes can never disagree about what a role means.
 *
 * This is layer one of authorisation. It is not the last line: the tenant-bound
 * repositories in `src/repositories` narrow every query to one organisation
 * whether or not a policy check was made, and Postgres RLS narrows it again.
 */
export interface PolicyContext {
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<Permission>;
  readonly facilityIds: readonly string[];
  /** True when the principal holds `permission`. */
  can(permission: Permission): boolean;
  /** True when the principal may see rows belonging to `facilityId`. */
  canAccessFacility(facilityId: string): boolean;
}

/**
 * Resolves roles to permissions.
 *
 * An unknown role contributes nothing rather than throwing: a tenant that
 * renames a role should lose access, not lock every request out of the API with
 * a 500. The lost access is visible in the resulting 403 and its audit record.
 */
export function buildPolicyContext(principal: Principal): PolicyContext {
  const permissions = new Set<Permission>();
  for (const role of principal.roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
  }

  const facilityIds = [...principal.facilityIds];
  const facilitySet: ReadonlySet<string> = new Set(facilityIds);
  const allFacilities = permissions.has('facility.all');

  return {
    roles: [...principal.roles],
    permissions,
    facilityIds,
    can(permission: Permission): boolean {
      return permissions.has(permission);
    },
    canAccessFacility(facilityId: string): boolean {
      return allFacilities || facilitySet.has(facilityId);
    },
  };
}
